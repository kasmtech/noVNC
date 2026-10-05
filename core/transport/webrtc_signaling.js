/*
 * KasmVNC WebRTC signaling — wraps msgTypeWebRTCSignal (192) frames
 * over the existing WebSocket. Body schema (multi-screen):
 *     [u8 kind][u8 screenId][u16 len][bytes payload]
 *
 * Multi-monitor sessions run one RTCPeerConnection per X screen (see
 * doc/MULTI_MONITOR_WEBRTC_PLAN.md); screenId selects which one a signal
 * applies to. WEBRTC_SESSION_SCREEN (0xFF) marks a session-level signal
 * (capabilities, ICE-servers list, whole-session fallback).
 *
 * Kind values mirror common/rfb/msgTypes.h:
 *   1: SDP offer        (server -> client, per screen)
 *   2: SDP answer       (client -> server, per screen)
 *   3: ICE candidate    (bidirectional; payload "<candidate>|<sdpMid>")
 *   4: ICE servers list (server -> client; session-level; newline URLs)
 *   5: Fallback signal  (bidirectional; per screen or session-level)
 *   6: Client capability advertisement (client -> server; session-level)
 *   7: Screen close     (server -> client; per screen — monitor removed)
 *   8: Request offer    (client -> server; per screen)
 *   9: Image request   (client -> server; WEBRTC_IMAGE_SCREEN)
 *
 * Each instance is bound to one screenId so a per-screen transport's
 * outbound signals carry the right id without the transport having to
 * know the wire format. The `send` primitive is pluggable so the same
 * class works on the primary (writes to the WebSocket) and on a
 * secondary window (posts to its relay MessagePort).
 *
 * Licensed under MPL 2.0, same as the rest of kasmweb.
 */

import * as Log from '../util/logging.js';

export const WEBRTC_MSG_TYPE = 192;
export const WEBRTC_SESSION_SCREEN = 0xFF;
export const WEBRTC_IMAGE_SCREEN = 0xFE;
export const WEBRTC_MAX_SIGNAL_BYTES = 16 * 1024;

export const WebRTCSignalKind = Object.freeze({
    SdpOffer:      1,
    SdpAnswer:     2,
    IceCandidate:  3,
    IceServers:    4,
    Fallback:      5,
    ClientCapabilities: 6,
    Close:         7,
    RequestOffer:  8,
    ImageRequest:  9,
});

export function writeWebRTCFrame(sock, kind, screenId, payload) {
    const utf8 = (typeof payload === 'string')
        ? new TextEncoder().encode(payload)
        : (payload || new Uint8Array(0));
    if (utf8.length > WEBRTC_MAX_SIGNAL_BYTES) {
        Log.Error('WebRTC signal payload too large (' + utf8.length + 'B); dropped');
        return;
    }
    const header = new Uint8Array(5);
    header[0] = WEBRTC_MSG_TYPE;
    header[1] = kind & 0xff;
    header[2] = screenId & 0xff;
    header[3] = (utf8.length >> 8) & 0xff;
    header[4] =  utf8.length       & 0xff;

    sock.flush();
    sock.send(header);

    const sQSize = sock._sQbufferSize;
    for (let off = 0; off < utf8.length; off += sQSize) {
        const end = Math.min(off + sQSize, utf8.length);
        sock.send(utf8.subarray(off, end));
    }
}

export default class WebRTCSignaling {
    constructor(screenId, sendFn) {
        this._screenId = screenId;
        this._sendFn = sendFn;
        this._onMessage = null;
    }

    get screenId() { return this._screenId; }

    onMessage(cb) { this._onMessage = cb; }

    deliver(kind, payload) {
        if (this._onMessage) this._onMessage(kind, payload);
    }

    send(kind, payload) {
        this._sendFn(kind, this._screenId, payload);
    }

    sendAnswer(sdp) {
        this.send(WebRTCSignalKind.SdpAnswer, sdp);
    }
    sendIceCandidate(candidate, sdpMid) {
        this.send(WebRTCSignalKind.IceCandidate,
                  (candidate || '') + '|' + (sdpMid || ''));
    }
    sendFallback(reason) {
        this.send(WebRTCSignalKind.Fallback, reason || 'unknown');
    }
}
