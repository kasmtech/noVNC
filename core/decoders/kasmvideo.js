/*
 * KasmVNC: HTML5 VNC client
 * Copyright (C) 2020 Kasm Technologies
 * Copyright (C) 2019 The noVNC Authors
 * (c) 2012 Michael Tinglof, Joe Balaz, Les Piech (Mercuri.ca)
 * Licensed under MPL 2.0 (see LICENSE.txt)
 *
 * See README.md for usage and integration instructions.
 *
 */

import * as Log from '../util/logging.js';

const VIDEO_CODEC = 'avc1.42E01E';
const TARGET_FPS = 60;
const FRAME_DURATION_US = Math.round(1_000_000 / TARGET_FPS);
//avc1.4d002a - main
/// avc1.42001E - baseline

export default class KasmVideoDecoder {
    constructor(display) {
        this._len = 0;
        this._key_frame = 0;
        this._ctl = null;
        this._display = display;
        this._codedWidth = null;
        this._codedHeight = null;

        this._width = null;
        this._height = null;

        this._timestamp = 0;
        this._timestampMap = new Map();
        this._decoder = new VideoDecoder({
            output: (frame) => {
                this._handleProcessVideoChunk(frame);
                // frame.close();
            }, error: (e) => {
                Log.Error(`There was an error inside KasmVideoDecoder`, e)
            }
        });
    }

    // ===== Public Methods =====

    decodeRect(x, y, width, height, sock, display, depth, frame_id) {
        if (this._ctl === null) {
            if (sock.rQwait("KasmVideo compression-control", 1)) {
                return false;
            }

            this._ctl = sock.rQshift8();

            // Figure out filter
            this._ctl = this._ctl >> 4;
        }

        let ret;

        if (this._ctl === 0x00) {
            ret = this._skipRect(x, y, width, height, sock, display, depth, frame_id);
        } else if (this._ctl === 0x01) {
            ret = this._processVideoFrameRect(x, y, width, height, sock, display, depth, frame_id);
        } else {
            throw new Error("Illegal KasmVideo compression received (ctl: " + this._ctl + ")");
        }

        if (ret) {
            this._ctl = null;
        }

        return ret;
    }

    resize(width, height) {
        this._updateSize(width, height);
    }

    // ===== Private Methods =====

    _configureDecoder(width, height) {
        this._decoder.configure({
            codec: VIDEO_CODEC,
            codedWidth: width,
            codedHeight: height,
            optimizeForLatency: true,
        })
    }

    _updateSize(width, height) {
        Log.Debug('Updated size: ', {width, height});

        this._width = width;
        this._height = height;

        this._configureDecoder(width, height);
    }

    _skipRect(x, y, width, height, _sock, display, _depth, frame_id) {
        display.clearRect(x, y, width, height, 0, frame_id, false);
        return true;
    }

    _handleProcessVideoChunk(frame) {
        Log.Debug('Frame ', frame);
        const {frame_id, x, y, width, height} = this._timestampMap.get(frame.timestamp);
        this._display.videoFrameRect(frame, frame_id, x, y, width, height);
        this._timestampMap.delete(frame.timestamp);
    }

    _processVideoFrameRect(x, y, width, height, sock, display, depth, frame_id) {
        let [key_frame, dataArr] = this._readData(sock);
        Log.Debug('key_frame: ', key_frame);
        if (dataArr === null) {
            return false;
        }

        if (width !== this._width && height !== this._height)
            this._updateSize(width, height)

        const vidChunk = new EncodedVideoChunk({
            type: key_frame ? 'key' : 'delta',
            data: dataArr,
            timestamp: this._timestamp,
        });
        this._timestampMap.set(this._timestamp, {
            frame_id,
            x,
            y,
            width,
            height
        });
        this._timestamp += FRAME_DURATION_US;
        this._decoder.decode(vidChunk);
        return true;
    }

    _readData(sock) {
        if (this._len === 0) {
            if (sock.rQwait("KasmVideo", 4)) {
                return [0, null];
            }

            this._key_frame = sock.rQshift8();
            let byte = sock.rQshift8();
            this._len = byte & 0x7f;
            if (byte & 0x80) {
                byte = sock.rQshift8();
                this._len |= (byte & 0x7f) << 7;
                if (byte & 0x80) {
                    byte = sock.rQshift8();
                    this._len |= byte << 14;
                }
            }
        }

        if (sock.rQwait("KasmVideo", this._len)) {
            return [0, null];
        }

        let data = sock.rQshiftBytes(this._len);
        let key_frame = this._key_frame;
        this._len = 0;
        this._key_frame = 0;

        return [key_frame, data];
    }

    dispose() {
        this._decoder.close();
    }
}
