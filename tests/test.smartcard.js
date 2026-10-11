/* jshint expr: true */

const expect = chai.expect;

import initSmartcardRelay from '../core/output/smartcard.js';

// Relay packets: u8 command, u16 big-endian payload length, payload. A
// bridge that tags its requests appends a request ID after the payload:
// the marker byte 0x49 and a 32-bit big-endian ID. The answer carries the
// same trailer, so the bridge can tell a late answer to an earlier
// request from the answer it is waiting for.
const REQUEST_TRANSMIT = 0x05;
const REQUEST_INITIALIZE = 0x06;
const RESPONSE_ACK = 0x80;
const ID_MARKER = 0x49;

function packet(command, payload, id) {
    const trailer = id === undefined ? [] :
        [ID_MARKER, (id >>> 24) & 0xff, (id >>> 16) & 0xff, (id >>> 8) & 0xff, id & 0xff];
    return new Uint8Array([command, (payload.length >> 8) & 0xff, payload.length & 0xff,
                           ...payload, ...trailer]);
}

const hex = bytes => Array.from(bytes).map(b => b.toString(16).padStart(2, "0").toUpperCase()).join("");

// A fake of Kasm's smartcard extension: every call is answered through
// its own callback. A transmit's answer is the APDU followed by 90 00,
// after the delay transmitDelay(apdu) gives, so answers can be made to
// come back in another order than their requests.
function fakeExtension(transmitDelay) {
    const ok = "0x00000000";
    return {
        runtime: {
            lastError: undefined,
            sendMessage(extensionId, message, callback) {
                const args = message.args.split(",");
                let result;
                let delay = 0;
                switch (message.type) {
                    case "establish_context": result = [ok, "ctx"]; break;
                    case "list_readers": result = [ok, "reader0"]; break;
                    case "get_status_change": result = [ok, 1, 0, 0, "3B8F8001"]; break;
                    case "connect": result = [ok, "ctx", "card", "1"]; break;
                    case "transmit":
                        result = [ok, "ctx", "card", "1", args[3] + "9000"];
                        delay = transmitDelay(args[3]);
                        break;
                    default: result = [ok];
                }
                setTimeout(() => callback({ status: "ok", result }), delay);
            },
        },
    };
}

describe('Smartcard relay', function () {
    "use strict";

    let savedChrome;
    let rfb;
    let handler;
    let sent;

    beforeEach(function () {
        savedChrome = window.chrome;
        sent = [];
        handler = null;
        rfb = {
            subscribeUnixRelay(name, fn) {
                expect(name).to.equal("smartcard");
                handler = fn;
            },
            sendUnixRelayData(name, data) {
                expect(name).to.equal("smartcard");
                sent.push(new Uint8Array(data));
            },
        };
    });

    afterEach(function () {
        window.chrome = savedChrome;
    });

    async function start(transmitDelay = () => 0) {
        window.chrome = fakeExtension(transmitDelay);
        await initSmartcardRelay(rfb);
        expect(handler).to.be.a('function');
    }

    // Each request's handler is async and not queued, so this waits until
    // the expected number of answers has been sent.
    async function answers(n) {
        for (let i = 0; i < 200 && sent.length < n; i++) {
            await new Promise(r => setTimeout(r, 5));
        }
        expect(sent.length).to.equal(n);
        return sent.map(hex);
    }

    it('should echo the request ID of each tagged request, even when answers come back out of order', async function () {
        // A's transmit is answered late, after B's.
        await start(apdu => (apdu === "A1" ? 100 : 0));

        handler(packet(REQUEST_TRANSMIT, [0xA1], 0x01020301));
        handler(packet(REQUEST_TRANSMIT, [0xB2], 0x01020302));

        const got = await answers(2);
        expect(got).to.deep.equal([
            hex(packet(RESPONSE_ACK, [0xB2, 0x90, 0x00], 0x01020302)),
            hex(packet(RESPONSE_ACK, [0xA1, 0x90, 0x00], 0x01020301)),
        ]);
    });

    it('should echo the request ID on an ERROR answer', async function () {
        await start();
        handler(packet(0x7E, [], 0xFFFFFFFE));
        await answers(1);
        const reply = sent[0];
        expect(reply[0]).to.equal(0x81);
        expect(hex(reply.slice(reply.length - 5))).to.equal("49FFFFFFFE");
    });

    it('should answer untagged requests without a trailer (a bridge that does not tag)', async function () {
        await start(apdu => (apdu === "A1" ? 50 : 0));

        handler(packet(REQUEST_INITIALIZE, []));
        handler(packet(REQUEST_TRANSMIT, [0xA1]));
        handler(packet(REQUEST_TRANSMIT, [0xB2]));

        const got = await answers(3);
        expect(got).to.deep.equal([
            hex(packet(RESPONSE_ACK, [])),
            hex(packet(RESPONSE_ACK, [0xB2, 0x90, 0x00])),
            hex(packet(RESPONSE_ACK, [0xA1, 0x90, 0x00])),
        ]);
    });

    it('should ignore trailing bytes that are not a request ID', async function () {
        await start();
        const req = packet(REQUEST_TRANSMIT, [0xC3]);
        handler(new Uint8Array([...req, 0x00, 0x00]));
        const got = await answers(1);
        expect(got).to.deep.equal([hex(packet(RESPONSE_ACK, [0xC3, 0x90, 0x00]))]);
    });
});
