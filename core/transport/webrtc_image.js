/*
 * KasmVNC image-mode transport — browser side.
 *
 * Receives image-mode rects (Tight/JPEG/WebP) on an unordered, unreliable
 * RTCDataChannel so a lost packet never blocks newer frames. Owns a
 * DataChannel-only RTCPeerConnection, never active alongside
 * WebRTCVideoTransport. The server offers; signaling uses WEBRTC_IMAGE_SCREEN.
 *
 * Message framing (little-endian u32): id | index | pieces | frame | payload.
 * Pieces of one server flush share an id. Incomplete messages are discarded
 * and reported via onLoss so rfb.js can request a full refresh.
 *
 * Licensed under MPL 2.0.
 */

import * as Log from '../util/logging.js';
import { WebRTCSignalKind } from './webrtc_signaling.js';

export const IMAGE_CHANNEL_HEADER_SIZE = 16;

const FALLBACK_GRACE_MS = 5000;
const PARTIAL_TTL_MS = 500;
const GAP_TTL_MS = 500;
const LOSS_CHECK_INTERVAL_MS = 250;
const MAX_PIECES = 65536;

export default class WebRTCImageTransport {
    // onRect(u8, frame): one complete rect or LastRect message.
    // onLoss(): a message was lost or abandoned.
    constructor(rfb, signaling, iceServers, onRect, onLoss) {
        this._rfb = rfb;
        this._signaling = signaling;
        this._signaling.onMessage((kind, payload) => this._onSignal(kind, payload));
        this._iceServers = iceServers || [];
        this._onRect = onRect;
        this._onLoss = onLoss;

        this._pc = null;
        this._channel = null;
        this._failureTimer = null;
        this._lossTimer = null;
        this._closed = false;
        this._open = false;

        this._remoteDescriptionSet = false;
        this._pendingRemoteCandidates = [];

        this._partials = new Map();   // id -> {total, got, bytes, parts, t, frame}
        // Ids are contiguous, so a persistent hole means a lost message.
        this._nextId = null;
        this._completedAhead = new Set();
        this._gapSince = 0;
    }

    get isOpen() { return this._open; }
    get signaling() { return this._signaling; }

    // The ICE list arrives after construction, before the offer.
    setIceServers(iceServers) { this._iceServers = iceServers || []; }

    stop() {
        this._closed = true;
        this._open = false;
        if (this._failureTimer) { clearTimeout(this._failureTimer); this._failureTimer = null; }
        if (this._lossTimer) { clearInterval(this._lossTimer); this._lossTimer = null; }
        if (this._channel) {
            this._channel.onmessage = null;
            this._channel.onopen = null;
            this._channel.onclose = null;
            this._channel.onerror = null;
            try { this._channel.close(); } catch (e) {}
            this._channel = null;
        }
        if (this._pc) {
            try { this._pc.close(); } catch (e) {}
            this._pc = null;
        }
        this._partials.clear();
        this._completedAhead.clear();
    }

    _onSignal(kind, payload) {
        switch (kind) {
            case WebRTCSignalKind.SdpOffer:
                this._handleOffer(payload);
                break;
            case WebRTCSignalKind.IceCandidate:
                this._handleRemoteIce(payload);
                break;
            case WebRTCSignalKind.Fallback:
            case WebRTCSignalKind.Close:
                Log.Warn('Server dropped the image DataChannel: ' + payload);
                this._fail('server-' + payload, /*silent=*/true);
                break;
            default:
                Log.Warn('Unknown image-channel signal kind: ' + kind);
        }
    }

    _createPeerConnection() {
        if (typeof RTCPeerConnection === 'undefined') {
            this._fail('no-rtcpeerconnection');
            return;
        }
        try {
            this._pc = new RTCPeerConnection({ iceServers: this._iceServers });
        } catch (e) {
            Log.Error('Image-channel RTCPeerConnection construction failed: ' + e);
            this._fail('pc-construct-failed');
            return;
        }

        this._pc.ondatachannel = (e) => {
            const ch = e.channel;
            ch.binaryType = 'arraybuffer';
            this._channel = ch;
            ch.onopen = () => {
                this._open = true;
                Log.Info('Image DataChannel open');
                this._lossTimer = setInterval(() => this._checkLoss(),
                                              LOSS_CHECK_INTERVAL_MS);
                if (this._rfb && this._rfb._onImageChannelOpen) {
                    this._rfb._onImageChannelOpen();
                }
            };
            ch.onclose = () => {
                if (!this._closed) this._fail('channel-closed');
            };
            ch.onerror = (err) => {
                Log.Error('Image DataChannel error: ' + (err && err.message));
            };
            ch.onmessage = (ev) => this._onMessage(ev.data);
        };

        this._pc.onicecandidate = (e) => {
            if (e.candidate) {
                this._signaling.sendIceCandidate(e.candidate.candidate,
                                                 e.candidate.sdpMid);
            }
        };

        this._pc.oniceconnectionstatechange = () => {
            if (!this._pc) return;
            const s = this._pc.iceConnectionState;
            if (s === 'failed' || s === 'disconnected') {
                if (!this._failureTimer) {
                    this._failureTimer = setTimeout(() => {
                        this._failureTimer = null;
                        if (!this._pc) return;
                        this._fail('ice-' + this._pc.iceConnectionState);
                    }, FALLBACK_GRACE_MS);
                }
            } else if (s === 'connected' || s === 'completed') {
                if (this._failureTimer) {
                    clearTimeout(this._failureTimer);
                    this._failureTimer = null;
                }
            }
        };
    }

    async _handleOffer(sdp) {
        if (this._closed) return;
        if (!this._pc) {
            this._createPeerConnection();
            if (!this._pc) return;
        }
        try {
            await this._pc.setRemoteDescription({ type: 'offer', sdp });
            this._remoteDescriptionSet = true;
            const buffered = this._pendingRemoteCandidates;
            this._pendingRemoteCandidates = [];
            for (const c of buffered) this._addRemoteCandidate(c.candidate, c.sdpMid);

            const answer = await this._pc.createAnswer();
            await this._pc.setLocalDescription(answer);
            this._signaling.sendAnswer(answer.sdp || '');
        } catch (e) {
            Log.Error('Image-channel SDP offer handling failed: ' + e);
            this._fail('sdp-failed');
        }
    }

    _handleRemoteIce(payload) {
        const pipe = payload.indexOf('|');
        if (pipe < 0) {
            Log.Warn('Malformed ICE candidate from server: ' + payload);
            return;
        }
        const candidate = payload.substring(0, pipe);
        const sdpMid = payload.substring(pipe + 1);
        // Buffer until setRemoteDescription resolves.
        if (!this._pc || !this._remoteDescriptionSet) {
            this._pendingRemoteCandidates.push({ candidate, sdpMid });
            return;
        }
        this._addRemoteCandidate(candidate, sdpMid);
    }

    async _addRemoteCandidate(candidate, sdpMid) {
        if (!this._pc) return;
        try {
            await this._pc.addIceCandidate({ candidate, sdpMid });
        } catch (e) {
            Log.Warn('Image-channel addIceCandidate failed: ' + e);
        }
    }

    // ---- DataChannel receive path ----

    _onMessage(buf) {
        if (this._closed || !(buf instanceof ArrayBuffer) ||
            buf.byteLength < IMAGE_CHANNEL_HEADER_SIZE) {
            return;
        }
        const dv = new DataView(buf);
        const id     = dv.getUint32(0, true);
        const index  = dv.getUint32(4, true);
        const pieces = dv.getUint32(8, true);
        const frame  = dv.getUint32(12, true);

        if (pieces === 0 || pieces > MAX_PIECES || index >= pieces) {
            Log.Warn('Discarding malformed image-channel piece (id=' + id +
                     ', index=' + index + ', pieces=' + pieces + ')');
            return;
        }

        if (pieces === 1) {
            // Copy: decoders need a zero-offset array (they use .buffer).
            this._complete(id, frame,
                new Uint8Array(buf.slice(IMAGE_CHANNEL_HEADER_SIZE)));
            return;
        }

        const payload = new Uint8Array(buf, IMAGE_CHANNEL_HEADER_SIZE);

        let p = this._partials.get(id);
        if (!p) {
            p = { total: pieces, got: 0, bytes: 0,
                  parts: new Array(pieces), t: Date.now(), frame };
            this._partials.set(id, p);
        }
        // Duplicate or inconsistent piece: ignore rather than double-count.
        if (index >= p.total || p.parts[index] !== undefined) return;
        p.parts[index] = payload;
        p.got++;
        p.bytes += payload.length;

        if (p.got === p.total) {
            this._partials.delete(id);
            const whole = new Uint8Array(p.bytes);
            let off = 0;
            for (const part of p.parts) {
                whole.set(part, off);
                off += part.length;
            }
            this._complete(id, p.frame, whole);
        }
    }

    _complete(id, frame, bytes) {
        if (this._nextId === null) {
            this._nextId = id + 1;
        } else if (id === this._nextId) {
            this._nextId++;
            while (this._completedAhead.delete(this._nextId)) this._nextId++;
            if (this._completedAhead.size === 0) this._gapSince = 0;
        } else if (((id - this._nextId) >>> 0) < 0x80000000) {
            this._completedAhead.add(id);
            if (!this._gapSince) this._gapSince = Date.now();
        }
        // Late arrival for an id already given up on is still rendered.

        this._onRect(bytes, frame);
    }

    // Abandons stale partials and persistent id gaps, reporting each as a loss.
    _checkLoss() {
        const now = Date.now();
        let lost = false;

        for (const [id, p] of this._partials) {
            if (now - p.t > PARTIAL_TTL_MS) {
                this._partials.delete(id);
                lost = true;
            }
        }

        if (this._gapSince && now - this._gapSince > GAP_TTL_MS) {
            let min = null;
            for (const id of this._completedAhead) {
                if (min === null || ((id - min) >>> 0) >= 0x80000000) min = id;
            }
            if (min !== null) {
                this._nextId = min + 1;
                this._completedAhead.delete(min);
                while (this._completedAhead.delete(this._nextId)) this._nextId++;
            }
            this._gapSince = this._completedAhead.size ? now : 0;
            lost = true;
        }

        if (lost && this._onLoss) this._onLoss();
    }

    // silent: don't echo a fallback the server already sent.
    _fail(reason, silent) {
        if (this._closed) return;
        if (!silent) {
            try { this._signaling.sendFallback(reason); } catch (e) {}
        }
        const rfb = this._rfb;
        this.stop();
        if (rfb && typeof rfb._onImageChannelFallback === 'function') {
            rfb._onImageChannelFallback(this, reason);
        }
    }
}
