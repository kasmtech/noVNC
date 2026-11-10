const expect = chai.expect;

import Base64 from '../core/base64.js';
import Display from '../core/display.js';

describe('Display/Canvas Helper', function () {
    const checkedData = new Uint8ClampedArray([
        0x00, 0x00, 0xff, 255, 0x00, 0x00, 0xff, 255, 0x00, 0xff, 0x00, 255, 0x00, 0xff, 0x00, 255,
        0x00, 0x00, 0xff, 255, 0x00, 0x00, 0xff, 255, 0x00, 0xff, 0x00, 255, 0x00, 0xff, 0x00, 255,
        0x00, 0xff, 0x00, 255, 0x00, 0xff, 0x00, 255, 0x00, 0x00, 0xff, 255, 0x00, 0x00, 0xff, 255,
        0x00, 0xff, 0x00, 255, 0x00, 0xff, 0x00, 255, 0x00, 0x00, 0xff, 255, 0x00, 0x00, 0xff, 255
    ]);

    const basicData = new Uint8ClampedArray([0xff, 0x00, 0x00, 255, 0x00, 0xff, 0x00, 255, 0x00, 0x00, 0xff, 255, 0xff, 0xff, 0xff, 255]);

    function makeImageCanvas(inputData, width, height) {
        const canvas = document.createElement('canvas');
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext('2d');
        const data = new ImageData(inputData, width, height);
        ctx.putImageData(data, 0, 0);
        return canvas;
    }

    function makeImagePng(inputData, width, height) {
        const canvas = makeImageCanvas(inputData, width, height);
        const url = canvas.toDataURL();
        const data = url.split(",")[1];
        return Base64.decode(data);
    }

    describe('viewport handling', function () {
        let display;
        beforeEach(function () {
            display = new Display(document.createElement('canvas'));
            display.clipViewport = true;
            display.resize(5, 5);
            display.viewportChangeSize(3, 3);
            display.viewportChangePos(1, 1);
        });

        it('should take viewport location into consideration when drawing images', function () {
            display.resize(4, 4);
            display.viewportChangeSize(2, 2);
            display.drawImage(makeImageCanvas(basicData, 4, 1), 1, 1);
            display.flip();

            const expected = new Uint8Array(16);
            for (let i = 0; i < 8; i++) { expected[i] = basicData[i]; }
            for (let i = 8; i < 16; i++) { expected[i] = 0; }
            expect(display).to.have.displayed(expected);
        });

        it('should resize the target canvas when resizing the viewport', function () {
            display.viewportChangeSize(2, 2);
            expect(display._target.width).to.equal(2);
            expect(display._target.height).to.equal(2);
        });

        it('should move the viewport if necessary', function () {
            display.viewportChangeSize(5, 5);
            expect(display.absX(0)).to.equal(0);
            expect(display.absY(0)).to.equal(0);
            expect(display._target.width).to.equal(5);
            expect(display._target.height).to.equal(5);
        });

        it('should limit the viewport to the framebuffer size', function () {
            display.viewportChangeSize(6, 6);
            expect(display._target.width).to.equal(5);
            expect(display._target.height).to.equal(5);
        });

        it('should redraw when moving the viewport', function () {
            display.flip = sinon.spy();
            display.viewportChangePos(-1, 1);
            expect(display.flip).to.have.been.calledOnce;
        });

        it('should redraw when resizing the viewport', function () {
            display.flip = sinon.spy();
            display.viewportChangeSize(2, 2);
            expect(display.flip).to.have.been.calledOnce;
        });

        it('should show the entire framebuffer when disabling the viewport', function () {
            display.clipViewport = false;
            expect(display.absX(0)).to.equal(0);
            expect(display.absY(0)).to.equal(0);
            expect(display._target.width).to.equal(5);
            expect(display._target.height).to.equal(5);
        });

        it('should ignore viewport changes when the viewport is disabled', function () {
            display.clipViewport = false;
            display.viewportChangeSize(2, 2);
            display.viewportChangePos(1, 1);
            expect(display.absX(0)).to.equal(0);
            expect(display.absY(0)).to.equal(0);
            expect(display._target.width).to.equal(5);
            expect(display._target.height).to.equal(5);
        });

        it('should show the entire framebuffer just after enabling the viewport', function () {
            display.clipViewport = false;
            display.clipViewport = true;
            expect(display.absX(0)).to.equal(0);
            expect(display.absY(0)).to.equal(0);
            expect(display._target.width).to.equal(5);
            expect(display._target.height).to.equal(5);
        });
    });

    describe('resizing', function () {
        let display;
        beforeEach(function () {
            display = new Display(document.createElement('canvas'));
            display.clipViewport = false;
            display.resize(4, 4);
        });

        it('should change the size of the logical canvas', function () {
            display.resize(5, 7);
            expect(display._fbWidth).to.equal(5);
            expect(display._fbHeight).to.equal(7);
        });

        it('should keep the framebuffer data', function () {
            display.fillRect(0, 0, 4, 4, [0xff, 0, 0]);
            display.resize(2, 2);
            display.flip();
            const expected = [];
            for (let i = 0; i < 4 * 2*2; i += 4) {
                expected[i] = 0xff;
                expected[i+1] = expected[i+2] = 0;
                expected[i+3] = 0xff;
            }
            expect(display).to.have.displayed(new Uint8Array(expected));
        });

        describe('viewport', function () {
            beforeEach(function () {
                display.clipViewport = true;
                display.viewportChangeSize(3, 3);
                display.viewportChangePos(1, 1);
            });

            it('should keep the viewport position and size if possible', function () {
                display.resize(6, 6);
                expect(display.absX(0)).to.equal(1);
                expect(display.absY(0)).to.equal(1);
                expect(display._target.width).to.equal(3);
                expect(display._target.height).to.equal(3);
            });

            it('should move the viewport if necessary', function () {
                display.resize(3, 3);
                expect(display.absX(0)).to.equal(0);
                expect(display.absY(0)).to.equal(0);
                expect(display._target.width).to.equal(3);
                expect(display._target.height).to.equal(3);
            });

            it('should shrink the viewport if necessary', function () {
                display.resize(2, 2);
                expect(display.absX(0)).to.equal(0);
                expect(display.absY(0)).to.equal(0);
                expect(display._target.width).to.equal(2);
                expect(display._target.height).to.equal(2);
            });
        });
    });

    describe('rescaling', function () {
        let display;
        let canvas;

        beforeEach(function () {
            canvas = document.createElement('canvas');
            display = new Display(canvas);
            display.clipViewport = true;
            display.resize(4, 4);
            display.viewportChangeSize(3, 3);
            display.viewportChangePos(1, 1);
            document.body.appendChild(canvas);
        });

        afterEach(function () {
            document.body.removeChild(canvas);
        });

        it('should not change the bitmap size of the canvas', function () {
            display.scale = 2.0;
            expect(canvas.width).to.equal(3);
            expect(canvas.height).to.equal(3);
        });

        it('should change the effective rendered size of the canvas', function () {
            display.scale = 2.0;
            expect(canvas.clientWidth).to.equal(6);
            expect(canvas.clientHeight).to.equal(6);
        });

        it('should not change when resizing', function () {
            display.scale = 2.0;
            display.resize(5, 5);
            expect(display.scale).to.equal(2.0);
            expect(canvas.width).to.equal(3);
            expect(canvas.height).to.equal(3);
            expect(canvas.clientWidth).to.equal(6);
            expect(canvas.clientHeight).to.equal(6);
        });
    });

    describe('autoscaling', function () {
        let display;
        let canvas;

        beforeEach(function () {
            canvas = document.createElement('canvas');
            display = new Display(canvas);
            display.clipViewport = true;
            display.resize(4, 3);
            display.viewportChangeSize(4, 3);
            document.body.appendChild(canvas);
        });

        afterEach(function () {
            document.body.removeChild(canvas);
        });

        it('should preserve aspect ratio while autoscaling', function () {
            display.autoscale(16, 9);
            expect(canvas.clientWidth / canvas.clientHeight).to.equal(4 / 3);
        });

        it('should use width to determine scale when the current aspect ratio is wider than the target', function () {
            display.autoscale(9, 16);
            expect(display.absX(9)).to.equal(4);
            expect(display.absY(18)).to.equal(8);
            expect(canvas.clientWidth).to.equal(9);
            expect(canvas.clientHeight).to.equal(7); // round 9 / (4 / 3)
        });

        it('should use height to determine scale when the current aspect ratio is taller than the target', function () {
            display.autoscale(16, 9);
            expect(display.absX(9)).to.equal(3);
            expect(display.absY(18)).to.equal(6);
            expect(canvas.clientWidth).to.equal(12);  // 16 * (4 / 3)
            expect(canvas.clientHeight).to.equal(9);

        });

        it('should not change the bitmap size of the canvas', function () {
            display.autoscale(16, 9);
            expect(canvas.width).to.equal(4);
            expect(canvas.height).to.equal(3);
        });
    });

    describe('drawing', function () {

        // TODO(directxman12): improve the tests for each of the drawing functions to cover more than just the
        //                     basic cases
        let display;
        beforeEach(function () {
            display = new Display(document.createElement('canvas'));
            display.resize(4, 4);
        });

        it('should not draw directly on the target canvas', function () {
            display.fillRect(0, 0, 4, 4, [0xff, 0, 0]);
            display.flip();
            display.fillRect(0, 0, 4, 4, [0, 0xff, 0]);
            const expected = [];
            for (let i = 0; i < 4 * display._fbWidth * display._fbHeight; i += 4) {
                expected[i] = 0xff;
                expected[i+1] = expected[i+2] = 0;
                expected[i+3] = 0xff;
            }
            expect(display).to.have.displayed(new Uint8Array(expected));
        });

        it('should support filling a rectangle with particular color via #fillRect', function () {
            display.fillRect(0, 0, 4, 4, [0, 0xff, 0]);
            display.fillRect(0, 0, 2, 2, [0, 0, 0xff]);
            display.fillRect(2, 2, 2, 2, [0, 0, 0xff]);
            display.flip();
            expect(display).to.have.displayed(checkedData);
        });

        it('should support copying an portion of the canvas via #copyImage', function () {
            display.fillRect(0, 0, 4, 4, [0, 0xff, 0]);
            display.fillRect(0, 0, 2, 2, [0, 0, 0xff]);
            display.copyImage(0, 0, 2, 2, 2, 2);
            display.flip();
            expect(display).to.have.displayed(checkedData);
        });

        it('should support drawing images via #imageRect', function (done) {
            display.imageRect(0, 0, 4, 4, "image/png", makeImagePng(checkedData, 4, 4));
            display.flip();
            display.onflush = () => {
                expect(display).to.have.displayed(checkedData);
                done();
            };
            display.flush();
        });

        it('should support blit images with true color via #blitImage', function () {
            display.blitImage(0, 0, 4, 4, checkedData, 0);
            display.flip();
            expect(display).to.have.displayed(checkedData);
        });

        it('should support drawing an image object via #drawImage', function () {
            const img = makeImageCanvas(checkedData, 4, 4);
            display.drawImage(img, 0, 0);
            display.flip();
            expect(display).to.have.displayed(checkedData);
        });
    });

    describe('the render queue processor', function () {
        let display;
        beforeEach(function () {
            display = new Display(document.createElement('canvas'));
            display.resize(4, 4);
            sinon.spy(display, '_scanRenderQ');
        });

        it('should try to process an item when it is pushed on, if nothing else is on the queue', function () {
            display._renderQPush({ type: 'noop' });  // does nothing
            expect(display._scanRenderQ).to.have.been.calledOnce;
        });

        it('should not try to process an item when it is pushed on if we are waiting for other items', function () {
            display._renderQ.length = 2;
            display._renderQPush({ type: 'noop' });
            expect(display._scanRenderQ).to.not.have.been.called;
        });

        it('should wait until an image is loaded to attempt to draw it and the rest of the queue', function () {
            const img = { complete: false, width: 4, height: 4, addEventListener: sinon.spy() };
            display._renderQ = [{ type: 'img', x: 3, y: 4, width: 4, height: 4, img: img },
                                { type: 'fill', x: 1, y: 2, width: 3, height: 4, color: 5 }];
            display.drawImage = sinon.spy();
            display.fillRect = sinon.spy();

            display._scanRenderQ();
            expect(display.drawImage).to.not.have.been.called;
            expect(display.fillRect).to.not.have.been.called;
            expect(img.addEventListener).to.have.been.calledOnce;

            display._renderQ[0].img.complete = true;
            display._scanRenderQ();
            expect(display.drawImage).to.have.been.calledOnce;
            expect(display.fillRect).to.have.been.calledOnce;
            expect(img.addEventListener).to.have.been.calledOnce;
        });

        it('should call callback when queue is flushed', function () {
            display.onflush = sinon.spy();
            display.fillRect(0, 0, 4, 4, [0, 0xff, 0]);
            expect(display.onflush).to.not.have.been.called;
            display.flush();
            expect(display.onflush).to.have.been.calledOnce;
        });

        it('should draw a blit image on type "blit"', function () {
            display.blitImage = sinon.spy();
            display._renderQPush({ type: 'blit', x: 3, y: 4, width: 5, height: 6, data: [7, 8, 9] });
            expect(display.blitImage).to.have.been.calledOnce;
            expect(display.blitImage).to.have.been.calledWith(3, 4, 5, 6, [7, 8, 9], 0);
        });

        it('should copy a region on type "copy"', function () {
            display.copyImage = sinon.spy();
            display._renderQPush({ type: 'copy', x: 3, y: 4, width: 5, height: 6, oldX: 7, oldY: 8 });
            expect(display.copyImage).to.have.been.calledOnce;
            expect(display.copyImage).to.have.been.calledWith(7, 8, 3, 4, 5, 6);
        });

        it('should fill a rect with a given color on type "fill"', function () {
            display.fillRect = sinon.spy();
            display._renderQPush({ type: 'fill', x: 3, y: 4, width: 5, height: 6, color: [7, 8, 9]});
            expect(display.fillRect).to.have.been.calledOnce;
            expect(display.fillRect).to.have.been.calledWith(3, 4, 5, 6, [7, 8, 9]);
        });

        it('should draw an image from an image object on type "img" (if complete)', function () {
            display.drawImage = sinon.spy();
            display._renderQPush({ type: 'img', x: 3, y: 4, img: { complete: true } });
            expect(display.drawImage).to.have.been.calledOnce;
            expect(display.drawImage).to.have.been.calledWith({ complete: true }, 3, 4);
        });
    });

    // These need a canvas inside a sized container, which the constructor
    // reads its dimensions from.
    function makeAttachedDisplay() {
        const container = document.createElement('div');
        container.style.width = '16px';
        container.style.height = '16px';
        document.body.appendChild(container);
        const canvas = document.createElement('canvas');
        container.appendChild(canvas);
        const display = new Display(canvas);
        display.resize(16, 16);
        display.clear();
        return { display, container };
    }

    function rect(frameId, x, y, width, height, type='fill') {
        return { type, frame_id: frameId, x, y, width, height,
                 color: [0, 0, 0], screenLocations: [] };
    }

    describe('lost rects', function () {
        let display, container, clock;
        beforeEach(function () {
            ({ display, container } = makeAttachedDisplay());
            display.onrectslost = sinon.spy();
            clock = sinon.useFakeTimers();
        });
        afterEach(function () {
            clock.restore();
            display.dispose();
            container.remove();
        });

        it('should report the bounds of lost rects once, after the current task', function () {
            display.markRectLost(2, 3, 4, 5);
            display.markRectLost(8, 1, 2, 2);
            expect(display.onrectslost).to.not.have.been.called;
            clock.tick(0);
            expect(display.onrectslost).to.have.been.calledOnce;
            expect(display.onrectslost).to.have.been.calledWith(2, 1, 8, 7);

            display.markRectLost(0, 0, 1, 1);
            clock.tick(0);
            expect(display.onrectslost).to.have.been.calledTwice;
            expect(display.onrectslost.secondCall).to.have.been.calledWith(0, 0, 1, 1);
        });

        it('should ignore empty rects', function () {
            display.markRectLost(1, 1, 0, 4);
            clock.tick(0);
            expect(display.onrectslost).to.not.have.been.called;
        });

        it('should report rects older than every queued frame', function () {
            for (let id = 5; id <= 7; id++) {
                display._asyncRenderQPush(rect(id, 0, 0, 1, 1));
            }
            display._asyncRenderQPush(rect(4, 2, 2, 3, 3));
            display._asyncRenderQPush({ type: 'flip', frame_id: 4, rect_cnt: 2,
                                        screenLocations: [] });
            clock.tick(0);
            expect(display.onrectslost).to.have.been.calledOnce;
            expect(display.onrectslost).to.have.been.calledWith(2, 2, 3, 3);
        });

        it('should report the rects of a dropped frame', function () {
            display._asyncRenderQPush(rect(5, 1, 1, 2, 2));
            display._asyncRenderQPush(rect(5, 6, 6, 2, 2));
            display._asyncRenderQPush(rect(6, 0, 0, 1, 1));
            display._asyncRenderQPush(rect(7, 0, 0, 1, 1));
            display._asyncRenderQPush(rect(8, 0, 0, 1, 1));
            clock.tick(0);
            expect(display.onrectslost).to.have.been.calledOnce;
            expect(display.onrectslost).to.have.been.calledWith(1, 1, 7, 7);
        });

        it('should report images skipped when a frame is forced', function () {
            const img = { complete: false, addEventListener: sinon.spy() };
            display._asyncRenderQPush({ type: 'img', frame_id: 5, x: 4, y: 4,
                                        width: 8, height: 8, img,
                                        screenLocations: [] });
            display._asyncFrameComplete(0, true);
            clock.tick(0);
            expect(display.onrectslost).to.have.been.calledOnce;
            expect(display.onrectslost).to.have.been.calledWith(4, 4, 8, 8);
        });
    });

    describe('flushing the frame queue', function () {
        let display, container, clock;
        beforeEach(function () {
            ({ display, container } = makeAttachedDisplay());
            display.onflush = sinon.spy();
            clock = sinon.useFakeTimers();
        });
        afterEach(function () {
            clock.restore();
            display.dispose();
            container.remove();
        });

        // A frame whose rects have all arrived, but one is still decoding
        function queueDecodingFrame() {
            const img = { complete: false, addEventListener: sinon.spy() };
            display._asyncRenderQPush({ type: 'img', frame_id: 5, x: 0, y: 0,
                                        width: 4, height: 4, img,
                                        screenLocations: [] });
            display._asyncRenderQPush({ type: 'flip', frame_id: 5, rect_cnt: 2,
                                        screenLocations: [] });
            return img;
        }

        it('should wait for the oldest frame to be drawn before signalling', function () {
            const img = queueDecodingFrame();
            display.flush();
            expect(display.onflush).to.not.have.been.called;
            expect(display._asyncFrameQueue[0][0]).to.equal(5);

            img.complete = true;
            display._asyncFrameComplete(0);
            display._pushAsyncFrame();
            expect(display.onflush).to.have.been.calledOnce;
            expect(display._asyncFrameQueue[0][0]).to.equal(0);

            clock.tick(1000);
            expect(display.onflush).to.have.been.calledOnce;
        });

        it('should force the oldest frame if it is not drawn in time', function () {
            queueDecodingFrame();
            display.flush();
            clock.tick(499);
            expect(display.onflush).to.not.have.been.called;
            clock.tick(1);
            expect(display.onflush).to.have.been.calledOnce;
            expect(display._asyncFrameQueue[0][0]).to.equal(0);
        });

        it('should force the oldest frame at once if its rect count is unknown', function () {
            display._asyncRenderQPush(rect(5, 0, 0, 1, 1));
            display.flush();
            expect(display.onflush).to.have.been.calledOnce;
            expect(display._asyncFrameQueue[0][0]).to.equal(0);
        });
    });
});
