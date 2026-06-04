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
import {perfLogger} from '../util/performance-logger.js';
import {VIDEO_CODEC_NAMES} from "../codecs";
import {encodings} from "../encodings.js";

//avc1.4d002a - main
/// avc1.42001E - baseline

export default class KasmVideoDecoder {
    constructor(rfb, display) {
        this._len = 0;
        this._keyFrame = 0;
        this._screenId = null;
        this._ctl = null;
        this._codecTypeId = 0;
        this._rfb = rfb;
        this._display = display;

        this._timestamp = 0;
        this._timestampMap = new Map();
        this._decoders = new Map();
        this._decoderRecovery = false;
        this._skippedFrames = 0;
    }

    // ===== Public Methods =====
    decodeRect(x, y, width, height, sock, display, depth, frameId) {
        if (this._ctl === null) {
            if (sock.rQwait("KasmVideo screen and compression-control", 2)) {
                return false;
            }

            this._screenId = sock.rQshift8();
            this._ctl = sock.rQshift8();

            // Figure out the filter
            this._ctl >>= 4;
        }

        let ret;

        if (this._ctl === 0x00) {
            ret = this._skipRect(x, y, width, height, sock, display, depth, frameId);
        } else if ((this._ctl === 0x01) || (this._ctl === 0x02) || (this._ctl === 0x03)) {
            ret = this._processVideoFrameRect(this._screenId, this._ctl, x, y, width, height, sock, display, depth, frameId);
        } else {
            throw new Error("Illegal KasmVideo compression received (ctl: " + this._ctl + ")");
        }

        if (ret) {
            this._ctl = null;
            this._screenId = null;
        }

        return ret;
    }

    // ===== Private Methods =====
    _configureDecoder(screen, codec, codecTypeId) {
        screen.codec = codec;
        screen.codecTypeId = codecTypeId;

        Log.Debug('Configuring decoder for screen: ', screen.id, ' codec: ', VIDEO_CODEC_NAMES[codec], ' width: ', screen.width, ' height: ', screen.height);

        const config = {
            codec: VIDEO_CODEC_NAMES[codec],
            displayAspectWidth: screen.width,
            displayAspectHeight: screen.height,
            optimizeForLatency: true,
            hardwareAcceleration: codecTypeId === encodings.pseudoEncodingStreamingModeAVCNVENC ? 'prefer-software' : 'no-preference',
        };

        Log.Debug('Applying decoder config: ', config);

        try {
            screen.decoder.configure(config);
        } catch (e) {
            Log.Error('Failed to configure decoder: ', e, 'config:', config);
            this._handleDecoderError();
        }
    }

    _updateSize(screen, width, height) {
        Log.Debug('Updated size: ', {width, height});

        screen.width = width;
        screen.height = height;
    }

    _skipRect(x, y, width, height, _sock, display, _depth, frameId) {
        display.clearRect(x, y, width, height, 0, frameId, false);
        return true;
    }

    _handleProcessVideoChunk(frame) {
        // End video decode timing
        const decodeTime = performance.now() - this._decodingStartedTime;
        perfLogger.end('videoDecode', this._decodingStartedTime);

        Log.Debug('Frame ', frame, ' - Video frame processing time: ', decodeTime);
        const metadata = this._timestampMap.get(frame.timestamp);
        if (!metadata) {
            Log.Warn('No metadata found for timestamp: ', frame.timestamp);
            frame.close();
            return;
        }
        const {screenId, frameId, x, y, width, height} = metadata;
        Log.Debug('frameId: ', frameId, 'x: ', x, 'y: ', y, 'coded width: ', frame.codedWidth, 'coded height: ', frame.codedHeight);
        this._display.videoFrameRect(screenId, frame, frameId, x, y, width, height);
        this._timestampMap.delete(frame.timestamp);
    }

    _handleDecoderError() {
        Log.Error('Decoder error triggered - clearing all decoders and switching to image mode');
        // We need to reset the decoders
        this._decoders.clear();
        this._rfb.dispatchEvent(new CustomEvent('imagemode'));
    }

    _processVideoFrameRect(screenId, codec, x, y, width, height, sock, display, depth, frameId) {
        let [keyFrame, codecTypeId, dataArr] = this._readData(sock);
        Log.Debug('Screen: ', screenId, ' key_frame: ', keyFrame);
        if (dataArr === null) {
            return false;
        }

        if (this._decoderRecovery && !keyFrame) {
            ++this._skippedFrames;

            if (this._skippedFrames <= this._rfb.gop)
                return true;

            // Just switch to image mode
            this._skippedFrames = 0;
            this._decoderRecovery = false;
            this._handleDecoderError();

            return true;
        }

        // Fast path: secondary screen with a direct MessagePort.
        // Transfer the raw encoded bytes (zero-copy ArrayBuffer) and skip local decode entirely.
        if (screenId !== 0) {
            const targetScreen = this._display._screens[screenId];
            if (targetScreen?.encodedFramePort) {
                const buffer = dataArr.buffer.slice(
                    dataArr.byteOffset, dataArr.byteOffset + dataArr.byteLength);
                // Translate from global VNC framebuffer coordinates to screen-local coordinates.
                const localX = x - targetScreen.x;
                const localY = y - targetScreen.y;
                targetScreen.encodedFramePort.postMessage({
                    type: 'encoded_frame',
                    codec: VIDEO_CODEC_NAMES[codec],
                    keyFrame: !!keyFrame,
                    streamMode: codecTypeId,
                    data: buffer,
                    x: localX, y: localY, width, height, frameId
                }, [buffer]);
                // Push a null-frame placeholder so the primary's async queue rect count
                // stays correct. Without this the primary frame never reaches its expected
                // rect count and stalls, showing characters one keystroke late.
                display.enqueueVideoFrameRect(screenId, frameId, x, y, width, height);
                return true;
            }
        }

        let screen;
        if (this._decoders.has(screenId)) {
            screen = this._decoders.get(screenId);
            if (screen.decoder.state === 'closed' && !this._decoderRecovery) {
                this._decoderRecovery = true;
                this._decoders.delete(screenId);
                this._rfb._requestFullRefresh();

                return true;
            }
        } else {
            screen = {
                id: screenId,
                width: width,
                height: height,
                decoder: new VideoDecoder({
                    output: (frame) => {
                        try {
                            this._handleProcessVideoChunk(frame);
                        } catch (e) {
                            Log.Error(`Error in _handleProcessVideoChunk: `, e);
                            frame.close();
                        }
                    }, error: (e) => {
                        Log.Error('FATAL VideoDecoder error:', {
                            message: e.message,
                            name: e.name,
                            decoderState: screen.decoder.state
                        });
                        this._handleDecoderError();
                    }
                })
            };
            Log.Debug('Created new decoder for screen: ', screenId);
            this._decoders.set(screenId, screen);
        }

        if (width !== screen.width || height !== screen.height) {
            this._updateSize(screen, width, height);
            this._configureDecoder(screen, codec, codecTypeId);
        }

        // Receiving last frames after the switch
        if (codec !== screen.codec || codecTypeId !== screen.codecTypeId || screen.codecTypeId !== this._rfb.streamMode) {
            if (!keyFrame)
                return true;

            this._configureDecoder(screen, codec, codecTypeId);
        }

        const vidChunk = new EncodedVideoChunk({
            type: keyFrame ? 'key' : 'delta',
            data: dataArr,
            timestamp: ++this._timestamp,
        });

        Log.Debug('Type ', vidChunk.type, ' timestamp: ', vidChunk.timestamp, ' bytelength ', vidChunk.byteLength);

        this._timestampMap.set(this._timestamp, {
            screenId,
            frameId,
            x,
            y,
            width,
            height
        });

        try {
            // Start video decode timing
            this._decodingStartedTime = perfLogger.start('videoDecode');
            screen.decoder.decode(vidChunk);

            if (this._decoderRecovery) {
                this._skippedFrames = 0;
                this._decoderRecovery = false;
            }
        } catch (e) {
            Log.Error('DECODE FAILURE - Screen: ', screenId,
                'Key frame ', keyFrame, ' frame_id: ', frameId,
                ' x: ', x, ' y: ', y, ' width: ', width, ' height: ', height,
                ' codec: ', codec, ' codec_string: ', VIDEO_CODEC_NAMES[codec],
                ' decoder_state: ', screen.decoder.state,
                ' error: ', e);

            this._handleDecoderError();
        }
        return true;
    }

    _readCompact(sock) {
        let byte = sock.rQshift8();
        let length = byte & 0x7f;
        if (byte & 0x80) {
            byte = sock.rQshift8();
            length |= (byte & 0x7f) << 7;
            if (byte & 0x80) {
                byte = sock.rQshift8();
                length |= byte << 14;
            }
        }
        return length;
    }

    _readData(sock) {
        if (this._len === 0) {
            if (sock.rQwait("KasmVideo", 5)) {
                return [0, 0, null];
            }
            // Start frame read timing
            this._readTime = perfLogger.start('frameRead');

            this._codecTypeId = encodings.pseudoEncodingStreamingModeJpegWebp - sock.rQshift8();
            this._keyFrame = sock.rQshift8();
            this._len = this._readCompact(sock);
        }

        if (sock.rQwait("KasmVideo", this._len)) {
            return [0, 0, null];
        }

        const data = sock.rQshiftBytes(this._len);
        const keyFrame = this._keyFrame;
        const codecTypeId = this._codecTypeId;

        this._len = 0;
        this._keyFrame = 0;
        this._codecTypeId = 0;

        // End frame read timing
        perfLogger.end('frameRead', this._readTime);
        this._readTime = 0;
        return [keyFrame, codecTypeId, data];
    }

    dispose() {
        for (let screen of this._decoders.values()) {
            screen.decoder.close();
        }
        this._decoders.clear();

        for (let timestamp of this._timestampMap.keys()) {
            this._timestampMap.delete(timestamp);
        }
    }
}
