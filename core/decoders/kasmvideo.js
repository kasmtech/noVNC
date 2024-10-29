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
import Inflator from "../inflator.js";
import { hashUInt8Array } from '../util/int.js';

export default class KasmVideoDecoder {
    constructor(display) {
        this._len = 0;
        this._ctl = null;
        this._displayGlobal = display;
        this.frameCount = 0;
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
            ret = this._skipRect(x, y, width, height,
                                 sock, display, depth, frame_id);
        } else if (this._ctl === 0x01) {
            ret = this._vp8Rect(x, y, width, height,
                                 sock, display, depth, frame_id);
        } else {
            throw new Error("Illegal KasmVideo compression received (ctl: " +
                                   this._ctl + ")");
        }

        if (ret) {
            this._ctl = null;
        }

        return ret;
    }

    // ===== Private Methods =====

    _decoder = new VideoDecoder({
        output: this._handleChunk,
        error: e => {
            console.log(e.message);
        }
    });

    _skipRect(x, y, width, height, sock, display, depth, frame_id) {
        console.log("Received a KasmVideo skiprect");

        return true;
    }

    _vp8Rect(x, y, width, height, sock, display, depth, frame_id) {

        if (this._decoder.state == "unconfigured") {
            this._decoder.configure({
                codec: "vp8",
                width: width,
                height: height,
                optimizeForLatency: true
            });
        }
        
        let data = this._readData(sock);
        if (data === null) {
            return false;
        }

        let type = data[0] ? "key" : "delta";
        let vidData = data.slice(1).buffer;
        let vidChunk = new EncodedVideoChunk({
            type: type,
            data: vidData,
            timestamp: 1,
            duration: 0
        })
        data = null;
        vidData = null;
        this._decoder.decode(vidChunk);
        return true;
    }

    _readData(sock) {
        if (this._len === 0) {
            if (sock.rQwait("KasmVideo", 3)) {
                return null;
            }

            let byte;

            byte = sock.rQshift8();
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
            return null;
        }

        let data = sock.rQshiftBytes(this._len);
        this._len = 0;

        return data;
    }

    _handleChunk(chunk, metadata) {
        chunk.close();
    }

}
