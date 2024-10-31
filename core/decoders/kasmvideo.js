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

var testCanvas = null;
var testCtx = null;
var drawX = 0;
var drawY = 0;

// ===== Worker init =====

var workerScript = URL.createObjectURL( new Blob([ '(',
function(){
    var decoder = new VideoDecoder({
        output: handleChunk,
        error: e => {
            console.log(e.message);
        }   
    });
    function handleChunk(chunk, metadata) {
        postMessage({frame: chunk}, [chunk]);
    }

    self.addEventListener('message', function(event) {
        if (event.data.hasOwnProperty('frame')) {
            let vidChunk = new EncodedVideoChunk({
                type: event.data.frame.type,
                data: event.data.frame.data,
                timestamp: 1,
                duration: 0
            })
            event.data.frame.data = null;
            decoder.decode(vidChunk);
            // Send data back for garbage collection
            postMessage({freemem: event.data.frame.data});
            event.data.frame.data = null;
        }
        if (event.data.hasOwnProperty('config')) {
            if (decoder.state == "unconfigured") {
                decoder.configure({
                    codec: "vp8",
                    width: event.data.config.width,
                    height: event.data.config.height,
                    optimizeForLatency: true
                });
            }
        }
    });
}.toString(),
')()' ], { type: 'application/javascript' } ) ), worker = new Worker(workerScript);
URL.revokeObjectURL(workerScript);

// Worker returns
worker.onmessage = function (event) {
    // Plug memory leaks by sending transferable objects back to main thread
    if (event.data.hasOwnProperty('freemem')) {
        event.data.freemem = null;
    }
    // Render video frames to canvas
    if (event.data.hasOwnProperty('frame')) {
        testCtx.drawImage(event.data.frame, 0, 0);
        event.data.frame.close();
    }
};

// ===== Functions =====

export default class KasmVideoDecoder {
    constructor(display) {
        this._len = 0;
        this._ctl = null;
        this._displayGlobal = display;
    }

    // ===== Test Canvas rendering operation =====

    _copyCanvas() {
        if (testCtx) {
            let width = testCanvas.width;
            let height = testCanvas.height;
            drawX++;
            drawY++;
            if (drawX == (width - 500)) {
                drawX = 0;
            }
            if (drawY == (height - 500)) {
                drawY = 0;
            }
            let imgData = testCtx.getImageData(drawX, drawY, 500, 500);
            this._displayGlobal.putImage(imgData, drawX, drawY);
        }
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

        if (! testCanvas) {
            testCanvas = document.createElement('canvas');
            testCanvas.width = width;
            testCanvas.height = height;
            testCtx = testCanvas.getContext("2d", { willReadFrequently: true })
            worker.postMessage({ config: {width: width,height: height} });
        }

        let data = this._readData(sock);
        if (data === null) {
            return false;
        }

        let type = data[0] ? "key" : "delta";
        let vidData = data.slice(1).buffer;
        data = null;
        worker.postMessage({ frame: {data: vidData, type: type} }, [vidData]);
        this._copyCanvas();
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
