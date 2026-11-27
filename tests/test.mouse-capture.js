const expect = chai.expect;

import RFB from '../core/rfb.js';
import MouseButtonMapper, { XVNC_BUTTONS } from '../core/mousebuttonmapper.js';
import { setCapture, releaseCapture, isCaptureProxyEvent } from '../core/util/events.js';
import FakeWebSocket from './fake.websocket.js';

describe('Mouse Capture and Stuck-Button Recovery', function () {
    "use strict";

    let origReleaseCaptureDescriptor;

    function shadowPolyfillCapture(el) {
        Object.defineProperty(el, 'setCapture', {
            value: undefined,
            configurable: true,
            writable: true,
        });
        Object.defineProperty(document, 'releaseCapture', {
            value: undefined,
            configurable: true,
            writable: true,
        });
    }

    function restoreReleaseCapture() {
        if (origReleaseCaptureDescriptor) {
            Object.defineProperty(document, 'releaseCapture', origReleaseCaptureDescriptor);
        } else {
            delete document.releaseCapture;
        }
    }

    beforeEach(function () {
        origReleaseCaptureDescriptor = Object.getOwnPropertyDescriptor(document, 'releaseCapture');
        const staleProxy = document.getElementById('noVNC_mouse_capture_elem');
        if (staleProxy && staleProxy.parentNode) {
            staleProxy.parentNode.removeChild(staleProxy);
        }
    });

    afterEach(function () {
        releaseCapture();
        const proxyElem = document.getElementById('noVNC_mouse_capture_elem');
        if (proxyElem && proxyElem.parentNode) {
            proxyElem.parentNode.removeChild(proxyElem);
        }
        restoreReleaseCapture();
        document.captureElement = null;
    });

    describe('Mouse capture proxy (core/util/events.js)', function () {
        let target;

        beforeEach(function () {
            target = document.createElement('div');
            target.style.cursor = 'crosshair';
            shadowPolyfillCapture(target);
            document.body.appendChild(target);
        });

        afterEach(function () {
            releaseCapture();
            if (target && target.parentNode) {
                target.parentNode.removeChild(target);
            }
            target = null;
        });

        it('forwards mousedown, contextmenu, and non-passive wheel events with proxy marker and preventDefault propagation', function () {
            const received = [];
            target.addEventListener('mousedown', (ev) => {
                received.push({
                    type: ev.type,
                    button: ev.button,
                    buttons: ev.buttons,
                    proxied: isCaptureProxyEvent(ev),
                });
            });
            target.addEventListener('contextmenu', (ev) => {
                ev.preventDefault();
                received.push({
                    type: ev.type,
                    proxied: isCaptureProxyEvent(ev),
                });
            });
            target.addEventListener('wheel', (ev) => {
                ev.preventDefault();
                received.push({
                    type: ev.type,
                    deltaY: ev.deltaY,
                    proxied: isCaptureProxyEvent(ev),
                });
            });

            setCapture(target);
            const proxyElem = document.getElementById('noVNC_mouse_capture_elem');
            expect(proxyElem).to.not.equal(null);
            expect(proxyElem.style.display).to.equal('');

            const downEv = new MouseEvent('mousedown', {
                bubbles: true,
                cancelable: true,
                button: 2,
                buttons: 5,
                clientX: 40,
                clientY: 50,
            });
            proxyElem.dispatchEvent(downEv);

            const menuEv = new MouseEvent('contextmenu', {
                bubbles: true,
                cancelable: true,
                button: 2,
                buttons: 0,
                clientX: 40,
                clientY: 50,
            });
            proxyElem.dispatchEvent(menuEv);

            const wheelEv = new WheelEvent('wheel', {
                bubbles: true,
                cancelable: true,
                deltaX: 0,
                deltaY: 120,
                clientX: 40,
                clientY: 50,
            });
            proxyElem.dispatchEvent(wheelEv);

            expect(received).to.deep.equal([
                { type: 'mousedown', button: 2, buttons: 5, proxied: true },
                { type: 'contextmenu', proxied: true },
                { type: 'wheel', deltaY: 120, proxied: true },
            ]);
            expect(menuEv.defaultPrevented).to.equal(true);
            expect(wheelEv.defaultPrevented).to.equal(true);
            expect(isCaptureProxyEvent(wheelEv)).to.equal(false);
            expect(document.captureElement).to.equal(target);
        });

        it('forwards window-level mousemove and mouseup while captured and removes listeners on release', function () {
            const received = [];
            target.addEventListener('mousemove', (ev) => {
                received.push({ type: ev.type, clientX: ev.clientX, proxied: isCaptureProxyEvent(ev) });
            });
            target.addEventListener('mouseup', (ev) => {
                received.push({ type: ev.type, clientX: ev.clientX, proxied: isCaptureProxyEvent(ev) });
            });

            setCapture(target);
            window.dispatchEvent(new MouseEvent('mousemove', {
                bubbles: false,
                cancelable: true,
                buttons: 1,
                clientX: 25,
                clientY: 30,
            }));
            window.dispatchEvent(new MouseEvent('mouseup', {
                bubbles: false,
                cancelable: true,
                buttons: 0,
                clientX: 35,
                clientY: 40,
            }));

            expect(received).to.deep.equal([
                { type: 'mousemove', clientX: 25, proxied: true },
                { type: 'mouseup', clientX: 35, proxied: true },
            ]);
            expect(document.captureElement).to.equal(null);

            // Listeners removed after release: further window events must not forward
            window.dispatchEvent(new MouseEvent('mousemove', {
                bubbles: false,
                cancelable: true,
                buttons: 0,
                clientX: 99,
                clientY: 99,
            }));
            expect(received.length).to.equal(2);
        });

        it('retains capture during chorded mouseup when buttons remain held and releases when buttons reach 0', function () {
            setCapture(target);
            const proxyElem = document.getElementById('noVNC_mouse_capture_elem');

            proxyElem.dispatchEvent(new MouseEvent('mouseup', {
                bubbles: true,
                cancelable: true,
                button: 2,
                buttons: 1,
            }));
            expect(document.captureElement).to.equal(target);
            expect(proxyElem.style.display).to.equal('');

            proxyElem.dispatchEvent(new MouseEvent('mouseup', {
                bubbles: true,
                cancelable: true,
                button: 0,
                buttons: 0,
            }));
            expect(document.captureElement).to.equal(null);
            expect(proxyElem.style.display).to.equal('none');
        });

        it('auto-releases capture on mousemove only on desktop when buttons is numeric 0', function () {
            setCapture(target);
            const proxyElem = document.getElementById('noVNC_mouse_capture_elem');

            let sawProxiedMove = false;
            target.addEventListener('mousemove', (ev) => {
                sawProxiedMove = isCaptureProxyEvent(ev);
            });

            // Non-numeric buttons (undefined) must not prematurely drop capture on mousemove
            proxyElem.dispatchEvent(new Event('mousemove', {
                bubbles: true,
                cancelable: true,
            }));
            expect(sawProxiedMove).to.equal(true);
            expect(document.captureElement).to.equal(target);
            expect(proxyElem.style.display).to.equal('');

            // Non-desktop UAs (e.g. OculusBrowser) report buttons=0 during active drags
            const origUaDesc = Object.getOwnPropertyDescriptor(navigator, 'userAgent');
            Object.defineProperty(navigator, 'userAgent', {
                value: 'Mozilla/5.0 (Linux; Android 12; Quest 3) AppleWebKit/537.36 OculusBrowser/30.0',
                configurable: true,
            });
            try {
                proxyElem.dispatchEvent(new MouseEvent('mousemove', {
                    bubbles: true,
                    cancelable: true,
                    buttons: 0,
                }));
                expect(document.captureElement).to.equal(target);

                proxyElem.dispatchEvent(new MouseEvent('mouseup', {
                    bubbles: true,
                    cancelable: true,
                    buttons: 1,
                }));
                expect(document.captureElement).to.equal(null);
            } finally {
                if (origUaDesc) {
                    Object.defineProperty(navigator, 'userAgent', origUaDesc);
                } else {
                    delete navigator.userAgent;
                }
            }

            setCapture(target);
            sawProxiedMove = false;
            proxyElem.dispatchEvent(new MouseEvent('mousemove', {
                bubbles: true,
                cancelable: true,
                buttons: 0,
                clientX: 100,
                clientY: 120,
            }));

            expect(sawProxiedMove).to.equal(true);
            expect(document.captureElement).to.equal(null);
            expect(proxyElem.style.display).to.equal('none');
        });

        it('resets capture recursion state if a target listener throws and ignores releaseCapture when idle', function () {
            expect(() => releaseCapture()).to.not.throw();

            let recovered = false;
            target.addEventListener('mousemove', () => {
                recovered = true;
            });

            const addListenerSpy = sinon.spy(window, 'addEventListener');
            let proxyHandler = null;
            try {
                setCapture(target);
                const moveCall = addListenerSpy.getCalls().find(c => c.args[0] === 'mousemove');
                proxyHandler = moveCall.args[1];
            } finally {
                addListenerSpy.restore();
            }

            const proxyElem = document.getElementById('noVNC_mouse_capture_elem');
            const origDispatchDesc = Object.getOwnPropertyDescriptor(target, 'dispatchEvent');
            target.dispatchEvent = () => {
                throw new Error('listener failure');
            };
            try {
                expect(() => {
                    proxyHandler(new MouseEvent('mousemove', {
                        bubbles: true,
                        buttons: 1,
                    }));
                }).to.throw('listener failure');
            } finally {
                if (origDispatchDesc) {
                    Object.defineProperty(target, 'dispatchEvent', origDispatchDesc);
                } else {
                    delete target.dispatchEvent;
                }
            }

            proxyElem.dispatchEvent(new MouseEvent('mousemove', {
                bubbles: true,
                buttons: 1,
            }));
            expect(recovered).to.equal(true);
            expect(isCaptureProxyEvent(null)).to.equal(false);
        });

        it('delegates to native target.setCapture and document.releaseCapture when available', function () {
            const nativeSet = sinon.spy();
            const nativeRelease = sinon.spy();
            target.setCapture = nativeSet;
            Object.defineProperty(document, 'releaseCapture', {
                value: nativeRelease,
                configurable: true,
                writable: true,
            });

            setCapture(target);
            expect(nativeSet.getCalls().length).to.equal(1);
            expect(document.captureElement).to.equal(target);
            expect(document.getElementById('noVNC_mouse_capture_elem')).to.equal(null);

            releaseCapture();
            expect(nativeRelease.getCalls().length).to.equal(1);
            expect(document.captureElement).to.equal(null);
        });
    });

    describe('RFB capture lifecycle and stuck-button recovery', function () {
        let clock;
        let raf;
        const realObserver = window.ResizeObserver;
        let container;
        let rfbs;
        let client;
        let pointerEvent;

        class FakeResizeObserver {
            constructor(handler) {
                this.fire = handler;
            }
            disconnect() {}
            observe() {}
            unobserve() {}
        }

        function createDefaultMapper() {
            const mapper = new MouseButtonMapper();
            mapper.set(0, XVNC_BUTTONS.LEFT_BUTTON);
            mapper.set(1, XVNC_BUTTONS.MIDDLE_BUTTON);
            mapper.set(2, XVNC_BUTTONS.RIGHT_BUTTON);
            mapper.set(3, XVNC_BUTTONS.BACK_BUTTON);
            mapper.set(4, XVNC_BUTTONS.FORWARD_BUTTON);
            return mapper;
        }

        function makeRFB() {
            const touchInput = document.createElement('textarea');
            const rfb = new RFB(container, touchInput, 'wss://host:8675');
            clock.tick();
            rfb._sock._websocket._open();
            rfb._rfbConnectionState = 'connected';
            rfb.focusOnClick = false;
            rfb.mouseButtonMapper = createDefaultMapper();
            rfb._display.resize(760, 560);
            shadowPolyfillCapture(rfb._canvas);
            rfbs.push(rfb);
            return rfb;
        }

        function pointerCalls() {
            return pointerEvent.getCalls().map(c => c.args.slice(1, 4));
        }

        function dispatchCanvasMouse(type, x, y, button, buttons) {
            const bounds = client._canvas.getBoundingClientRect();
            const ev = new MouseEvent(type, {
                bubbles: true,
                cancelable: true,
                clientX: Math.ceil(bounds.left + x),
                clientY: Math.ceil(bounds.top + y),
                button: button,
                buttons: buttons,
            });
            client._canvas.dispatchEvent(ev);
            return ev;
        }

        function dispatchProxyMouse(type, x, y, button, buttons) {
            const proxyElem = document.getElementById('noVNC_mouse_capture_elem');
            const bounds = client._canvas.getBoundingClientRect();
            const ev = new MouseEvent(type, {
                bubbles: true,
                cancelable: true,
                clientX: Math.ceil(bounds.left + x),
                clientY: Math.ceil(bounds.top + y),
                button: button,
                buttons: buttons,
            });
            proxyElem.dispatchEvent(ev);
            return ev;
        }

        before(FakeWebSocket.replace);
        after(FakeWebSocket.restore);

        before(function () {
            this.clock = clock = sinon.useFakeTimers(10000);
            raf = window.requestAnimationFrame;
            window.requestAnimationFrame = setTimeout;
            window.ResizeObserver = FakeResizeObserver;
        });

        after(function () {
            this.clock.restore();
            window.requestAnimationFrame = raf;
            window.ResizeObserver = realObserver;
        });

        beforeEach(function () {
            container = document.createElement('div');
            container.style.position = 'fixed';
            container.style.left = '0px';
            container.style.top = '0px';
            container.style.width = '760px';
            container.style.height = '560px';
            document.body.appendChild(container);
            rfbs = [];
            pointerEvent = sinon.spy(RFB.messages, 'pointerEvent');
            client = makeRFB();
        });

        afterEach(function () {
            rfbs.forEach((rfb) => {
                if (rfb._rfbConnectionState !== 'disconnected') {
                    rfb.disconnect();
                }
            });
            rfbs = [];
            pointerEvent.restore();
            if (container && container.parentNode) {
                container.parentNode.removeChild(container);
            }
            container = null;
        });

        it('forwards drag motion immediately without buffering and preserves chorded button capture until final release', function () {
            dispatchCanvasMouse('mousedown', 250, 250, 0, 1);
            expect(document.captureElement).to.equal(client._canvas);

            clock.tick(20);
            dispatchProxyMouse('mousemove', 262, 250, 0, 1);
            expect(pointerCalls()).to.deep.equal([
                [250, 250, 0x1],
                [262, 250, 0x1],
            ]);

            dispatchProxyMouse('mousedown', 262, 250, 2, 5);
            clock.tick(20);
            dispatchProxyMouse('mouseup', 262, 250, 0, 4);
            expect(client._mouseButtonMask).to.equal(0x4);
            expect(document.captureElement).to.equal(client._canvas);

            clock.tick(20);
            dispatchProxyMouse('mouseup', 265, 250, 2, 0);
            expect(client._mouseButtonMask).to.equal(0);
            expect(document.captureElement).to.equal(null);
            expect(pointerCalls()).to.deep.equal([
                [250, 250, 0x1],
                [262, 250, 0x1],
                [262, 250, 0x5],
                [262, 250, 0x4],
                [265, 250, 0x0],
            ]);
        });

        it('recovers from missed mouseup on single display without dragging to the new pointer position', function () {
            // Case 1: missed mouseup followed by mousemove with buttons=0 via capture proxy
            dispatchCanvasMouse('mousedown', 160, 20, 0, 1);
            clock.tick(200);
            dispatchProxyMouse('mousemove', 380, 280, 0, 0);

            expect(document.captureElement).to.equal(null);
            expect(client._mouseButtonMask).to.equal(0);
            expect(pointerCalls()).to.deep.equal([
                [160, 20, 0x1],
                [160, 20, 0x0],
                [380, 280, 0x0],
            ]);

            // Case 2: missed mouseup followed directly by mousedown of same button at new position
            pointerEvent.resetHistory();
            clock.tick(30);
            dispatchCanvasMouse('mousedown', 160, 20, 0, 1);
            clock.tick(200);
            dispatchProxyMouse('mousedown', 380, 280, 0, 1);

            expect(document.captureElement).to.equal(client._canvas);
            expect(client._mouseButtonMask).to.equal(0x1);
            expect(pointerCalls()).to.deep.equal([
                [160, 20, 0x1],
                [160, 20, 0x0],
                [380, 280, 0x1],
            ]);

            // Case 3: chorded buttons where one missed mouseup and the other releases with buttons=0
            pointerEvent.resetHistory();
            clock.tick(30);
            dispatchProxyMouse('mousedown', 380, 280, 2, 5);
            dispatchProxyMouse('mouseup', 380, 280, 0, 0);
            expect(client._mouseButtonMask).to.equal(0);
            expect(document.captureElement).to.equal(null);
            expect(pointerCalls()).to.deep.equal([
                [380, 280, 0x5],
                [380, 280, 0x4],
                [380, 280, 0x0],
            ]);

            // Case 4: _heldPointerPos clears when mask returns to 0 even if viewOnly was toggled on
            clock.tick(30);
            dispatchCanvasMouse('mousedown', 120, 90, 0, 1);
            expect(client._heldPointerPos).to.deep.equal({ x: 120, y: 90 });
            client.viewOnly = true;
            dispatchProxyMouse('mouseup', 120, 90, 0, 0);
            expect(client._mouseButtonMask).to.equal(0);
            expect(client._heldPointerPos).to.equal(null);
            client.viewOnly = false;
        });

        it('preserves active drag on non-desktop user agents when mousemove reports buttons=0 and recovers on re-press', function () {
            const origUaDesc = Object.getOwnPropertyDescriptor(navigator, 'userAgent');
            Object.defineProperty(navigator, 'userAgent', {
                value: 'Mozilla/5.0 (Linux; Android 12; Quest 3) AppleWebKit/537.36 OculusBrowser/30.0',
                configurable: true,
            });
            try {
                // 1. Active drag with buttons=0 on mousemove (KASM-5697) must keep capture and button mask
                dispatchCanvasMouse('mousedown', 180, 90, 0, 1);
                expect(document.captureElement).to.equal(client._canvas);
                expect(client._mouseButtonMask).to.equal(0x1);

                clock.tick(40);
                dispatchProxyMouse('mousemove', 260, 140, 0, 0);
                expect(document.captureElement).to.equal(client._canvas);
                expect(client._mouseButtonMask).to.equal(0x1);

                dispatchProxyMouse('mouseup', 260, 140, 0, 0);
                expect(document.captureElement).to.equal(null);
                expect(client._mouseButtonMask).to.equal(0);
                expect(pointerCalls()).to.deep.equal([
                    [180, 90, 0x1],
                    [260, 140, 0x1],
                    [260, 140, 0x0],
                ]);

                // 2. Missed mouseup on non-desktop UA recovers cleanly on subsequent mousedown of same button
                pointerEvent.resetHistory();
                clock.tick(40);
                dispatchCanvasMouse('mousedown', 180, 90, 0, 1);
                clock.tick(40);
                dispatchProxyMouse('mousemove', 260, 140, 0, 0);
                dispatchProxyMouse('mousedown', 320, 200, 0, 1);
                dispatchProxyMouse('mouseup', 320, 200, 0, 0);
                expect(document.captureElement).to.equal(null);
                expect(client._mouseButtonMask).to.equal(0);
                expect(pointerCalls()).to.deep.equal([
                    [180, 90, 0x1],
                    [260, 140, 0x1],
                    [260, 140, 0x0],
                    [320, 200, 0x1],
                    [320, 200, 0x0],
                ]);

                // 3. dragViewport panning stays active on non-desktop UA when mousemove reports buttons=0
                client.dragViewport = true;
                dispatchCanvasMouse('mousedown', 40, 40, 0, 1);
                dispatchProxyMouse('mousemove', 90, 40, 0, 0);
                expect(client._viewportDragging).to.equal(true);
                expect(client._viewportHasMoved).to.equal(true);
                expect(document.captureElement).to.equal(client._canvas);
                dispatchProxyMouse('mouseup', 90, 40, 0, 0);
                expect(client._viewportDragging).to.equal(false);
                expect(document.captureElement).to.equal(null);
                client.dragViewport = false;
            } finally {
                client.dragViewport = false;
                if (origUaDesc) {
                    Object.defineProperty(navigator, 'userAgent', origUaDesc);
                } else {
                    delete navigator.userAgent;
                }
            }
        });

        it('releases stuck buttons via directMouseEvent on DOM mousemove and mousedown when pointerLock and directMouseEnabled are active', function () {
            const directMouseSpy = sinon.spy(RFB.messages, 'directMouseEvent');
            const origScreens = client._display._screens;
            try {
                client._pointerLock = true;
                client._directMouseEnabled = true;
                // Multi-screen triggers reliable buttons even on untrusted synthetic DOM MouseEvents
                client._display._screens = [origScreens[0], { x: 760, y: 0, serverWidth: 760, serverHeight: 560, scale: 1 }];

                // 1. Mismatch recovery via DOM mousemove with buttons=0
                dispatchCanvasMouse('mousedown', 100, 100, 0, 1);
                expect(client._heldPointerPos).to.equal(null);
                clock.tick(30);
                client._canvas.dispatchEvent(new MouseEvent('mousemove', {
                    bubbles: true,
                    cancelable: true,
                    movementX: 12,
                    movementY: 4,
                    buttons: 0,
                }));

                expect(client._mouseButtonMask).to.equal(0);
                expect(directMouseSpy.getCalls().map(c => c.args.slice(1))).to.deep.equal([
                    [0, 0, 0x1, 0, 0],
                    [0, 0, 0x0, 0, 0],
                    [12, 4, 0x0, 0, 0],
                ]);

                // 2. Direct re-press recovery when same button bit is already set
                directMouseSpy.resetHistory();
                clock.tick(30);
                dispatchCanvasMouse('mousedown', 100, 100, 0, 1);
                dispatchCanvasMouse('mousedown', 120, 120, 0, 1);
                expect(client._mouseButtonMask).to.equal(0x1);
                expect(directMouseSpy.getCalls().map(c => c.args.slice(1))).to.deep.equal([
                    [0, 0, 0x1, 0, 0],
                    [0, 0, 0x0, 0, 0],
                    [0, 0, 0x1, 0, 0],
                ]);
            } finally {
                directMouseSpy.restore();
                client._display._screens = origScreens;
                client._pointerLock = false;
                client._directMouseEnabled = false;
                client._mouseButtonMask = 0;
            }
        });

        it('releases stuck buttons, primary capture, and pending move timers across multi-monitor transitions', function () {
            const scale = 0.5;
            client._display._scale = scale;
            client._display._screens = [
                { x: 0, y: 0, serverWidth: 760, serverHeight: 560, scale },
                { x: 760, y: 0, serverWidth: 760, serverHeight: 560, scale },
            ];

            // 1. Press on primary via DOM (acquires capture), move within throttle window (arms _mouseMoveTimer), then release on secondary
            dispatchCanvasMouse('mousedown', 100, 50, 0, 1);
            expect(document.captureElement).to.equal(client._canvas);
            expect(client._heldPointerPos).to.deep.equal({ x: 200, y: 100 });

            clock.tick(20);
            dispatchProxyMouse('mousemove', 110, 50, 0, 1);
            dispatchProxyMouse('mousemove', 115, 50, 0, 1);
            expect(client._mouseMoveTimer).to.not.equal(null);

            client._handleControlMessage({
                data: {
                    eventType: 'mouseup',
                    screenIndex: 1,
                    args: [120, 40, 0x1],
                },
            });
            expect(client._mouseMoveTimer).to.equal(null);
            expect(client._mouseButtonMask).to.equal(0);
            expect(document.captureElement).to.equal(null);
            clock.tick(30);
            expect(pointerCalls()).to.deep.equal([
                [200, 100, 0x1],
                [220, 100, 0x1],
                [1000, 80, 0x0],
            ]);

            // 2. Press on primary (captures), missed mouseup, then secondary mousemove with buttons=false
            pointerEvent.resetHistory();
            clock.tick(30);
            dispatchCanvasMouse('mousedown', 100, 50, 0, 1);
            expect(document.captureElement).to.equal(client._canvas);
            client._handleControlMessage({
                data: {
                    eventType: 'mousemove',
                    screenIndex: 1,
                    args: [300, 40, false, false],
                },
            });

            expect(pointerCalls()).to.deep.equal([
                [200, 100, 0x1],
                [200, 100, 0x0],
                [1360, 80, 0x0],
            ]);
            expect(client._mouseButtonMask).to.equal(0);
            expect(document.captureElement).to.equal(null);

            // 3. Press on primary (captures), missed mouseup, then secondary mousedown releases primary capture and stuck bit
            pointerEvent.resetHistory();
            clock.tick(30);
            dispatchCanvasMouse('mousedown', 80, 40, 0, 1);
            expect(document.captureElement).to.equal(client._canvas);
            client._handleControlMessage({
                data: {
                    eventType: 'mousedown',
                    screenIndex: 1,
                    args: [100, 50, 0x1],
                },
            });
            expect(document.captureElement).to.equal(null);
            expect(client._heldPointerPos).to.deep.equal({ x: 960, y: 100 });
            expect(pointerCalls()).to.deep.equal([
                [160, 80, 0x1],
                [160, 80, 0x0],
                [960, 100, 0x1],
            ]);

            // 3b. Primary dragViewport missed mouseup clears _viewportDragging and capture on secondary mousemove
            client.dragViewport = true;
            dispatchCanvasMouse('mousedown', 80, 40, 0, 1);
            expect(client._viewportDragging).to.equal(true);
            expect(document.captureElement).to.equal(client._canvas);
            client._handleControlMessage({
                data: {
                    eventType: 'mousemove',
                    screenIndex: 1,
                    args: [100, 50, false, false],
                },
            });
            expect(client._viewportDragging).to.equal(false);
            expect(document.captureElement).to.equal(null);
            client.dragViewport = false;

            // 3c. Primary left capture releases even when secondary mousedown presses a different button (0x4)
            pointerEvent.resetHistory();
            clock.tick(30);
            dispatchCanvasMouse('mousedown', 80, 40, 0, 1);
            expect(document.captureElement).to.equal(client._canvas);
            client._handleControlMessage({
                data: {
                    eventType: 'mousedown',
                    screenIndex: 1,
                    args: [100, 50, 0x4],
                },
            });
            expect(document.captureElement).to.equal(null);
            client._handleControlMessage({
                data: {
                    eventType: 'mouseup',
                    screenIndex: 1,
                    args: [100, 50, 0x1 | 0x4],
                },
            });
            expect(client._mouseButtonMask).to.equal(0);

            // 4. Reverse: missed mouseup on secondary, then click on primary
            pointerEvent.resetHistory();
            client._handleControlMessage({
                data: {
                    eventType: 'mousedown',
                    screenIndex: 1,
                    args: [100, 50, 0x1],
                },
            });
            pointerEvent.resetHistory();
            clock.tick(30);
            client._handleMouseButton(50, 25, true, 0x1);
            expect(pointerCalls()).to.deep.equal([
                [960, 100, 0x0],
                [100, 50, 0x1],
            ]);

            // 5. Secondary RFB window releases capture on mousemove with buttons=0 (Firefox native capture fallback)
            const origProxy = client._proxyRFBMessage;
            const proxied = [];
            client._proxyRFBMessage = (type, args) => {
                proxied.push([type, args]);
            };
            client._isPrimaryDisplay = false;
            try {
                setCapture(client._canvas);
                expect(document.captureElement).to.equal(client._canvas);
                dispatchCanvasMouse('mousemove', 60, 70, 0, 0);
                expect(document.captureElement).to.equal(null);
                expect(proxied[0][0]).to.equal('mousemove');
                expect(proxied[0][1][2]).to.equal(false);
            } finally {
                client._isPrimaryDisplay = true;
                client._proxyRFBMessage = origProxy;
            }
        });

        it('releases native Element.setCapture on missed mouseup for both normal buttons and dragViewport', function () {
            const nativeSet = sinon.spy();
            const nativeRelease = sinon.spy();
            const origCanvasSetDesc = Object.getOwnPropertyDescriptor(client._canvas, 'setCapture');
            const origDocReleaseDesc = Object.getOwnPropertyDescriptor(document, 'releaseCapture');
            const origScreens = client._display._screens;

            Object.defineProperty(client._canvas, 'setCapture', {
                value: nativeSet,
                configurable: true,
                writable: true,
            });
            Object.defineProperty(document, 'releaseCapture', {
                value: nativeRelease,
                configurable: true,
                writable: true,
            });
            // Multi-screen exercises reliable buttons when isCaptureProxyEvent(ev) is false (native capture)
            client._display._screens = [origScreens[0], { x: 760, y: 0, serverWidth: 760, serverHeight: 560, scale: 1 }];

            try {
                // 1. Normal button missed mouseup releases stuck button and native capture
                dispatchCanvasMouse('mousedown', 100, 80, 0, 1);
                expect(nativeSet.getCalls().length).to.equal(1);
                expect(document.captureElement).to.equal(client._canvas);

                clock.tick(30);
                dispatchCanvasMouse('mousemove', 180, 120, 0, 0);
                expect(nativeRelease.getCalls().length).to.equal(1);
                expect(document.captureElement).to.equal(null);
                expect(client._mouseButtonMask).to.equal(0);
                expect(pointerCalls()).to.deep.equal([
                    [100, 80, 0x1],
                    [100, 80, 0x0],
                    [180, 120, 0x0],
                ]);

                // 2. dragViewport missed mouseup (_mouseButtonMask === 0) clears _viewportDragging and native capture
                client.dragViewport = true;
                dispatchCanvasMouse('mousedown', 40, 40, 0, 1);
                expect(nativeSet.getCalls().length).to.equal(2);
                expect(client._viewportDragging).to.equal(true);
                expect(client._mouseButtonMask).to.equal(0);
                expect(document.captureElement).to.equal(client._canvas);

                dispatchCanvasMouse('mousemove', 90, 40, 0, 0);
                expect(client._viewportDragging).to.equal(false);
                expect(document.captureElement).to.equal(null);
                expect(nativeRelease.getCalls().length).to.equal(2);
            } finally {
                client.dragViewport = false;
                client._display._screens = origScreens;
                releaseCapture();
                if (origCanvasSetDesc) {
                    Object.defineProperty(client._canvas, 'setCapture', origCanvasSetDesc);
                } else {
                    delete client._canvas.setCapture;
                }
                if (origDocReleaseDesc) {
                    Object.defineProperty(document, 'releaseCapture', origDocReleaseDesc);
                } else {
                    delete document.releaseCapture;
                }
            }
        });

        it('preserves legacy untrusted canvas drag events, simulated gestures, dragViewport, viewOnly, pointerLock, and disconnect cleanup', function () {
            // 1. Legacy untrusted MouseEvent('mousemove') omitting `buttons` during drag
            dispatchCanvasMouse('mousedown', 10, 10, 0, 1);
            dispatchCanvasMouse('mousemove', 50, 70, 0, 0);
            dispatchCanvasMouse('mouseup', 50, 70, 0, 0);
            expect(pointerCalls()).to.deep.equal([
                [10, 10, 0x1],
                [50, 70, 0x1],
                [50, 70, 0x0],
            ]);

            // 2. Simulated Gesture drag works identically
            pointerEvent.resetHistory();
            clock.tick(30);
            client._fakeMouseMove({ detail: { clientX: 20, clientY: 40 } }, 20, 40);
            client._fakeMouseButton(20, 40, true, 0x1);
            clock.tick(50);
            client._fakeMouseMove({ detail: { clientX: 30, clientY: 50 } }, 30, 50);
            client._fakeMouseButton(30, 50, false, 0x1);
            expect(pointerCalls()).to.deep.equal([
                [20, 40, 0x0],
                [20, 40, 0x1],
                [30, 50, 0x1],
                [30, 50, 0x0],
            ]);

            // 3. viewOnly ignores button/move/latency sends cleanly with zero leaked mask or capture
            pointerEvent.resetHistory();
            clock.tick(30);
            const trackSpy = sinon.spy(client, '_trackInputEvent');
            client._inputLatencyEnabled = true;
            try {
                client.viewOnly = true;
                dispatchCanvasMouse('mousedown', 100, 100, 0, 1);
                expect(document.captureElement).to.equal(null);
                expect(client._mouseButtonMask).to.equal(0);
                expect(client._heldPointerPos).to.equal(null);
                dispatchCanvasMouse('mouseup', 100, 100, 0, 0);
                expect(pointerCalls()).to.deep.equal([]);
                expect(trackSpy.getCalls().length).to.equal(0);

                // Missed mouseup while viewOnly=true must not leak phantom button mask when viewOnly=false
                dispatchCanvasMouse('mousedown', 110, 110, 0, 1);
                client.viewOnly = false;
                clock.tick(30);
                dispatchCanvasMouse('mousemove', 130, 140, 0, 0);
                expect(client._mouseButtonMask).to.equal(0);
                expect(document.captureElement).to.equal(null);
                expect(pointerCalls()).to.deep.equal([
                    [130, 140, 0x0],
                ]);
            } finally {
                client.viewOnly = false;
                client._inputLatencyEnabled = false;
                trackSpy.restore();
            }

            // 4. dragViewport handles DOM click, missed mouseup, and mid-drag toggle without capture or pointer leaks
            pointerEvent.resetHistory();
            clock.tick(30);
            client.dragViewport = true;
            dispatchCanvasMouse('mousedown', 13, 9, 0, 1);
            expect(document.captureElement).to.equal(client._canvas);
            dispatchProxyMouse('mouseup', 13, 9, 0, 0);
            expect(document.captureElement).to.equal(null);
            expect(pointerCalls()).to.deep.equal([
                [13, 9, 0x1],
                [13, 9, 0x0],
            ]);

            // 4b. dragViewport missed mouseup followed by proxy mousemove with buttons=0 clears _viewportDragging
            pointerEvent.resetHistory();
            clock.tick(30);
            dispatchCanvasMouse('mousedown', 20, 20, 0, 1);
            expect(client._viewportDragging).to.equal(true);
            dispatchProxyMouse('mousemove', 60, 20, 0, 0);
            expect(client._viewportDragging).to.equal(false);
            expect(document.captureElement).to.equal(null);
            dispatchCanvasMouse('mousedown', 30, 30, 0, 1);
            expect(client._viewportDragging).to.equal(true);
            dispatchProxyMouse('mouseup', 30, 30, 0, 0);

            // 4c. toggling dragViewport off mid-drag cleans up _viewportDragging and capture on mouseup with no remote events
            pointerEvent.resetHistory();
            clock.tick(30);
            dispatchCanvasMouse('mousedown', 20, 20, 0, 1);
            dispatchProxyMouse('mousemove', 60, 20, 0, 1);
            expect(client._viewportHasMoved).to.equal(true);
            client.dragViewport = false;
            dispatchProxyMouse('mouseup', 60, 20, 0, 0);
            expect(client._viewportDragging).to.equal(false);
            expect(document.captureElement).to.equal(null);
            expect(pointerCalls()).to.deep.equal([]);

            // 5. _handlePointerLockChange clears capture when locked
            pointerEvent.resetHistory();
            clock.tick(30);
            dispatchCanvasMouse('mousedown', 200, 200, 0, 1);
            expect(document.captureElement).to.equal(client._canvas);
            const origLockDesc = Object.getOwnPropertyDescriptor(document, 'pointerLockElement');
            Object.defineProperty(document, 'pointerLockElement', {
                value: client._canvas,
                configurable: true,
            });
            try {
                client._handlePointerLockChange();
                expect(client._pointerLock).to.equal(true);
                expect(document.captureElement).to.equal(null);
            } finally {
                if (origLockDesc) {
                    Object.defineProperty(document, 'pointerLockElement', origLockDesc);
                } else {
                    delete document.pointerLockElement;
                }
            }
            client._pointerLock = false;
            client._mouseButtonMask = 0;

            // 6. disconnect() cleans up held pointer, pending move timer, and mouse capture
            pointerEvent.resetHistory();
            clock.tick(30);
            dispatchCanvasMouse('mousedown', 220, 220, 0, 1);
            dispatchProxyMouse('mousemove', 235, 220, 0, 1);
            dispatchProxyMouse('mousemove', 240, 220, 0, 1);
            expect(client._mouseMoveTimer).to.not.equal(null);
            expect(document.captureElement).to.equal(client._canvas);
            client.disconnect();
            expect(client._mouseMoveTimer).to.equal(null);
            expect(client._heldPointerPos).to.equal(null);
            expect(document.captureElement).to.equal(null);
            clock.tick(200);
            expect(pointerCalls()).to.deep.equal([
                [220, 220, 0x1],
                [235, 220, 0x1],
            ]);
        });
    });
});
