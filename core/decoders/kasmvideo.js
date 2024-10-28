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
        this._ctl = 0;
        this._displayGlobal = display;
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

    _skipRect(x, y, width, height, sock, display, depth, frame_id) {
        console.log("Received a KasmVideo skiprect");

        return true;
    }

    _vp8Rect(x, y, width, height, sock, display, depth, frame_id) {
        let data = this._readData(sock);
        if (data === null) {
            return false;
        }

        console.log("Received a KasmVideo vp8 rect, size " + data.length);

        // the first byte specifies if this is a keyframe
        // after that it's the VP8 frame
        /*const init = {
            type: data[0] ? "key" : "delta",
            data: data + 1,
            timestamp: 0,
            duration: 1,
        };
        chunk = new EncodedVideoChunk(init);*/

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
}
