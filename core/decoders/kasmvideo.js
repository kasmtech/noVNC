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

const VIDEO_CODEC_NAMES = {
    1: 'avc1.42E01E',
    2: 'hev1.1.6.L93.B0',
    3: 'av01.0.04M.08'
}

const TARGET_FPS = 120;
const FRAME_DURATION_US = Math.round(1_000_000 / TARGET_FPS);
//avc1.4d002a - main
/// avc1.42001E - baseline

export default class KasmVideoDecoder {
    constructor(display) {
        this._len = 0;
        this._keyFrame = 0;
        this._screenId = null;
        this._ctl = null;
        //this.codec = 0;
        this._display = display;

        //this._width = null;
        //this._height = null;

        this._timestamp = 0;
        this._timestampMap = new Map();
        this._decoders = new Map();
    }

    // ===== Public Methods =====


    decodeRect(x, y, width, height, sock, display, depth, frame_id) {
        if (this._ctl === null) {
            if (sock.rQwait("KasmVideo screen and compression-control", 2)) {
                return false;
            }

            this._screenId = sock.rQshift8();
            this._ctl = sock.rQshift8();

            // Figure out filter
            this._ctl = this._ctl >> 4;
        }

        let ret;

        if (this._ctl === 0x00) {
            ret = this._skipRect(x, y, width, height, sock, display, depth, frame_id);
        } else if ((this._ctl === 0x01) || (this._ctl === 0x02) || (this._ctl === 0x03)) {
            ret = this._processVideoFrameRect(this._screenId, this._ctl, x, y, width, height, sock, display, depth, frame_id);
        } else {
            throw new Error("Illegal KasmVideo compression received (ctl: " + this._ctl + ")");
        }

        if (ret) {
            this._ctl = null;
            this._screenId = null;
        }

        return ret;
    }

    resize(screen, codec, width, height) {
        this._updateSize(screen, codec, width, height);
    }

    // ===== Private Methods =====

    _configureDecoder(screen) {
        Log.Debug('Configuring decoder for screen: ', screen.id, ' codec: ', VIDEO_CODEC_NAMES[screen.codec], ' width: ', screen.width, ' height: ', screen.height);
        screen.decoder.configure({
            codec: VIDEO_CODEC_NAMES[screen.codec],
            codedWidth: screen.width,
            codedHeight: screen.height,
            optimizeForLatency: true,
        })
    }

    _updateSize(screen, codec, width, height) {
        Log.Debug('Updated size: ', {width, height});

        screen.width = width;
        screen.height = height;
        screen.codec = codec;

        this._configureDecoder(screen);
    }

    _skipRect(x, y, width, height, _sock, display, _depth, frame_id) {
        display.clearRect(x, y, width, height, 0, frame_id, false);
        return true;
    }

    _handleProcessVideoChunk(frame) {
        Log.Debug('Frame ', frame);
        const {screenId, frame_id, x, y, width, height} = this._timestampMap.get(frame.timestamp);
        Log.Debug('frame_id: ', frame_id, 'x: ', x, 'y: ', y, 'coded width: ', frame.codedWidth, 'coded height: ', frame.codedHeight);
        this._display.videoFrameRect(screenId, frame, frame_id, x, y, width, height);
        this._timestampMap.delete(frame.timestamp);
    }

    _processVideoFrameRect(screenId, codec, x, y, width, height, sock, display, depth, frame_id) {
        let [keyFrame, dataArr] = this._readData(sock);
        Log.Debug('Screen: ', screenId, ' key_frame: ', keyFrame);
        if (dataArr === null) {
            return false;
        }

        let screen;
        if (this._decoders.has(screenId)) {
            screen = this._decoders.get(screenId);
        } else {
            screen = {
                id: screenId,
                width: width,
                height: height,
                decoder: new VideoDecoder({
                    output: (frame) => {
                        this._handleProcessVideoChunk(frame);
                        // frame.close();
                    }, error: (e) => {
                        Log.Error(`There was an error inside KasmVideoDecoder`, e)
                    }
                })
            };
            Log.Debug('Created new decoder for screen: ', screenId);
            this._decoders.set(screenId, screen);
        }

        if (width !== screen.width && height !== screen.height || codec !== screen.codec)
            this._updateSize(screen, codec, width, height)

        const vidChunk = new EncodedVideoChunk({
            type: keyFrame ? 'key' : 'delta',
            data: dataArr,
            timestamp: this._timestamp,
        });

        Log.Debug('Type ', vidChunk.type, ' timestamp: ', vidChunk.timestamp, ' bytelength ', vidChunk.byteLength);

        this._timestampMap.set(this._timestamp, {
            screenId,
            frame_id,
            x,
            y,
            width,
            height
        });
        this._timestamp += FRAME_DURATION_US;

        try {
            screen.decoder.decode(vidChunk);
        } catch (e) {
            Log.Error('Screen: ', screenId,
                'Key frame ', keyFrame, ' frame_id: ', frame_id, ' x: ', x, ' y: ', y, ' width: ', width, ' height: ', height, ' codec: ', codec, ' ctl ', this._ctl, ' dataArr: ', dataArr, ' error: ', e);
            Log.Error('There was an error inside KasmVideoDecoder: ', e)
        }
        return true;
    }

    _readData(sock) {
        if (this._len === 0) {
            if (sock.rQwait("KasmVideo", 5)) {
                return [0, null];
            }

            this._keyFrame = sock.rQshift8();
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

        const data = sock.rQshiftBytes(this._len);
        const keyFrame = this._keyFrame;
        this._len = 0;
        this._keyFrame = 0;

        return [keyFrame, data];
    }

    dispose() {
        for (let screen of this._decoders.values()) {
            screen.decoder.close();
        }
    }
}
