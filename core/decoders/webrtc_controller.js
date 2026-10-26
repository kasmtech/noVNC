/*
 * KasmVNC: WebRTC session controller
 * Licensed under MPL 2.0 (see LICENSE.txt)
 *
 * Owns the WebRTC media state for an RFB connection: capability
 * advertisement, per-screen video transports, and the shared image
 * DataChannel. The RFB instance is passed in and its members are read
 * directly, matching the other transports and decoders.
 */

import * as Log from '../util/logging.js';
import { encodings } from '../encodings.js';
import WebRTCVideoTransport from '../transport/webrtc_video.js';
import WebRTCImageTransport from '../transport/webrtc_image.js';
import WebRTCSignaling, { WEBRTC_SESSION_SCREEN, WEBRTC_IMAGE_SCREEN, WebRTCSignalKind, writeWebRTCFrame } from '../transport/webrtc_signaling.js';

const WEBRTC_RECOVERABLE_FALLBACKS = new Set([
    'ice-timeout', 'offer-timeout', 'connect-timeout', 'handshake-timeout',
]);

const IMAGE_CHANNEL_MAX_FAILURES = 3;
const IMAGE_CHANNEL_OFFER_TIMEOUT_MS = 10000;
const IMAGE_CHANNEL_REFRESH_COOLDOWN_MS = 500;

export default class WebRTCController {
    constructor(rfb) {
        this._rfb = rfb;

        this._useUdp = true;
        this._webrtcScreens = new Map();
        this._pendingWebRTCOfferRequest = null;
        this._webrtcSessionActive = false;
        this._webrtcSessionCodec = null;
        this._webrtcIceServers = [];
        this._webrtcIceServersRaw = '';

        this._imageChannel = null;
        this._imageChannelActive = false;
        this._imageChannelFailures = 0;
        this._imageOfferTimer = null;
        this._imageLastRefresh = 0;
    }

    _streamModeToWebRTCCodecs(mode) {
        const E = encodings;
        switch (mode) {
            case E.pseudoEncodingStreamingModeAVC:
            case E.pseudoEncodingStreamingModeAVCSW:
            case E.pseudoEncodingStreamingModeAVCVAAPI:
            case E.pseudoEncodingStreamingModeAVCNVENC:
            case E.pseudoEncodingStreamingModeAVCQSV:
                return ['H264'];
            case E.pseudoEncodingStreamingModeHEVC:
            case E.pseudoEncodingStreamingModeHEVCSW:
            case E.pseudoEncodingStreamingModeHEVCVAAPI:
            case E.pseudoEncodingStreamingModeHEVCNVENC:
            case E.pseudoEncodingStreamingModeHEVCQSV:
                return ['H265', 'H264'];
            case E.pseudoEncodingStreamingModeAV1:
            case E.pseudoEncodingStreamingModeAV1SW:
            case E.pseudoEncodingStreamingModeAV1VAAPI:
            case E.pseudoEncodingStreamingModeAV1NVENC:
            case E.pseudoEncodingStreamingModeAV1QSV:
                return ['AV1', 'H264'];
            default:
                return null;
        }
    }

    _applyWebRTCMediaState(reason) {
        if (!this._rfb._isPrimaryDisplay) return;
        if (typeof RTCPeerConnection === 'undefined') return;

        const wantCodecs = this._useUdp
            ? this._streamModeToWebRTCCodecs(this._rfb._streamMode)
            : null;
        const wantOn  = !!wantCodecs;
        const codecKey = wantCodecs ? wantCodecs.join(',') : '';

        if (wantOn) this._stopImageChannel(true);

        if (wantOn && this._rfb.isConnected) {
            if (!this._webrtcSessionActive || this._webrtcSessionCodec !== codecKey) {
                Log.Info('Advertising WebRTC capability (codecs=' + codecKey +
                    ', reason=' + reason + ')');
                this._webRTCMediaCodecs = wantCodecs;
                try {
                    this._sendWebRTCFrame(WebRTCSignalKind.ClientCapabilities,
                        WEBRTC_SESSION_SCREEN, codecKey);
                    this._webrtcSessionActive = true;
                    this._webrtcSessionCodec = codecKey;
                } catch (e) {
                    Log.Error('WebRTC capability advertisement failed: ' + e);
                    this._webrtcSessionActive = false;
                    this._webrtcSessionCodec = null;
                }
            }
            return;
        }

        if (!wantOn && this._webrtcSessionActive) {
            Log.Info('Disabling WebRTC media (reason=' + reason + ')');
            this._freezeFrameWebRTC();
            try {
                this._sendWebRTCFrame(WebRTCSignalKind.Fallback,
                    WEBRTC_SESSION_SCREEN, 'unsubscribe');
            } catch (e) {
                Log.Warn('WebRTC unsubscribe send failed: ' + e);
            }
            this._teardownAllWebRTCScreens();
            this._webrtcSessionActive = false;
            this._webrtcSessionCodec = null;
        }

        if (!wantOn) {
            if (this._useUdp && this._rfb.isConnected) {
                this._startImageChannel(reason);
            } else {
                this._stopImageChannel(true);
            }
        }
    }

    _sendWebRTCFrame(kind, screenId, payload) {
        writeWebRTCFrame(this._rfb._sock, kind, screenId, payload);
    }

    _makeLocalSignaling(screenId) {
        return new WebRTCSignaling(screenId,
            (k, sid, p) => this._sendWebRTCFrame(k, sid, p));
    }

    _teardownAllWebRTCScreens() {
        for (const slot of this._webrtcScreens.values()) {
            if (slot.pending) { try { slot.pending.stop(); } catch (e) {} }
            if (slot.live)    { try { slot.live.stop(); }    catch (e) {} }
        }
        this._webrtcScreens.clear();
    }

    _teardownStaleSecondaryWebRTC(keepScreenId) {
        let toreDown = false;
        for (const [sid, slot] of Array.from(this._webrtcScreens)) {
            if (sid === keepScreenId) continue;
            if (slot.pending) { try { slot.pending.stop(); } catch (e) {} }
            if (slot.live)    { try { slot.live.stop(); }    catch (e) {} }
            this._webrtcScreens.delete(sid);
            toreDown = true;
        }
        if (toreDown && !this._webrtcScreens.has(keepScreenId)) {
            this._pendingWebRTCOfferRequest = keepScreenId;
        }
    }

    _maybeRequestPendingWebRTCOffer() {
        const sid = this._pendingWebRTCOfferRequest;
        if (sid == null) return;
        this._pendingWebRTCOfferRequest = null;
        if (this._webrtcScreens.has(sid)) return;
        if (this._rfb._display && typeof this._rfb._display.relayWebRTCSignalUp === 'function') {
            this._rfb._display.relayWebRTCSignalUp(WebRTCSignalKind.RequestOffer, sid, '');
        }
    }

    _freezeFrameWebRTC() {
        try {
            let video = null;
            for (const slot of this._webrtcScreens.values()) {
                if (slot.live && slot.live.video && slot.live.video.videoWidth) {
                    video = slot.live.video; break;
                }
            }
            if (!video || !video.videoHeight) return;
            const canvas = this._rfb._display && this._rfb._display._target;
            if (!canvas || !canvas.getContext) return;
            const ctx = canvas.getContext('2d');
            if (!ctx) return;
            ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
        } catch (e) {
            Log.Warn('Freeze-frame capture failed: ' + e);
        }
    }

    _abandonPendingWebRTCScreen(screenId, reason) {
        const slot = this._webrtcScreens.get(screenId);
        if (!slot || !slot.pending) return;
        Log.Info('Abandoning pending WebRTC (screen ' + screenId + '): ' + reason);
        try { slot.pending.stop(); } catch (e) {}
        slot.pending = null;
    }

    _makeImageSignaling() {
        return new WebRTCSignaling(WEBRTC_IMAGE_SCREEN,
            (k, sid, p) => this._sendWebRTCFrame(k, sid, p));
    }

    _startImageChannel(reason) {
        if (this._imageChannel || this._imageChannelFailures >= IMAGE_CHANNEL_MAX_FAILURES) return;
        Log.Info('Requesting image DataChannel (reason=' + reason + ')');
        this._imageChannel = new WebRTCImageTransport(
            this, this._makeImageSignaling(), this._webrtcIceServers,
            (data, frameId) => this._rfb._handleUdpRect(data, frameId),
            () => this._onImageChannelLoss());
        this._imageOfferTimer = setTimeout(() => {
            this._imageOfferTimer = null;
            if (this._imageChannel && !this._imageChannel.isOpen) {
                this._imageChannel._fail('offer-timeout');
            }
        }, IMAGE_CHANNEL_OFFER_TIMEOUT_MS);
        try {
            this._sendWebRTCFrame(WebRTCSignalKind.ImageRequest,
                WEBRTC_IMAGE_SCREEN, '');
        } catch (e) {
            Log.Error('Image channel request failed: ' + e);
            this._imageChannel._fail('request-failed', true);
        }
    }

    _stopImageChannel(notifyServer) {
        if (this._imageOfferTimer) {
            clearTimeout(this._imageOfferTimer);
            this._imageOfferTimer = null;
        }
        if (!this._imageChannel) return;
        const wasActive = this._imageChannelActive;
        try { this._imageChannel.stop(); } catch (e) {}
        this._imageChannel = null;
        this._imageChannelActive = false;
        this._rfb._imageRectsSeen = false;
        if (notifyServer && this._rfb.isConnected) {
            try {
                this._sendWebRTCFrame(WebRTCSignalKind.Fallback,
                    WEBRTC_IMAGE_SCREEN, 'client-stop');
            } catch (e) {
                Log.Warn('Image channel stop notice failed: ' + e);
            }
        }
        if (wasActive) this._rfb._display.clear();
    }

    _handleImageSignal(kind, payload) {
        if (!this._imageChannel) {
            if (kind === WebRTCSignalKind.SdpOffer) {
                try {
                    this._sendWebRTCFrame(WebRTCSignalKind.Fallback,
                        WEBRTC_IMAGE_SCREEN, 'client-stop');
                } catch (e) {
                    Log.Warn('Image channel stop notice failed: ' + e);
                }
            }
            return;
        }
        if (kind === WebRTCSignalKind.SdpOffer) {
            if (this._imageOfferTimer) {
                clearTimeout(this._imageOfferTimer);
                this._imageOfferTimer = null;
            }
            this._imageChannel.setIceServers(this._webrtcIceServers);
        }
        this._imageChannel.signaling.deliver(kind, payload);
    }

    _onImageChannelOpen() {
        Log.Info('Image DataChannel established');
        this._imageChannelActive = true;
        this._imageChannelFailures = 0;
    }

    _onImageChannelFallback(transport, reason) {
        if (transport !== this._imageChannel) return;
        Log.Warn('Image DataChannel fallback (' + reason +
            ') — rects now stream over the WebSocket');
        if (this._imageOfferTimer) {
            clearTimeout(this._imageOfferTimer);
            this._imageOfferTimer = null;
        }
        const wasActive = this._imageChannelActive;
        this._imageChannel = null;
        this._imageChannelActive = false;
        this._rfb._imageRectsSeen = false;
        if (reason !== 'server-video-active') this._imageChannelFailures++;
        if (wasActive) {
            this._rfb._display.clear();
            this._rfb._requestFullRefresh();
        }
    }

    _onImageChannelLoss() {
        const now = Date.now();
        if (now - this._imageLastRefresh < IMAGE_CHANNEL_REFRESH_COOLDOWN_MS) return;
        this._imageLastRefresh = now;
        Log.Warn('Image DataChannel lost a message; requesting full refresh');
        this._rfb._requestFullRefresh();
    }

    _dispatchWebRTCSignal(kind, screenId, payload) {
        if (screenId === WEBRTC_IMAGE_SCREEN) {
            this._handleImageSignal(kind, payload);
            return;
        }
        switch (kind) {
            case WebRTCSignalKind.IceServers:
                this._storeWebRTCIceServers(payload);
                return;
            case WebRTCSignalKind.Fallback:
                if (screenId === WEBRTC_SESSION_SCREEN) {
                    this._onWebRTCSessionFallback(payload);
                    return;
                }
                break;
            case WebRTCSignalKind.SdpOffer:
                if (!this._useUdp || !this._webrtcSessionActive) {
                    Log.Info('Ignoring WebRTC offer for screen ' + screenId +
                        ' (WebRTC disabled)');
                    try {
                        this._sendWebRTCFrame(WebRTCSignalKind.Fallback,
                            WEBRTC_SESSION_SCREEN, 'unsubscribe');
                    } catch (e) {
                        Log.Warn('WebRTC unsubscribe send failed: ' + e);
                    }
                    return;
                }
                break;
        }
        if (this._webrtcScreenIsLocal(screenId)) {
            this._routeWebRTCSignal(kind, screenId, payload,
                (sid) => this._makeLocalSignaling(sid));
        } else {
            this._relayWebRTCSignalToScreen(screenId, kind, payload);
        }
    }

    _storeWebRTCIceServers(payload) {
        this._webrtcIceServersRaw = payload || '';
        this._webrtcIceServers = this._webrtcIceServersRaw.split('\n')
            .map(s => s.trim()).filter(Boolean)
            .map(raw => WebRTCController._parseIceServer(raw))
            .filter(Boolean);
        Log.Debug('WebRTC ICE servers: ' +
            JSON.stringify(this._webrtcIceServers.map(s => s.urls)));
    }

    static _parseIceServer(raw) {
        const m = /^(turns?):(?:([^@/:]+):([^@/]*)@)(.+)$/i.exec(raw);
        if (!m) {
            if (/^turns?:/i.test(raw)) {
                Log.Warn('Ignoring TURN server without full credentials');
                return null;
            }
            return { urls: raw };
        }
        let username, credential;
        try {
            username = decodeURIComponent(m[2]);
            credential = decodeURIComponent(m[3]);
        } catch (e) {
            Log.Warn('Ignoring TURN server with malformed credentials');
            return null;
        }
        if (!username || !credential) {
            Log.Warn('Ignoring TURN server without full credentials');
            return null;
        }
        return { urls: m[1] + ':' + m[4], username, credential };
    }

    _localWebRTCScreenId() {
        if (this._rfb._isPrimaryDisplay) return 0;
        return (this._rfb._display && this._rfb._display.screenIndex) || 0;
    }

    _webrtcScreenIsLocal(screenId) {
        return screenId === this._localWebRTCScreenId();
    }

    _routeWebRTCSignal(kind, screenId, payload, makeSignaling) {
        if (typeof RTCPeerConnection === 'undefined') {
            if (kind === WebRTCSignalKind.SdpOffer) {
                Log.Warn('RTCPeerConnection unsupported; declining screen ' + screenId);
                const sig = makeSignaling(screenId);
                try { sig.send(WebRTCSignalKind.Fallback, 'no-rtcpeerconnection'); } catch (e) {
                    Log.Warn('No-RTCPeerConnection fallback send failed: ' + e);
                }
            }
            return;
        }
        let slot = this._webrtcScreens.get(screenId);
        if (kind === WebRTCSignalKind.SdpOffer) {
            if (!slot) { slot = { live: null, pending: null }; this._webrtcScreens.set(screenId, slot); }
            const pending = !!slot.live;
            const sig = makeSignaling(screenId);
            const transport = new WebRTCVideoTransport(this, screenId, sig,
                { pending, iceServers: this._webrtcIceServers });
            if (pending) {
                if (slot.pending) { try { slot.pending.stop(); } catch (e) {} }
                slot.pending = transport;
            } else {
                slot.live = transport;
            }
            sig.deliver(kind, payload);
            return;
        }
        if (!slot) return;
        if (kind === WebRTCSignalKind.Fallback &&
            typeof payload === 'string' && payload.startsWith('renegotiate-') &&
            !slot.pending) {
            Log.Info('Ignoring late ' + payload + ' for screen ' + screenId +
                ' (no pending transport)');
            return;
        }
        if (kind === WebRTCSignalKind.Close) {
            if (slot.pending) slot.pending.signaling.deliver(kind, payload);
            if (slot.live)    slot.live.signaling.deliver(kind, payload);
            return;
        }
        const target = slot.pending || slot.live;
        if (target) target.signaling.deliver(kind, payload);
    }

    _relayWebRTCSignalToScreen(screenId, kind, payload) {
        if (!this._rfb._display || typeof this._rfb._display.relayWebRTCSignal !== 'function') return;
        if (kind === WebRTCSignalKind.SdpOffer) {
            this._rfb._display.relayWebRTCSignal(screenId, WebRTCSignalKind.IceServers,
                WEBRTC_SESSION_SCREEN,
                this._webrtcIceServersRaw || '');
        }
        this._rfb._display.relayWebRTCSignal(screenId, kind, screenId, payload);
    }

    _forwardRelayedWebRTCToServer(kind, screenId, payload) {
        try { this._sendWebRTCFrame(kind, screenId, payload); } catch (e) {
            Log.Warn('Forwarding relayed WebRTC signal to server failed: ' + e);
        }
    }

    _onRelayedWebRTCSignal(kind, screenId, payload) {
        if (kind === WebRTCSignalKind.IceServers) {
            this._storeWebRTCIceServers(payload);
            return;
        }
        this._routeWebRTCSignal(kind, screenId, payload,
            (sid) => this._makeRelaySignaling(sid));
    }

    _makeRelaySignaling(screenId) {
        return new WebRTCSignaling(screenId,
            (k, sid, p) => {
                if (this._rfb._display && typeof this._rfb._display.relayWebRTCSignalUp === 'function')
                    this._rfb._display.relayWebRTCSignalUp(k, sid, p);
            });
    }

    _onWebRTCVideoReady(video, transport) {
        const screenId = transport.screenId;
        const slot = this._webrtcScreens.get(screenId);
        const pending = !!(slot && transport === slot.pending);
        try {
            video.style.position = 'absolute';
            video.style.left   = '0';
            video.style.top    = '0';
            video.style.width  = '100%';
            video.style.height = '100%';
            video.style.zIndex = pending ? '2' : '1';
            video.style.pointerEvents = 'none';
            video.style.opacity = '0';
            video.addEventListener('playing', () => {
                video.style.opacity = '1';
                if (pending) this._promotePendingWebRTCScreen(screenId, transport);
            }, { once: true });
            const host = this._rfb._screen || this._rfb._target;
            if (host && host.appendChild) host.appendChild(video);
        } catch (e) {
            Log.Warn('Failed to mount WebRTC <video> (screen ' + screenId + '): ' + e);
        }
    }

    _promotePendingWebRTCScreen(screenId, transport) {
        const slot = this._webrtcScreens.get(screenId);
        if (!slot || transport !== slot.pending) return;
        Log.Info('Pending WebRTC media (screen ' + screenId + ') is playing — promoting');
        const oldLive  = slot.live;
        const oldVideo = oldLive && oldLive.video;
        if (oldLive) { try { oldLive.stop(); } catch (e) {} }
        if (oldVideo && oldVideo.parentNode) {
            oldVideo.parentNode.removeChild(oldVideo);
        }
        slot.live = slot.pending;
        slot.pending = null;
        try { if (slot.live.video) slot.live.video.style.zIndex = '1'; } catch (e) {}
    }

    _onWebRTCScreenFallback(screenId, reason) {
        Log.Warn('WebRTC screen ' + screenId + ' fallback (' + reason +
            ') — this screen now streams over the WebSocket');
        const slot = this._webrtcScreens.get(screenId);
        if (!slot) return;
        this._freezeFrameWebRTC();
        if (slot.pending) { try { slot.pending.stop(); } catch (e) {} }
        if (slot.live)    { try { slot.live.stop(); }    catch (e) {} }
        this._webrtcScreens.delete(screenId);
    }

    _onWebRTCSessionFallback(reason) {
        Log.Warn('WebRTC session fallback (' + reason + ') — image mode taking over');
        this._freezeFrameWebRTC();
        this._teardownAllWebRTCScreens();
        this._relaySessionFallbackToSecondaries(reason);
        if (WEBRTC_RECOVERABLE_FALLBACKS.has(String(reason))) return;
        this._webrtcSessionActive = false;
        this._webrtcSessionCodec = null;
    }

    _relaySessionFallbackToSecondaries(reason) {
        if (!this._rfb._display || typeof this._rfb._display.relayWebRTCSignal !== 'function') return;
        const n = this._rfb._display.screens ? this._rfb._display.screens.length : 0;
        for (let idx = 1; idx < n; idx++) {
            if (idx === this._localWebRTCScreenId()) continue;
            this._rfb._display.relayWebRTCSignal(idx, WebRTCSignalKind.Fallback, idx,
                'session-' + reason);
        }
    }
}
