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

        this._remoteDescriptionSet = false;
        this._pendingRemoteCandidates = [];

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
                this._fallback('server-close:' + payload, true);
                break;
            case WebRTCSignalKind.Fallback:
                Log.Warn('Server signalled WebRTC fallback (screen ' +
                         this._screenId + '): ' + payload);
                this._fallback('server-' + payload, true);
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

        const logVideoEvent = (name) => {
            const err = this._video.error ? this._video.error.code : 0;
            Log.Debug('[WEBRTC-DIAG] <video> ' + name + ' screen ' +
                     this._screenId + ' (readyState=' + this._video.readyState +
                     ', networkState=' + this._video.networkState +
                     ', currentTime=' + this._video.currentTime.toFixed(3) +
                     ', size=' + this._video.videoWidth + 'x' +
                     this._video.videoHeight + ', paused=' + this._video.paused +
                     ', error=' + err + ')');
        };
        ['loadedmetadata', 'canplay', 'playing', 'waiting', 'stalled',
         'suspend', 'pause', 'error', 'resize'].forEach((name) => {
            this._video.addEventListener(name, () => logVideoEvent(name));
        });

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
            if (s === 'failed' || s === 'disconnected') {
                if (!this._failureTimer) {
                    this._failureTimer = setTimeout(() => {
                        this._failureTimer = null;
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

            const sdpText = answer.sdp || '';
            if (!/^m=video /m.test(sdpText) || /^a=inactive/m.test(sdpText)) {
                Log.Error('SDP answer for screen ' + this._screenId +
                          ' has no usable video m-line; falling back');
                this._fallback('codec-mismatch');
                return;
            }
            this._negotiated = true;
            this._signaling.sendAnswer(sdpText);
        } catch (e) {
            Log.Error('SDP offer handling failed (screen ' +
                      this._screenId + '): ' + e);
            this._fallback('sdp-failed');
        }
    }

    _handleRemoteIce(payload) {
        const pipe = payload.indexOf('|');
        if (pipe < 0) {
            Log.Warn('Malformed ICE candidate from server: ' + payload);
            return;
        }
        const candidate = payload.substring(0, pipe);
        const sdpMid    = payload.substring(pipe + 1);
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
            Log.Warn('addIceCandidate failed (screen ' +
                     this._screenId + '): ' + e);
        }
    }

    _fallback(reason, silent) {
        this._state = 'fallback';
        if (this._opts.pending) {
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
