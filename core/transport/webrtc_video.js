/*
 * KasmVNC WebRTC video transport — browser side, one per X screen.
 *
 * Multi-monitor sessions run one RTCPeerConnection per screen (see
 * doc/MULTI_MONITOR_WEBRTC_PLAN.md). Each instance owns exactly one
 * screen's PC + <video>, and is RECV-ONLY (the server initiates the SDP
 * offer per screen). Instances are created *reactively* by rfb.js when a
 * per-screen SdpOffer arrives — the client does not send capabilities or
 * offers from here; rfb.js advertises capability once for the session and
 * the server replies with one offer per screen.
 *
 * Signaling is decoupled from the WebSocket: the WebRTCSignaling passed
 * in carries a sink that routes outbound answers/ICE either straight to
 * the socket (when this transport runs in the window that owns the
 * server's WebSocket — the primary) or over the SharedWorker relay port
 * (when this transport runs in a secondary window that displays the
 * screen). Either way the transport code is identical.
 *
 * Failure modes that drop *this screen* to image/WebSocket-video:
 *   - iceConnectionState === 'failed' || 'disconnected' for >5 s
 *   - SDP answer has no overlapping codec (m=video missing / a=inactive)
 *   - Browser refuses RTCPeerConnection construction
 *
 * Licensed under MPL 2.0.
 */

import * as Log from '../util/logging.js';
import { WebRTCSignalKind } from './webrtc_signaling.js';

const FALLBACK_GRACE_MS = 5000;

export default class WebRTCVideoTransport {
    // signaling: a WebRTCSignaling already bound to `screenId` and an
    //            outbound sink (socket or relay port).
    // opts.iceServers: [{urls}] list from the session-level kind=4 signal.
    // opts.pending:    true when this is a smooth codec-switch transport
    //                  that replaces an existing live one on `playing`.
    constructor(rfb, screenId, signaling, opts) {
        this._rfb = rfb;
        this._screenId = screenId;
        this._signaling = signaling;
        this._signaling.onMessage((kind, payload) => this._onSignal(kind, payload));

        this._opts = Object.assign({ pending: false, iceServers: [] }, opts || {});

        this._pc = null;
        this._video = null;
        this._failureTimer = null;
        this._negotiated = false;
        this._iceServers = this._opts.iceServers || [];

        // Mirrors rfb.js's transit-state semantics so failure counters /
        // UX don't need to learn a second model.
        this._state = 'idle';
    }

    get screenId() { return this._screenId; }
    get signaling() { return this._signaling; }
    get video()     { return this._video; }
    get state()     { return this._state; }
    get pending()   { return !!this._opts.pending; }

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
            if (this._video.parentNode) {
                this._video.parentNode.removeChild(this._video);
            }
        }
        this._state = 'closed';
    }

    _onSignal(kind, payload) {
        switch (kind) {
            case WebRTCSignalKind.SdpOffer:
                this._handleOffer(payload);
                break;
            case WebRTCSignalKind.IceCandidate:
                this._handleRemoteIce(payload);
                break;
            case WebRTCSignalKind.Close:
                Log.Info('Server closed WebRTC screen ' + this._screenId +
                         ': ' + payload);
                // The screen left the layout (or its negotiation was
                // rejected). Drop the PC; the owning window falls back to
                // its WebSocket/encoded-frame decode path for this screen.
                this._fallback('server-close:' + payload, /*silent=*/true);
                break;
            case WebRTCSignalKind.Fallback:
                Log.Warn('Server signalled WebRTC fallback (screen ' +
                         this._screenId + '): ' + payload);
                this._fallback('server-' + payload, /*silent=*/true);
                break;
            default:
                Log.Warn('Unknown WebRTC signal kind for screen ' +
                         this._screenId + ': ' + kind);
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
            Log.Error('RTCPeerConnection construction failed (screen ' +
                      this._screenId + '): ' + e);
            this._fallback('pc-construct-failed');
            return;
        }

        // Recv-only transceiver so the answer aligns with the server's
        // send-only track.
        try {
            this._pc.addTransceiver('video', { direction: 'recvonly' });
        } catch (e) {
            Log.Warn('addTransceiver(video, recvonly) failed: ' + e +
                     ' — relying on browser default');
        }

        this._video = document.createElement('video');
        this._video.autoplay    = true;
        this._video.muted       = true;
        this._video.playsInline = true;

        this._pc.ontrack = (e) => {
            Log.Info('[WEBRTC-DIAG] ontrack screen ' + this._screenId +
                     ' (streams=' + (e.streams ? e.streams.length : 0) + ')');
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
            Log.Info('[WEBRTC-DIAG] screen ' + this._screenId +
                     ' iceConnectionState=' + s);
            if (s === 'failed' || s === 'disconnected') {
                if (!this._failureTimer) {
                    this._failureTimer = setTimeout(() => {
                        this._failureTimer = null;
                        // stop() can null _pc between schedule and fire.
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
        Log.Info('[WEBRTC-DIAG] offer received screen ' + this._screenId +
                 ' (' + (sdp ? sdp.length : 0) + ' bytes)');
        if (!this._pc) {
            this._createPeerConnection();
            if (!this._pc) return;
        }
        try {
            await this._pc.setRemoteDescription({ type: 'offer', sdp });
            const answer = await this._pc.createAnswer();
            await this._pc.setLocalDescription(answer);

            // Codec-mismatch guard: no usable video m-line means the
            // browser refused every offered codec (e.g. HEVC-only server
            // vs Firefox). Drop this screen loudly before a black frame.
            const sdpText = answer.sdp || '';
            if (!/^m=video /m.test(sdpText) || /^a=inactive/m.test(sdpText)) {
                Log.Error('SDP answer for screen ' + this._screenId +
                          ' has no usable video m-line; falling back');
                this._fallback('codec-mismatch');
                return;
            }
            this._negotiated = true;
            Log.Info('[WEBRTC-DIAG] answer sent screen ' + this._screenId);
            this._signaling.sendAnswer(sdpText);
        } catch (e) {
            Log.Error('SDP offer handling failed (screen ' +
                      this._screenId + '): ' + e);
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
            Log.Warn('addIceCandidate failed (screen ' +
                     this._screenId + '): ' + e);
        }
    }

    // Drop this screen's PC. `silent` suppresses the outbound fallback
    // signal (used when the server already told us to close, so we don't
    // echo it back). The owning window resumes its WebSocket/encoded-frame
    // decode path for this screen; rfb.js handles the bookkeeping.
    _fallback(reason, silent) {
        this._state = 'fallback';
        if (this._opts.pending) {
            // A pending (codec-switch) transport failing must not drag the
            // live one down. Abandon just the pending half.
            if (!silent) { try { this._signaling.sendFallback('renegotiate'); } catch (e) {} }
            if (this._rfb &&
                typeof this._rfb._abandonPendingWebRTCScreen === 'function') {
                this._rfb._abandonPendingWebRTCScreen(this._screenId,
                                                      'pending-failed:' + reason);
            }
            this.stop();
            return;
        }
        if (!silent) { try { this._signaling.sendFallback(reason); } catch (e) {} }
        if (this._rfb &&
            typeof this._rfb._onWebRTCScreenFallback === 'function') {
            this._rfb._onWebRTCScreenFallback(this._screenId, reason);
        }
        this.stop();
    }
}
