/*
 * KasmVNC WebRTC video transport — browser side.
 *
 * Mirrors the legacy `_udpChannel` WebUDP path in rfb.js, but for the
 * libdatachannel-based server transport that ships HW-encoded video
 * over an RTCPeerConnection's video track. The browser is RECV-ONLY
 * for video; the server initiates the SDP offer.
 *
 * Failure modes that drop the session to image-mode fallback:
 *   - iceConnectionState === 'failed' || 'disconnected' for >5 s
 *   - SDP answer has no overlapping codec (m=video missing or
 *     `a=inactive`)
 *   - Browser refuses RTCPeerConnection construction
 *
 * In every fallback case we call rfb._sendUdpDowngrade() so the
 * server clears cp.supportsWebRTCMedia and resumes pushing
 * Tight/JPEG/WEBP rects over the WebSocket. The caller is
 * responsible for hiding the <video> element when that happens; the
 * canvas underneath takes over.
 *
 * Licensed under MPL 2.0.
 */

import * as Log from '../util/logging.js';
import WebRTCSignaling, { WebRTCSignalKind } from './webrtc_signaling.js';

const FALLBACK_GRACE_MS = 5000;

export default class WebRTCVideoTransport {
    constructor(rfb, sock, opts) {
        this._rfb = rfb;
        this._signaling = new WebRTCSignaling(sock);
        this._signaling.onMessage((kind, payload) => this._onSignal(kind, payload));

        this._opts = Object.assign({
            codecs: ['H264'],   // browser-preferred order
        }, opts || {});

        this._pc = null;
        this._video = null;
        this._failureTimer = null;
        this._negotiated = false;
        this._iceServers = [];

        // Public state mirrors rfb.js's existing transit-state semantics
        // so failure counters / UX don't need to learn a second model.
        this._state = 'idle';
    }

    get signaling() { return this._signaling; }
    get video()     { return this._video; }
    get state()     { return this._state; }

    // Called once by rfb.js when it decides to attempt WebRTC media for
    // this session. Sends kind=6 (capabilities); the server responds
    // with kind=4 (ICE servers) + kind=1 (SDP offer).
    start() {
        try {
            this._signaling.sendCapabilities(this._opts.codecs);
            this._state = 'negotiating';
        } catch (e) {
            Log.Error('WebRTC capability advertisement failed: ' + e);
            this._fallback('capabilities-send-failed');
        }
    }

    stop() {
        if (this._failureTimer) {
            clearTimeout(this._failureTimer);
            this._failureTimer = null;
        }
        if (this._pc) {
            try { this._pc.close(); } catch (e) {}
            this._pc = null;
        }
        if (this._video) {
            this._video.srcObject = null;
        }
        this._state = 'closed';
    }

    _onSignal(kind, payload) {
        switch (kind) {
            case WebRTCSignalKind.IceServers:
                this._iceServers = (payload || '').split('\n')
                    .map(s => s.trim()).filter(Boolean)
                    .map(url => ({ urls: url }));
                Log.Debug('WebRTC ICE servers: ' + JSON.stringify(this._iceServers));
                this._createPeerConnection();
                break;
            case WebRTCSignalKind.SdpOffer:
                this._handleOffer(payload);
                break;
            case WebRTCSignalKind.IceCandidate:
                this._handleRemoteIce(payload);
                break;
            case WebRTCSignalKind.Fallback:
                Log.Warn('Server signalled WebRTC fallback: ' + payload);
                this._fallback('server-' + payload);
                break;
            default:
                Log.Warn('Unknown WebRTC signal kind: ' + kind);
        }
    }

    _createPeerConnection() {
        if (typeof RTCPeerConnection === 'undefined') {
            this._fallback('no-rtcpeerconnection');
            return;
        }
        try {
            this._pc = new RTCPeerConnection({
                iceServers: this._iceServers,
                bundlePolicy: 'max-bundle',
            });
        } catch (e) {
            Log.Error('RTCPeerConnection construction failed: ' + e);
            this._fallback('pc-construct-failed');
            return;
        }

        // Recv-only transceiver so the SDP offer/answer aligns with the
        // server's send-only track. Without this, some browsers default
        // to recvrecv and the m-line direction mismatches.
        try {
            this._pc.addTransceiver('video', { direction: 'recvonly' });
        } catch (e) {
            Log.Warn('addTransceiver(video, recvonly) failed: ' + e +
                     ' — relying on browser default');
        }

        this._video = document.createElement('video');
        this._video.autoplay   = true;
        this._video.muted      = true;
        this._video.playsInline = true;

        this._pc.ontrack = (e) => {
            this._video.srcObject = e.streams && e.streams[0]
                ? e.streams[0]
                : new MediaStream([e.track]);
            this._state = 'connected';
            if (this._rfb._onWebRTCVideoReady) {
                this._rfb._onWebRTCVideoReady(this._video, this);
            }
        };

        this._pc.onicecandidate = (e) => {
            if (e.candidate) {
                this._signaling.sendIceCandidate(e.candidate.candidate,
                                                 e.candidate.sdpMid);
            }
        };

        this._pc.oniceconnectionstatechange = () => {
            const s = this._pc.iceConnectionState;
            Log.Debug('WebRTC iceConnectionState=' + s);
            if (s === 'failed' || s === 'disconnected') {
                if (!this._failureTimer) {
                    this._failureTimer = setTimeout(() => {
                        this._failureTimer = null;
                        // stop() can null _pc between the schedule and
                        // the fire (e.g. RFB.disconnect() during the
                        // 5 s grace window). Without this guard, the
                        // null-deref throws into the browser's event
                        // loop and shows up as a noisy console error
                        // during shutdown — masking real bugs.
                        if (!this._pc) return;
                        this._fallback('ice-' + this._pc.iceConnectionState);
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
        if (!this._pc) {
            // Server sent offer before ICE servers — be lenient and
            // construct the PC with an empty iceServers list.
            this._createPeerConnection();
            if (!this._pc) return;
        }
        try {
            await this._pc.setRemoteDescription({ type: 'offer', sdp });
            const answer = await this._pc.createAnswer();
            await this._pc.setLocalDescription(answer);

            // Codec-mismatch guard. If the answer has no m=video line
            // or marks it inactive, the browser refused all offered
            // codecs (e.g. HEVC-only server vs Firefox). Drop loudly
            // before any <video> renders a black frame.
            const sdpText = answer.sdp || '';
            if (!/^m=video /m.test(sdpText) || /^a=inactive/m.test(sdpText)) {
                Log.Error('SDP answer has no usable video m-line; falling back');
                this._fallback('codec-mismatch');
                return;
            }
            this._negotiated = true;
            this._signaling.sendAnswer(sdpText);
        } catch (e) {
            Log.Error('SDP offer handling failed: ' + e);
            this._fallback('sdp-failed');
        }
    }

    async _handleRemoteIce(payload) {
        if (!this._pc) return;
        const pipe = payload.indexOf('|');
        if (pipe < 0) {
            Log.Warn('Malformed ICE candidate from server: ' + payload);
            return;
        }
        const candidate = payload.substring(0, pipe);
        const sdpMid    = payload.substring(pipe + 1);
        try {
            await this._pc.addIceCandidate({ candidate, sdpMid });
        } catch (e) {
            Log.Warn('addIceCandidate failed: ' + e);
        }
    }

    _fallback(reason) {
        this._state = 'fallback';
        // A *pending* transport failing must not drag the live one
        // down with it. Tell the server to abandon just the pending
        // half (kind=5 'renegotiate' is a no-op for the live
        // transport server-side) and let rfb.js drop its pending slot.
        // The user stays on the old codec — strictly better than the
        // pre-smooth-switch behavior where any renegotiation failure
        // forced a full image-mode fallback.
        if (this._opts && this._opts.pending) {
            try { this._signaling.sendFallback('renegotiate'); } catch (e) {}
            if (this._rfb &&
                typeof this._rfb._abandonPendingWebRTCMedia === 'function') {
                this._rfb._abandonPendingWebRTCMedia('pending-failed:' + reason);
            }
            this.stop();
            return;
        }
        try { this._signaling.sendFallback(reason); } catch (e) {}
        // Re-use rfb.js's existing legacy fallback path so the server
        // clears cp.supportsWebRTCMedia exactly the way it clears
        // cp.supportsUdp today. Cursor / clipboard / input stay on
        // the WebSocket throughout — no user-visible interruption
        // beyond the canvas taking over from the (hidden) <video>.
        if (this._rfb && typeof this._rfb._sendUdpDowngrade === 'function') {
            this._rfb._sendUdpDowngrade();
        }
        if (this._rfb && typeof this._rfb._onWebRTCFallback === 'function') {
            this._rfb._onWebRTCFallback(reason);
        }
        this.stop();
    }
}
