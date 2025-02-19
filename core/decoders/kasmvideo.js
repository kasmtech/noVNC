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
        display.clearRect(x, y, width, height, 0, frame_id, false);
        return true;
    }
}

