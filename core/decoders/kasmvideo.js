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

var videoCanvas = null;
var offscreen = null;
var drawX = 0;
var drawY = 0;

// ===== Worker init =====

var workerScript = URL.createObjectURL( new Blob([ '(',
function(){
    var canvas;
    var ctx;
    var decoder = new VideoDecoder({
        output: handleChunk,
        error: e => {
            console.log(e.message);
        }   
    });
    function handleChunk(chunk, metadata) {
        ctx.drawImage(chunk,0,0);
        chunk.close();
    }

    self.addEventListener('message', function(event) {
        if (event.data.hasOwnProperty('canvas')) {
            canvas = event.data.canvas;
            ctx = canvas.getContext("2d");
        }
        if (event.data.hasOwnProperty('frame')) {
            let vidChunk = new EncodedVideoChunk({
                type: event.data.frame.type,
                data: event.data.frame.data,
                timestamp: 1,
                duration: 0
            })
            event.data.frame.data = null;
            try {
                decoder.decode(vidChunk);
            } catch (e) {
                console.log(e);
            }
            // Send data back for garbage collection
            postMessage({freemem: event.data.frame.data});
        }
        if (event.data.hasOwnProperty('config')) {
            decoder.configure({
                codec: "vp8",
                width: event.data.config.width,
                height: event.data.config.height,
                optimizeForLatency: true
            });
        }
    });
}.toString(),
')()' ], { type: 'application/javascript' } ) ), worker = new Worker(workerScript);
URL.revokeObjectURL(workerScript);

// Plug memory leaks by sending transferable objects to main thread
worker.onmessage = function (event) {
    if (event.data.hasOwnProperty('freemem')) {
        event.data.freemem = null;
    }
};

// ===== Functions =====

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

    resize(width, height) {
        this._setupCanvas(width, height, true);
        worker.postMessage({ config: {width: width,height: height} });
    }

    // ===== Private Methods =====

    _skipRect(x, y, width, height, sock, display, depth, frame_id) {
        display.clearRect(x, y, width, height);

        return true;
    }

    _setupCanvas(width, height, destroy) {
        if ((! offscreen) || (destroy)) {
            try {
                videoCanvas.remove();
            } catch (e) {
                console.log(e);
            }
            videoCanvas = null;
            offscreen = null;
            videoCanvas = document.createElement('canvas');
            videoCanvas.width = width;
            videoCanvas.height = height;
            videoCanvas.style.position = 'absolute';
            videoCanvas.style.top = '0px';
            videoCanvas.style.left = '0px';
            videoCanvas.style.zIndex = "1";
            offscreen = videoCanvas.transferControlToOffscreen();
            worker.postMessage({ canvas: offscreen }, [offscreen]);
            worker.postMessage({ config: {width: width,height: height} });
            document.body.appendChild(videoCanvas);
        }
    }

    _vp8Rect(x, y, width, height, sock, display, depth, frame_id) {

        this._setupCanvas(width, height, false);
        let data = this._readData(sock);
        if (data === null) {
            return false;
        }

        let type = data[0] ? "key" : "delta";
        let vidData = data.slice(1).buffer;
        data = null;
        worker.postMessage({ frame: {data: vidData, type: type} }, [vidData]);
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
