/* jshint expr: true */

const expect = chai.expect;

import RFB from '../core/rfb.js';
import FakeWebSocket from './fake.websocket.js';

// The server sends a print as three or more unix relay messages (start,
// chunks, end) in one websocket message. Each message in the receive queue
// must be handled when it arrives, not one per later websocket message: an
// idle session sends nothing else, and the rest of the print waits for the
// next screen update or smartcard poll.
//
// FakeWebSocket._receiveData() delivers one byte per message event, which
// hides this, so these tests deliver all the bytes in one event.

function relayMsg(name, payload) {
    const data = [183, name.length];
    for (const c of name) { data.push(c.charCodeAt(0)); }
    const n = payload.length;
    data.push((n >> 24) & 0xff, (n >> 16) & 0xff, (n >> 8) & 0xff, n & 0xff);
    return data.concat(payload);
}

describe('Unix relay messages', function () {
    let container;
    let rfb;
    let clock;

    before(FakeWebSocket.replace);
    after(FakeWebSocket.restore);
    before(function () { clock = sinon.useFakeTimers(Date.now()); });
    after(function () { clock.restore(); });

    beforeEach(function () {
        container = document.createElement('div');
        document.body.appendChild(container);
        rfb = new RFB(container, document.createElement('textarea'), 'wss://host:8675');
        clock.tick();  // the connection is opened from a timer
        rfb._sock._websocket._open();
        rfb._rfbConnectionState = 'connected';
    });

    afterEach(function () {
        rfb._sock._websocket.onmessage = () => {};
        document.body.removeChild(container);
    });

    function receive(bytes) {
        const u8 = new Uint8Array(bytes);
        rfb._sock._websocket.onmessage(new MessageEvent('message', { data: u8.buffer }));
    }

    it('handles every relay message in one websocket message', function () {
        const got = [];
        rfb._unixRelays = { printer: p => got.push(Array.from(p)) };
        receive([
            ...relayMsg('printer', [0, 0, 0, 0, 0, 0, 0, 1]),
            ...relayMsg('printer', [0, 0, 0, 1, 0, 0, 0, 1, 37]),
            ...relayMsg('printer', [0, 0, 0, 2])]);
        expect(got).to.deep.equal([
            [0, 0, 0, 0, 0, 0, 0, 1],
            [0, 0, 0, 1, 0, 0, 0, 1, 37],
            [0, 0, 0, 2]]);
        expect(rfb._sock.rQlen).to.equal(0);
    });

    it('handles the message after a relay message', function () {
        const bell = sinon.spy();
        rfb._unixRelays = { printer: () => {} };
        rfb.addEventListener('bell', bell);
        receive([...relayMsg('printer', [0, 0, 0, 2]), 2]);
        expect(bell).to.have.been.calledOnce;
    });

    it('handles the message after a relay subscription answer', function () {
        const bell = sinon.spy();
        rfb.addEventListener('bell', bell);
        // status 1, then "Ok" with its length, then a Bell
        receive([182, 1, 2, 79, 107, 2]);
        expect(bell).to.have.been.calledOnce;
    });

    it('handles the message after a UDP upgrade answer', function () {
        const bell = sinon.spy();
        rfb._udpPeer = { setRemoteDescription: () => new Promise(() => {}) };
        rfb.addEventListener('bell', bell);
        const payload = JSON.stringify({ answer: { type: 'answer', sdp: '' }, candidate: {} });
        const data = [181, (payload.length >> 8) & 0xff, payload.length & 0xff];
        for (const c of payload) { data.push(c.charCodeAt(0)); }
        data.push(2);
        receive(data);
        expect(bell).to.have.been.calledOnce;
    });
});
