/*
 * KasmVNC: HTML5 VNC client
 * Copyright (C) 2020 Kasm Technologies
 * Licensed under MPL 2.0 (see LICENSE.txt)
 *
 * See README.md for usage and integration instructions.
 *
 */

import Inflator from "../inflator.js";
import { hashUInt8Array } from '../util/int.js';

// The DLP watermark: a 4 byte colour followed by zlib compressed 4 bit alpha pairs
export default class TransparentDecoder {
    constructor() {
        this._lastRectHash = '';
        this._lastRectInfo = '';
        this._zlib = new Inflator();
    }

    decode(x, y, width, height, payload, display, frame_id) {
        //filter out consecutive redundant data
        const h = hashUInt8Array(payload);
        const info = `${x}.${y}.${width}.${height}`;
        if (h === this._lastRectHash && info === this._lastRectInfo) {
            display.dummyRect(x, y, width, height, frame_id);
            return;
        }

        const r = payload[0];
        const g = payload[1];
        const b = payload[2];
        const a = payload[3];

        const uncompressedSize = Math.floor(width * height / 2 + 1);

        this._zlib.reset();
        this._zlib.setInput(payload.slice(4));
        const alphas = this._zlib.inflate(uncompressedSize);
        this._zlib.setInput(null);

        // unpack
        const rgba = new Uint8Array(width * height * 4 + 4);
        for (let i = 0, d = 0; i < uncompressedSize; i++, d += 8) {
            const p = alphas[i];

            rgba[d + 0] = r;
            rgba[d + 1] = g;
            rgba[d + 2] = b;
            rgba[d + 3] = a * ((p & 15) << 4) / 255;

            rgba[d + 4] = r;
            rgba[d + 5] = g;
            rgba[d + 6] = b;
            rgba[d + 7] = a * (p & 240) / 255;
        }

        const img = new ImageData(new Uint8ClampedArray(rgba.buffer, 0, width * height * 4), width, height);
        display.transparentRect(x, y, width, height, img, frame_id, h);
        this._lastRectHash = h;
        this._lastRectInfo = info;
    }
}
