/*
 * KasmVNC WebRTC signaling — wraps msgTypeWebRTCSignal (187) frames
 * over the existing WebSocket. Body schema:
 *     [u8 kind][u16 len][bytes payload]
 *
 * Kind values mirror common/rfb/msgTypes.h:
 *   1: SDP offer        (server -> client)
 *   2: SDP answer       (client -> server)
 *   3: ICE candidate    (bidirectional; payload "<candidate>|<sdpMid>")
 *   4: ICE servers list (server -> client; newline-separated URLs)
 *   5: Fallback signal  (bidirectional; payload is a reason string)
 *   6: Client capability advertisement (client -> server; codec list)
 *
 * Licensed under MPL 2.0, same as the rest of kasmweb.
 */

import * as Log from '../util/logging.js';

export const WEBRTC_MSG_TYPE = 187;

export const WebRTCSignalKind = Object.freeze({
    SdpOffer:      1,
    SdpAnswer:     2,
    IceCandidate:  3,
    IceServers:    4,
    Fallback:      5,
    ClientCapabilities: 6,
});

export default class WebRTCSignaling {
    constructor(sock) {
        this._sock = sock;
        this._onMessage = null;     // (kind, payload:string) -> void
    }

    onMessage(cb) { this._onMessage = cb; }

    // Server -> client: dispatch a kind/payload pair. Called by rfb.js
    // when it sees msg-type 187 on the wire.
    deliver(kind, payload) {
        if (this._onMessage) this._onMessage(kind, payload);
    }

    // Client -> server. Send a kind/payload triple over the WebSocket.
    // Chunk the body across multiple send() calls because Websock._sQ is
    // a fixed 10 KiB buffer and SDP offers can exceed it.
    send(kind, payload) {
        const utf8 = (typeof payload === 'string')
            ? new TextEncoder().encode(payload)
            : (payload || new Uint8Array(0));
        if (utf8.length > 0xffff) {
            Log.Error('WebRTC signal payload too large (' + utf8.length + 'B); dropped');
            return;
        }

        const header = new Uint8Array(4);
        header[0] = WEBRTC_MSG_TYPE;
        header[1] = kind & 0xff;
        header[2] = (utf8.length >> 8) & 0xff;
        header[3] =  utf8.length       & 0xff;

        // Drain anything another writer left in the send queue so our
        // header lands at a known offset and we have the full
        // _sQbufferSize available to chunk the body against.
        this._sock.flush();
        this._sock.send(header);

        // Body. Websock._sQ is a fixed-size buffer (defaults to 10 KiB);
        // SDP offers can exceed it, so we chunk and let send()'s built-in
        // flush() drain each chunk.
        const sQSize = this._sock._sQbufferSize;
        for (let off = 0; off < utf8.length; off += sQSize) {
            const end = Math.min(off + sQSize, utf8.length);
            this._sock.send(utf8.subarray(off, end));
        }
    }

    sendCapabilities(codecList) {
        this.send(WebRTCSignalKind.ClientCapabilities, codecList.join(','));
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
