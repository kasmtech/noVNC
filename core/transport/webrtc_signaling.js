/*
 * KasmVNC WebRTC signaling — wraps msgTypeWebRTCSignal (190) frames
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

// 187/188 are reserved by the direct-drive-mouse/game-mode work
// (msgTypeForceGameMode / msgTypeDirectMouseEvent) and 189 is a buffer,
// so WebRTC signaling lives at 190. Keep in sync with msgTypeWebRTCSignal
// in common/rfb/msgTypes.h.
export const WEBRTC_MSG_TYPE = 190;
export const WEBRTC_SESSION_SCREEN = 0xFF;

export const WebRTCSignalKind = Object.freeze({
    SdpOffer:      1,
    SdpAnswer:     2,
    IceCandidate:  3,
    IceServers:    4,
    Fallback:      5,
    ClientCapabilities: 6,
    Close:         7,
    RequestOffer:  8,
});

// Write a single msgTypeWebRTCSignal frame to the WebSocket. Standalone
// (not a method) so the primary window can use it both for its own
// transports and to forward a secondary window's relayed answer/ICE up
// to the server. Body: [u8 190][u8 kind][u8 screenId][u16 len][payload].
export function writeWebRTCFrame(sock, kind, screenId, payload) {
    const utf8 = (typeof payload === 'string')
        ? new TextEncoder().encode(payload)
        : (payload || new Uint8Array(0));
    if (utf8.length > 0xffff) {
        Log.Error('WebRTC signal payload too large (' + utf8.length + 'B); dropped');
        return;
    }
    const header = new Uint8Array(5);
    header[0] = WEBRTC_MSG_TYPE;
    header[1] = kind & 0xff;
    header[2] = screenId & 0xff;
    header[3] = (utf8.length >> 8) & 0xff;
    header[4] =  utf8.length       & 0xff;

    // Drain anything another writer left in the send queue so our header
    // lands at a known offset and we have the full _sQbufferSize to chunk
    // the body against.
    sock.flush();
    sock.send(header);

    // Body. Websock._sQ is a fixed-size buffer (defaults to 10 KiB); SDP
    // offers can exceed it, so chunk and let send()'s flush() drain each.
    const sQSize = sock._sQbufferSize;
    for (let off = 0; off < utf8.length; off += sQSize) {
        const end = Math.min(off + sQSize, utf8.length);
        sock.send(utf8.subarray(off, end));
    }
}

// Per-screen signaling channel. Bound to one screenId and one outbound
// sink. The sink is `(kind, screenId, payloadStr) => void`:
//   - primary, screen it owns: sink writes to the WebSocket
//     (writeWebRTCFrame(sock, ...)).
//   - secondary window: sink posts {webrtcSignal:{kind,screenId,payload}}
//     to its relay MessagePort; the primary forwards it to the socket.
// Inbound signals are pushed in via deliver(kind, payload) by whoever
// receives them (rfb.js socket reader on the primary, or the relay-port
// onmessage handler on a secondary window).
export default class WebRTCSignaling {
    constructor(screenId, sendFn) {
        this._screenId = screenId;
        this._sendFn = sendFn;       // (kind, screenId, payloadStr) => void
        this._onMessage = null;      // (kind, payload:string) -> void
    }

    get screenId() { return this._screenId; }

    onMessage(cb) { this._onMessage = cb; }

    // Inbound: dispatch a kind/payload pair to the bound transport.
    deliver(kind, payload) {
        if (this._onMessage) this._onMessage(kind, payload);
    }

    // Outbound: send through the configured sink, tagging our screenId.
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
