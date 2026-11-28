const expect = chai.expect;

import { encodings } from '../core/encodings.js';
import Display from '../core/display.js';
import { Canvas2DRenderer } from '../core/renderers/Canvas2DRenderer.js';
import { WebGLRenderer } from '../core/renderers/WebGLRenderer.js';
import WebRTCController from '../core/decoders/webrtc_controller.js';
import RFB from '../core/rfb.js';
import {
    MAX_NATIVE_ALIGNMENT_PAD,
    buildDprMediaQuery,
    clampNativeClientOffset,
    clampNativeCoordinate,
    computeScreenLayout,
    extractDevicePixelSize,
    floorEvenDimension,
    isCrispScale,
    isNativeSurfaceActive,
    isOneToOneScale,
    normalizePixelRatio,
    parsePositiveDimension,
    resolveImageRendering,
    resolveObservedDevicePixelSize,
    resolveWebGLTextureFilter,
    toEvenDimension
} from '../core/util/display-scaling.js';

describe('Display fractional-DPR scaling helpers and integration', function () {
    "use strict";

    describe('basic dimension, DPR, and media-query helpers', function () {
        it('should normalize invalid devicePixelRatio values to 1', function () {
            expect(normalizePixelRatio(undefined)).to.equal(1);
            expect(normalizePixelRatio(null)).to.equal(1);
            expect(normalizePixelRatio(0)).to.equal(1);
            expect(normalizePixelRatio(-1.5)).to.equal(1);
            expect(normalizePixelRatio(NaN)).to.equal(1);
            expect(normalizePixelRatio(Infinity)).to.equal(1);
            expect(normalizePixelRatio(2560 / 2327)).to.equal(2560 / 2327);
        });

        it('should build a tolerance-bounded resolution media query for fractional DPRs', function () {
            const dpr = 2560 / 2327;
            const query = buildDprMediaQuery(dpr);
            expect(query).to.equal('(min-resolution: 1.099129dppx) and (max-resolution: 1.101129dppx)');
            expect(buildDprMediaQuery(0)).to.equal('(min-resolution: 0.999dppx) and (max-resolution: 1.001dppx)');
        });

        it('should floor even dimensions and clamp sub-2px to 0', function () {
            expect(floorEvenDimension(0)).to.equal(0);
            expect(floorEvenDimension(1.9)).to.equal(0);
            expect(floorEvenDimension(-4)).to.equal(0);
            expect(floorEvenDimension(NaN)).to.equal(0);
            expect(floorEvenDimension(2)).to.equal(2);
            expect(floorEvenDimension(2327)).to.equal(2326);
        });

        it('should round positive dimensions down to even (minimum 2)', function () {
            expect(toEvenDimension(0)).to.equal(0);
            expect(toEvenDimension(-2)).to.equal(0);
            expect(toEvenDimension(NaN)).to.equal(0);
            expect(toEvenDimension(0.5)).to.equal(2);
            expect(toEvenDimension(1)).to.equal(2);
            expect(toEvenDimension(1080)).to.equal(1080);
            expect(toEvenDimension(2561)).to.equal(2560);
        });

        it('should parse positive dimensions cleanly', function () {
            expect(parsePositiveDimension(1920)).to.equal(1920);
            expect(parsePositiveDimension('1080')).to.equal(1080);
            expect(parsePositiveDimension('')).to.equal(null);
            expect(parsePositiveDimension('  ')).to.equal(null);
            expect(parsePositiveDimension('0')).to.equal(null);
            expect(parsePositiveDimension(-10)).to.equal(null);
            expect(parsePositiveDimension(null)).to.equal(null);
        });
    });

    describe('extractDevicePixelSize & resolveObservedDevicePixelSize', function () {
        it('should prefer devicePixelContentBoxSize when available', function () {
            const entry = {
                devicePixelContentBoxSize: [{ inlineSize: 2560, blockSize: 1440 }],
                contentRect: { width: 2326, height: 1308 }
            };
            expect(extractDevicePixelSize(entry, 2560 / 2327)).to.deep.equal({
                width: 2560,
                height: 1440
            });
        });

        it('should fall back to rounded contentRect * dpr when devicePixelContentBoxSize is absent', function () {
            const entry = {
                contentRect: { width: 1706.6667, height: 960 }
            };
            expect(extractDevicePixelSize(entry, 1.5)).to.deep.equal({
                width: 2560,
                height: 1440
            });
        });

        it('should return zeroes for empty or non-positive entries', function () {
            expect(extractDevicePixelSize(null, 1)).to.deep.equal({ width: 0, height: 0 });
            expect(extractDevicePixelSize({ contentRect: { width: 0, height: -5 } }, 1.25)).to.deep.equal({
                width: 0,
                height: 0
            });
        });

        it('should ignore cached observed pixel dimensions when DPR changes before ResizeObserver fires', function () {
            // Matching DPR uses observed dimensions
            expect(resolveObservedDevicePixelSize(2560, 1440, 1.25, 1.25, 2048, 1152)).to.deep.equal({
                width: 2560,
                height: 1440
            });
            // Stale DPR (moved from 1.0x monitor to 1.5x monitor with same 1920x1080 CSS box) falls back to css * currentDpr
            expect(resolveObservedDevicePixelSize(1920, 1080, 1.0, 1.5, 1920, 1080)).to.deep.equal({
                width: 2880,
                height: 1620
            });
        });
    });

    describe('isOneToOneScale, isCrispScale & resolveImageRendering', function () {
        it('should recognize fractional HiDPI 1:1 scales as 1:1 physical pixels', function () {
            const chromeOs110 = 2560 / 2327;
            expect(isOneToOneScale(1 / chromeOs110, chromeOs110)).to.equal(true);
            expect(isOneToOneScale(1 / 1.25, 1.25)).to.equal(true);
            expect(isOneToOneScale(1 / 1.5, 1.5)).to.equal(true);
            expect(isOneToOneScale(1 / 1.75, 1.75)).to.equal(true);
            expect(isOneToOneScale(1, 1)).to.equal(true);
            expect(isOneToOneScale(0.8, 1)).to.equal(false);
            expect(isOneToOneScale(1, 1.5)).to.equal(false);
            expect(isOneToOneScale(1, 2)).to.equal(false);
            expect(isOneToOneScale(1, 3)).to.equal(false);
        });

        it('should recognize both HiDPI 1:1 and unscaled integer DPRs (DPR 2 and 3 at scale 1) as crisp', function () {
            const chromeOs110 = 2560 / 2327;
            expect(isCrispScale(1 / chromeOs110, chromeOs110)).to.equal(true);
            expect(isCrispScale(1 / 1.5, 1.5)).to.equal(true);
            expect(isCrispScale(0.5, 2)).to.equal(true);
            expect(isCrispScale(1 / 3, 3)).to.equal(true);
            expect(isCrispScale(1, 1)).to.equal(true);
            expect(isCrispScale(1, 2)).to.equal(true);
            expect(isCrispScale(1, 3)).to.equal(true);
            expect(isCrispScale(1, undefined)).to.equal(true);
            expect(isCrispScale(1, 0)).to.equal(true);
            expect(isCrispScale(1, NaN)).to.equal(true);
            expect(isCrispScale(1, -2)).to.equal(true);
            expect(isCrispScale(1, 1.25)).to.equal(false);
            expect(isCrispScale(1, 1.5)).to.equal(false);
            expect(isCrispScale(1, 0.8)).to.equal(false);
            expect(isCrispScale(1, chromeOs110)).to.equal(false);
            expect(isCrispScale(0.75, 2)).to.equal(false);
            expect(isCrispScale(2, 1)).to.equal(false);
            expect(isCrispScale(NaN, 2)).to.equal(false);
            expect(isCrispScale(0, 2)).to.equal(false);
            expect(isCrispScale(-1, 2)).to.equal(false);
            expect(isCrispScale(Infinity, 2)).to.equal(false);
        });

        it('should disable smoothing on HiDPI 1:1 and on unscaled integer DPR 2 and 3 in auto mode', function () {
            const dpr = 2560 / 2327;
            expect(resolveImageRendering(0, 1 / dpr, dpr, 2326, false)).to.equal('pixelated');
            expect(resolveImageRendering(0, 1 / dpr, dpr, 2326, true)).to.equal('crisp-edges');
            expect(resolveImageRendering(0, 1, 2, 1920, false)).to.equal('pixelated');
            expect(resolveImageRendering(0, 1, 2, 1920, true)).to.equal('crisp-edges');
            expect(resolveImageRendering(0, 1, 3, 1920, false)).to.equal('pixelated');
            expect(resolveImageRendering(0, 1, 3, 1920, true)).to.equal('crisp-edges');
            expect(resolveImageRendering(0, 1, 2, 0, false)).to.equal(null);
            expect(resolveImageRendering(0, 1, 3, 0, false)).to.equal(null);
            expect(resolveImageRendering(0, 1, 1.5, 1920, false)).to.equal('auto');
            expect(resolveImageRendering(0, 1, dpr, 2326, false)).to.equal('auto');
            expect(resolveImageRendering(0, 0.75, dpr, 2326, false)).to.equal('auto');
            expect(resolveImageRendering(0, 1 / dpr, dpr, 0, false)).to.equal(null);
            expect(resolveImageRendering(1, 1, 1, 1920, false)).to.equal('auto');
            expect(resolveImageRendering(1, 1, 2, 1920, false)).to.equal('auto');
            expect(resolveImageRendering(1, 1, 3, 1920, false)).to.equal('auto');
            expect(resolveImageRendering(2, 0.5, 1, 1920, false)).to.equal('pixelated');
            expect(resolveImageRendering(2, 0.5, 2, 0, true)).to.equal('crisp-edges');
        });
    });

    describe('resolveWebGLTextureFilter', function () {
        it('should select NEAREST for 1:1 matching VideoFrames and LINEAR otherwise', function () {
            expect(resolveWebGLTextureFilter(0, true, 2560, 1440, 2560, 1440)).to.equal('NEAREST');
            expect(resolveWebGLTextureFilter(0, true, undefined, undefined, 2560, 1440)).to.equal('NEAREST');
            expect(resolveWebGLTextureFilter(0, true, 1280, 720, 2560, 1440)).to.equal('LINEAR');
            expect(resolveWebGLTextureFilter(0, false, 2560, 1440, 2560, 1440)).to.equal('LINEAR');
            expect(resolveWebGLTextureFilter(1, true, 2560, 1440, 2560, 1440)).to.equal('LINEAR');
            expect(resolveWebGLTextureFilter(2, false, 1280, 720, 2560, 1440)).to.equal('NEAREST');
        });
    });

    describe('computeScreenLayout', function () {
        it('should preserve exact native resolution on ChromeOS 110% (2560/2327) on 2560x1440', function () {
            const dpr = 2560 / 2327;
            const layout = computeScreenLayout({
                parentWidth: 2327,
                parentHeight: 1440 / dpr,
                devicePixelWidth: 2560,
                devicePixelHeight: 1440,
                devicePixelRatio: dpr,
                resolutionQuality: 2,
                hiDpi: true,
                disableLimit: false,
                disableScaling: false,
                streamMode: encodings.pseudoEncodingStreamingModeAVCSW,
                screenCount: 1
            });
            expect(layout.serverWidth).to.equal(2560);
            expect(layout.serverHeight).to.equal(1440);
            expect(layout.nativeEligible).to.equal(true);
            expect(layout.scale * dpr).to.be.closeTo(1, 1e-6);
        });

        it('should preserve exact 1080p and 1440p at 125%, 150%, 175%, and 200% without mod-16 cropping', function () {
            const cases = [
                { dpr: 1.25, physW: 2560, physH: 1440 },
                { dpr: 1.5, physW: 2560, physH: 1440 },
                { dpr: 1.75, physW: 2560, physH: 1440 },
                { dpr: 1.25, physW: 1920, physH: 1080 },
                { dpr: 1.5, physW: 1920, physH: 1080 },
                { dpr: 2.0, physW: 3840, physH: 2160 }
            ];
            for (const c of cases) {
                const layout = computeScreenLayout({
                    parentWidth: c.physW / c.dpr,
                    parentHeight: c.physH / c.dpr,
                    devicePixelWidth: c.physW,
                    devicePixelHeight: c.physH,
                    devicePixelRatio: c.dpr,
                    resolutionQuality: 2,
                    hiDpi: true,
                    disableLimit: false,
                    disableScaling: false,
                    streamMode: encodings.pseudoEncodingStreamingModeAVCHW,
                    screenCount: 1
                });
                expect(layout.serverWidth).to.equal(c.physW);
                expect(layout.serverHeight).to.equal(c.physH);
                expect(layout.nativeEligible).to.equal(true);
                expect(layout.scale * c.dpr).to.be.closeTo(1, 1e-6);
            }
        });

        it('should discard stale observed physical size when devicePixelObserverDpr mismatches current DPR', function () {
            const layout = computeScreenLayout({
                parentWidth: 1920,
                parentHeight: 1080,
                devicePixelWidth: 1920,
                devicePixelHeight: 1080,
                devicePixelObserverDpr: 1.0,
                devicePixelRatio: 1.5,
                resolutionQuality: 2,
                hiDpi: true,
                disableLimit: false,
                disableScaling: false,
                streamMode: encodings.pseudoEncodingStreamingModeAVCSW,
                screenCount: 1
            });
            expect(layout.serverWidth).to.equal(2880);
            expect(layout.serverHeight).to.equal(1620);
        });

        it('should align odd physical box sizes to mod-2 (at most 1px pad)', function () {
            const layout = computeScreenLayout({
                parentWidth: 1707.3333,
                parentHeight: 960.6667,
                devicePixelWidth: 2561,
                devicePixelHeight: 1441,
                devicePixelRatio: 1.5,
                resolutionQuality: 2,
                hiDpi: true,
                disableLimit: false,
                disableScaling: false,
                streamMode: encodings.pseudoEncodingStreamingModeAVCSW,
                screenCount: 1
            });
            expect(layout.serverWidth).to.equal(2560);
            expect(layout.serverHeight).to.equal(1440);
            expect(layout.nativeEligible).to.equal(true);
            expect(2561 - layout.serverWidth).to.be.at.most(1);
            expect(1441 - layout.serverHeight).to.be.at.most(1);
        });

        it('should disable native 1:1 mode for resize=scale/off, clipViewport, forced res, quality caps, and multi-monitor', function () {
            const base = {
                parentWidth: 2048,
                parentHeight: 1152,
                devicePixelWidth: 2560,
                devicePixelHeight: 1440,
                devicePixelRatio: 1.25,
                resolutionQuality: 2,
                hiDpi: true,
                disableLimit: false,
                disableScaling: false,
                clipViewport: false,
                streamMode: encodings.pseudoEncodingStreamingModeJpegWebp,
                screenCount: 1
            };

            expect(computeScreenLayout({ ...base, disableScaling: true }).nativeEligible).to.equal(false);
            expect(computeScreenLayout({ ...base, clipViewport: true }).nativeEligible).to.equal(false);
            expect(computeScreenLayout({ ...base, maxWidth: 1920, maxHeight: 1080 }).nativeEligible).to.equal(false);
            expect(computeScreenLayout({ ...base, resolutionQuality: 1 }).nativeEligible).to.equal(false);
            expect(computeScreenLayout({ ...base, resolutionQuality: 0 }).nativeEligible).to.equal(false);
            expect(computeScreenLayout({ ...base, screenCount: 2 }).nativeEligible).to.equal(false);
            expect(computeScreenLayout({ ...base, hiDpi: false }).nativeEligible).to.equal(false);

            for (const intDpr of [2, 3]) {
                const unscaledBase = {
                    parentWidth: 1920,
                    parentHeight: 1080,
                    devicePixelWidth: 1920 * intDpr,
                    devicePixelHeight: 1080 * intDpr,
                    devicePixelObserverDpr: intDpr,
                    devicePixelRatio: intDpr,
                    resolutionQuality: 2,
                    hiDpi: false,
                    disableLimit: false,
                    disableScaling: false,
                    clipViewport: false,
                    streamMode: encodings.pseudoEncodingStreamingModeAVCSW,
                    screenCount: 1
                };
                const remoteNonHiDpi = computeScreenLayout(unscaledBase);
                expect(remoteNonHiDpi.serverWidth).to.equal(1920);
                expect(remoteNonHiDpi.serverHeight).to.equal(1080);
                expect(remoteNonHiDpi.scale).to.equal(1);
                expect(remoteNonHiDpi.nativeEligible).to.equal(false);

                const resizeOff = computeScreenLayout({
                    ...unscaledBase,
                    disableScaling: true,
                    serverReportedWidth: 1920,
                    serverReportedHeight: 1080,
                    currentServerWidth: 1920,
                    currentServerHeight: 1080
                });
                expect(resizeOff.serverWidth).to.equal(1920);
                expect(resizeOff.serverHeight).to.equal(1080);
                expect(resizeOff.scale).to.equal(1);
                expect(resizeOff.nativeEligible).to.equal(false);

                const clipped = computeScreenLayout({ ...unscaledBase, clipViewport: true });
                expect(clipped.serverWidth).to.equal(1920);
                expect(clipped.serverHeight).to.equal(1080);
                expect(clipped.scale).to.equal(1);
                expect(clipped.nativeEligible).to.equal(false);
            }
        });
    });

    describe('isNativeSurfaceActive & clampNativeCoordinate', function () {
        const dpr = 1.25;
        const base = {
            nativeEligible: true,
            hasContainer: true,
            hasTarget: true,
            screenCount: 1,
            clipViewport: false,
            scale: 1 / dpr,
            devicePixelRatio: dpr,
            serverWidth: 2560,
            serverHeight: 1440,
            fbWidth: 2560,
            fbHeight: 1440,
            devicePixelWidth: 2560,
            devicePixelHeight: 1440
        };

        it('should activate only when scale * dpr is 1:1 and framebuffer matches within alignment pad', function () {
            expect(isNativeSurfaceActive(base)).to.equal(true);
            expect(isNativeSurfaceActive({
                ...base,
                devicePixelWidth: 2560 + MAX_NATIVE_ALIGNMENT_PAD,
                devicePixelHeight: 1440 + MAX_NATIVE_ALIGNMENT_PAD
            })).to.equal(true);
            // Non-1:1 scale factor (e.g. scale=1.0 at dpr=1.25, 2, or 3 when scaleViewport=false) must NOT activate
            expect(isNativeSurfaceActive({ ...base, scale: 1.0 })).to.equal(false);
            expect(isNativeSurfaceActive({ ...base, scale: 1.0, devicePixelRatio: 2 })).to.equal(false);
            expect(isNativeSurfaceActive({ ...base, scale: 1.0, devicePixelRatio: 3 })).to.equal(false);
        });

        it('should deactivate when leaving native mode or during resize debounce mismatch', function () {
            expect(isNativeSurfaceActive({ ...base, nativeEligible: false })).to.equal(false);
            expect(isNativeSurfaceActive({ ...base, screenCount: 2 })).to.equal(false);
            expect(isNativeSurfaceActive({ ...base, clipViewport: true })).to.equal(false);
            expect(isNativeSurfaceActive({
                ...base,
                serverWidth: 2000,
                serverHeight: 1200,
                devicePixelWidth: 2000,
                devicePixelHeight: 1200
            })).to.equal(false);
            expect(isNativeSurfaceActive({
                ...base,
                fbWidth: 2000,
                fbHeight: 1200
            })).to.equal(false);
        });

        it('should clamp native coordinates to valid server screen bounds', function () {
            expect(clampNativeCoordinate(2560, 0, 2560)).to.equal(2559);
            expect(clampNativeCoordinate(2559, 0, 2560)).to.equal(2559);
            expect(clampNativeCoordinate(-5, 0, 2560)).to.equal(0);
        });
    });

    describe('Renderer, Display, WebRTC, and RFB integration', function () {
        let origDprDescriptor;
        let origRaf;
        let origResizeObserver;
        let origMatchMedia;

        const expectedCrisp = (typeof navigator !== 'undefined' &&
            navigator.userAgent.toLowerCase().indexOf('firefox') > -1)
            ? 'crisp-edges'
            : 'pixelated';

        function setWindowDpr(value) {
            Object.defineProperty(window, 'devicePixelRatio', {
                value,
                configurable: true,
                writable: true
            });
        }

        function makeMockCanvas(width = 0, height = 0) {
            const ops = [];
            const ctx = {
                fillStyle: '#000000',
                save() { ops.push(['save', this.fillStyle]); this._savedFill = this.fillStyle; },
                restore() { this.fillStyle = this._savedFill || '#000000'; ops.push(['restore', this.fillStyle]); },
                fillRect(x, y, w, h) { ops.push(['fillRect', x, y, w, h, this.fillStyle]); },
                clearRect(x, y, w, h) { ops.push(['clearRect', x, y, w, h]); },
                getImageData(x, y, w, h) { return { width: w, height: h }; },
                putImageData(img, x, y) { ops.push(['putImageData', img.width, img.height, x, y]); },
                drawImage(...args) { ops.push(['drawImage', ...args]); }
            };
            const canvas = {
                width,
                height,
                style: { margin: 'auto', width: '', height: '', imageRendering: '' },
                parentNode: null,
                _ctx: ctx,
                _ops: ops,
                getContext() { return ctx; },
                getBoundingClientRect() {
                    return { left: 0, top: 0, width: 100, height: 100, right: 100, bottom: 100 };
                }
            };
            return canvas;
        }

        beforeEach(function () {
            origDprDescriptor = Object.getOwnPropertyDescriptor(window, 'devicePixelRatio');
            origRaf = window.requestAnimationFrame;
            origResizeObserver = window.ResizeObserver;
            origMatchMedia = window.matchMedia;
            window.requestAnimationFrame = () => 0;
        });

        afterEach(function () {
            if (origDprDescriptor) {
                Object.defineProperty(window, 'devicePixelRatio', origDprDescriptor);
            } else {
                delete window.devicePixelRatio;
            }
            window.requestAnimationFrame = origRaf;
            window.ResizeObserver = origResizeObserver;
            window.matchMedia = origMatchMedia;
        });

        it('Canvas2DRenderer should set pixelated on HiDPI 1:1, reset _prevDrawStyle on unbuffered resize, and redraw overlay', function () {
            const dpr = 2560 / 2327;
            setWindowDpr(dpr);

            const target = makeMockCanvas(2560, 1440);
            const backbuffer = makeMockCanvas(2560, 1440);
            const renderer = new Canvas2DRenderer(target, backbuffer);

            renderer.fillRect(0, 0, 10, 10, [12, 34, 56]);
            expect(renderer._prevDrawStyle).to.equal('rgb(12,34,56)');

            let overlayDraws = 0;
            renderer._overlayCanvas = makeMockCanvas(2560, 1440);
            renderer._drawOverlay = () => { overlayDraws++; };

            const resized = renderer.viewportChangeSize(2561, 1440);
            expect(resized).to.equal(true);
            expect(target.width).to.equal(2561);
            expect(renderer._prevDrawStyle).to.equal('');
            expect(overlayDraws).to.equal(1);

            // When buffered, resizing visible target must NOT clear backbuffer _prevDrawStyle
            renderer._enableCanvasBuffer = true;
            renderer._prevDrawStyle = 'rgb(99,88,77)';
            renderer.viewportChangeSize(2560, 1440);
            expect(renderer._prevDrawStyle).to.equal('rgb(99,88,77)');

            renderer.rescale(1 / dpr, '100%', '100%', 2560, 1440, 2326);
            expect(target.style.width).to.equal('100%');
            expect(target.style.imageRendering).to.equal(expectedCrisp);

            renderer.rescale(0.7, '1600px', '900px', 2560, 1440, 2326);
            expect(target.style.imageRendering).to.equal('auto');

            // Unscaled (factor === 1) at integer DPR 2 and 3 must also select crisp rendering
            for (const intDpr of [2, 3]) {
                setWindowDpr(intDpr);
                target.style.imageRendering = 'auto';
                renderer.rescale(1, '1920px', '1080px', 1920, 1080, 1920);
                expect(target.style.imageRendering).to.equal(expectedCrisp);
            }
        });

        it('WebGLRenderer should propagate imageRendering, switch NEAREST/LINEAR filter, and scissor-clear padding strip', function () {
            const dpr = 1.5;
            setWindowDpr(dpr);

            const target = makeMockCanvas(2561, 1441);
            const backbuffer = makeMockCanvas(2560, 1440);
            const c2d = new Canvas2DRenderer(target, backbuffer);
            const webglCanvas = makeMockCanvas(0, 0);

            const glCalls = [];
            const mockGl = {
                VERSION: 1, RED_BITS: 2, GREEN_BITS: 3, BLUE_BITS: 4, ALPHA_BITS: 5,
                DEPTH_BITS: 6, STENCIL_BITS: 7, SHADING_LANGUAGE_VERSION: 8, VENDOR: 9,
                RENDERER: 10, MAX_TEXTURE_SIZE: 11, MAX_VERTEX_ATTRIBS: 12,
                VERTEX_SHADER: 13, FRAGMENT_SHADER: 14, COMPILE_STATUS: 15, LINK_STATUS: 16,
                ARRAY_BUFFER: 17, STATIC_DRAW: 18, FLOAT: 19, TEXTURE_2D: 20,
                TEXTURE_MAG_FILTER: 21, TEXTURE_MIN_FILTER: 22, TEXTURE_WRAP_S: 23, TEXTURE_WRAP_T: 24,
                LINEAR: 9729, NEAREST: 9728, CLAMP_TO_EDGE: 25,
                DEPTH_TEST: 26, STENCIL_TEST: 27, DITHER: 28, BLEND: 29,
                SCISSOR_TEST: 30, COLOR_BUFFER_BIT: 31, RGBA: 32, UNSIGNED_BYTE: 33, TRIANGLE_FAN: 34,
                getParameter: () => 'mock',
                getSupportedExtensions: () => [],
                createShader: () => ({}),
                shaderSource: () => {},
                compileShader: () => {},
                getShaderParameter: () => true,
                createProgram: () => ({}),
                attachShader: () => {},
                linkProgram: () => {},
                getProgramParameter: () => true,
                useProgram: () => {},
                deleteShader: () => {},
                createBuffer: () => ({}),
                bindBuffer: () => {},
                bufferData: () => {},
                getAttribLocation: () => 0,
                vertexAttribPointer: () => {},
                enableVertexAttribArray: () => {},
                createTexture: () => ({ id: 'tex' }),
                bindTexture: () => {},
                texParameteri(targetTex, pname, param) { glCalls.push(['texParameteri', pname, param]); },
                disable(cap) { glCalls.push(['disable', cap]); },
                enable(cap) { glCalls.push(['enable', cap]); },
                clearColor(r, g, b, a) { glCalls.push(['clearColor', r, g, b, a]); },
                scissor(x, y, w, h) { glCalls.push(['scissor', x, y, w, h]); },
                clear(mask) { glCalls.push(['clear', mask]); },
                viewport(x, y, w, h) { glCalls.push(['viewport', x, y, w, h]); },
                texImage2D: () => {},
                drawArrays: () => {}
            };

            const renderer = new WebGLRenderer(c2d, mockGl, webglCanvas);
            glCalls.length = 0;

            renderer.rescale(1 / dpr, '100%', '100%', 2560, 1440, 1706);
            expect(webglCanvas.style.imageRendering).to.equal(expectedCrisp);

            let closed = false;
            renderer.drawVideoFrame({
                displayWidth: 2560,
                displayHeight: 1440,
                close() { closed = true; }
            }, 0, 0, 2560, 1440);

            expect(closed).to.equal(true);
            expect(renderer._textureFilter).to.equal(mockGl.NEAREST);
            const scissors = glCalls.filter(c => c[0] === 'scissor');
            expect(scissors).to.deep.equal([
                ['scissor', 2560, 0, 1, 1441],
                ['scissor', 0, 0, 2561, 1]
            ]);

            // Downscaled server video frame switches back to LINEAR
            renderer.drawVideoFrame({
                displayWidth: 1280,
                displayHeight: 720,
                close() {}
            }, 0, 0, 2560, 1440);
            expect(renderer._textureFilter).to.equal(mockGl.LINEAR);

            // During window-shrink debounce (fb covers full 2561x1441 while _serverWidth=1280), no scissor clear runs
            glCalls.length = 0;
            renderer.rescale(0.5, '640px', '360px', 1280, 720, 640);
            renderer.drawVideoFrame({
                displayWidth: 2561,
                displayHeight: 1441,
                close() {}
            }, 0, 0, 2561, 1441);
            expect(glCalls.filter(c => c[0] === 'scissor')).to.deep.equal([]);

            // Unscaled (factor === 1) at integer DPR 2 and 3 propagates crisp imageRendering and NEAREST filter
            for (const intDpr of [2, 3]) {
                setWindowDpr(intDpr);
                renderer.rescale(1, '1920px', '1080px', 1920, 1080, 1920);
                expect(webglCanvas.style.imageRendering).to.equal(expectedCrisp);
                renderer.drawVideoFrame({
                    displayWidth: 1920,
                    displayHeight: 1080,
                    close() {}
                }, 0, 0, 1920, 1080);
                expect(renderer._textureFilter).to.equal(mockGl.NEAREST);

                // Downscaled VideoFrame at factor === 1 on integer DPR still falls back to LINEAR
                renderer.drawVideoFrame({
                    displayWidth: 1280,
                    displayHeight: 720,
                    close() {}
                }, 0, 0, 1920, 1080);
                expect(renderer._textureFilter).to.equal(mockGl.LINEAR);
                expect(webglCanvas.style.imageRendering).to.equal(expectedCrisp);
            }
        });

        it('Display._rescale should pin 100%x100% in native 1:1 mode, preserve _prevDrawStyle, and restore multi-monitor/non-1:1 sizing', function () {
            const dpr = 2560 / 2327;
            setWindowDpr(dpr);

            const target = makeMockCanvas(2560, 1440);
            const backbuffer = makeMockCanvas(2560, 1440);
            const container = {
                getBoundingClientRect: () => ({ width: 2327.9, height: 1309, left: 0, top: 0 })
            };
            target.parentNode = container;
            const renderer = new Canvas2DRenderer(target, backbuffer);

            const displayStub = {
                _scale: 1 / dpr,
                _clipViewport: false,
                _fbWidth: 2560,
                _fbHeight: 1440,
                _container: container,
                _target: target,
                _renderer: renderer,
                _devicePixelWidth: 2561,
                _devicePixelHeight: 1440,
                _devicePixelObserverDpr: dpr,
                _nativeSurfaceEligible: true,
                _nativeSurfaceActive: false,
                _screens: [{
                    x: 0,
                    y: 0,
                    width: 2326,
                    height: 1308,
                    serverWidth: 2560,
                    serverHeight: 1440,
                    serverReportedWidth: 2560,
                    serverReportedHeight: 1440,
                    scale: 1 / dpr,
                    pixelRatio: dpr
                }],
                _pushAsyncFrame() {},
                _fillNativePaddingStrip: Display.prototype._fillNativePaddingStrip,
                absX: Display.prototype.absX,
                absY: Display.prototype.absY,
                _rescale: Display.prototype._rescale
            };

            // Native 1:1 active with 1px right padding strip
            displayStub._rescale(1 / dpr);
            expect(displayStub._nativeSurfaceActive).to.equal(true);
            expect(target.style.margin).to.equal('0');
            expect(target.style.width).to.equal('100%');
            expect(target.style.height).to.equal('100%');
            expect(target.width).to.equal(2561);
            expect(target.height).to.equal(1440);

            // Pointer on the 2561st physical pixel clamps to 2559
            expect(displayStub.absX(2560 / dpr)).to.equal(2559);

            // Non-1:1 scale factor (e.g. scale=1.0 when scaleViewport=false) must exit native mode
            displayStub._rescale(1.0);
            expect(displayStub._nativeSurfaceActive).to.equal(false);
            expect(target.style.margin).to.equal('auto');
            expect(target.width).to.equal(2560);
            expect(target.style.width).to.equal('2560px');
            expect(target.style.imageRendering).to.equal('auto');

            // Unscaled (scale=1.0) on integer DPR 2 and 3 stays out of native 1:1 surface pinning (even if devicePixelWidth matches) but keeps pixelated rendering
            for (const intDpr of [2, 3]) {
                setWindowDpr(intDpr);
                displayStub._devicePixelWidth = 2560;
                displayStub._devicePixelHeight = 1440;
                displayStub._devicePixelObserverDpr = intDpr;
                target.style.imageRendering = 'auto';
                displayStub._rescale(1.0);
                expect(displayStub._nativeSurfaceActive).to.equal(false);
                expect(target.width).to.equal(2560);
                expect(target.style.width).to.equal('2560px');
                expect(target.style.imageRendering).to.equal(expectedCrisp);
            }
            displayStub._devicePixelWidth = 2561;
            displayStub._devicePixelHeight = 1440;
            displayStub._devicePixelObserverDpr = dpr;
            setWindowDpr(dpr);

            // Multi-monitor (!clipViewport && screens.length === 2): target must stay vp.serverWidth (2560), NOT combined _fbWidth (4480)
            displayStub._fbWidth = 4480;
            displayStub._fbHeight = 1440;
            displayStub._screens.push({ x: 2560, y: 0, serverWidth: 1920, serverHeight: 1080 });
            displayStub._rescale(1 / dpr);
            expect(displayStub._nativeSurfaceActive).to.equal(false);
            expect(target.width).to.equal(2560);
            expect(target.height).to.equal(1440);
        });

        it('Display._initDevicePixelObserver should record DPR, fall back when box option throws, and ignore FakeResizeObserver empty fire()', function () {
            setWindowDpr(1.25);
            let observedOptions = null;
            let observerInstance = null;
            window.ResizeObserver = class {
                constructor(cb) {
                    this.cb = cb;
                    observerInstance = this;
                }
                observe(el, opts) {
                    if (opts && opts.box === 'device-pixel-content-box') {
                        throw new Error('Unsupported box option');
                    }
                    observedOptions = opts || 'default';
                }
                disconnect() {
                    observedOptions = 'disconnected';
                }
            };

            let windowResizeCalls = 0;
            const displayStub = {
                _container: {},
                _devicePixelWidth: 0,
                _devicePixelHeight: 0,
                _devicePixelObserverDpr: 0,
                _devicePixelObserver: null,
                _rfb: {
                    isConnected: true,
                    _windowResize() { windowResizeCalls++; }
                },
                _initDevicePixelObserver: Display.prototype._initDevicePixelObserver,
                clear() {},
                dispose: Display.prototype.dispose
            };

            displayStub._initDevicePixelObserver();
            expect(observedOptions).to.equal('default');

            // No-arg fire() from legacy FakeResizeObserver must not throw
            observerInstance.cb();
            expect(windowResizeCalls).to.equal(0);

            observerInstance.cb([{ contentRect: { width: 2048, height: 1152 } }]);
            expect(displayStub._devicePixelWidth).to.equal(2560);
            expect(displayStub._devicePixelHeight).to.equal(1440);
            expect(displayStub._devicePixelObserverDpr).to.equal(1.25);
            expect(windowResizeCalls).to.equal(1);

            displayStub.dispose();
            expect(observedOptions).to.equal('disconnected');
            expect(displayStub._devicePixelObserver).to.equal(null);
        });

        it('WebRTCController._freezeFrameWebRTC should draw into serverWidth x serverHeight when native padding is active', function () {
            const target = makeMockCanvas(2561, 1441);
            const controllerStub = {
                _webrtcScreens: new Map([[0, {
                    live: { video: { videoWidth: 2560, videoHeight: 1440 } }
                }]]),
                _rfb: {
                    _display: {
                        _target: target,
                        _nativeSurfaceActive: true,
                        screens: [{ serverWidth: 2560, serverHeight: 1440 }]
                    }
                },
                _freezeFrameWebRTC: WebRTCController.prototype._freezeFrameWebRTC
            };

            controllerStub._freezeFrameWebRTC();
            const drawCall = target._ops.find(op => op[0] === 'drawImage');
            expect(drawCall.slice(2)).to.deep.equal([0, 0, 2560, 1440]);
        });

        it('RFB DPR watcher should re-subscribe on matchMedia change, trigger _windowResize, and clean up on unwatch', function () {
            setWindowDpr(1.0);
            const listeners = [];
            window.matchMedia = (query) => {
                const record = { query, listener: null, removed: false };
                listeners.push(record);
                return {
                    matches: true,
                    media: query,
                    addEventListener(type, fn) { record.listener = fn; },
                    removeEventListener(type, fn) {
                        if (record.listener === fn) {
                            record.removed = true;
                        }
                    }
                };
            };

            let resizeTriggered = 0;
            const rfbStub = {
                isConnected: true,
                _dprMediaQuery: null,
                _dprMediaQueryHandler: null,
                _display: { screens: [{ pixelRatio: 1.0 }] },
                _windowResize() { resizeTriggered++; },
                _watchDevicePixelRatio: RFB.prototype._watchDevicePixelRatio,
                _unwatchDevicePixelRatio: RFB.prototype._unwatchDevicePixelRatio,
                _handleDprChange: RFB.prototype._handleDprChange,
                _handleMouseOut: RFB.prototype._handleMouseOut
            };

            rfbStub._watchDevicePixelRatio();
            expect(listeners.length).to.equal(1);
            expect(listeners[0].query).to.equal('(min-resolution: 0.999dppx) and (max-resolution: 1.001dppx)');

            // Simulate moving window to ChromeOS 110% monitor
            const newDpr = 2560 / 2327;
            setWindowDpr(newDpr);
            listeners[0].listener();

            expect(listeners[0].removed).to.equal(true);
            expect(listeners.length).to.equal(2);
            expect(resizeTriggered).to.equal(1);

            // Update recorded screen DPR, then verify mouseover fallback is a no-op when DPR matches
            rfbStub._display.screens[0].pixelRatio = newDpr;
            rfbStub._handleMouseOut({});
            expect(resizeTriggered).to.equal(1);

            rfbStub._unwatchDevicePixelRatio();
            expect(listeners[1].removed).to.equal(true);
            expect(rfbStub._dprMediaQuery).to.equal(null);
        });

        it('Secondary display native padding clamp keeps edge clicks on the secondary screen while preserving cross-window drags', function () {
            const origInnerWidth = window.innerWidth;
            const origInnerHeight = window.innerHeight;
            window.innerWidth = 1708;
            window.innerHeight = 961;
            try {
                for (const dpr of [2560 / 2327, 1.25, 1.5, 1.75]) {
                    const scale = 1 / dpr;
                    const primaryDisplayStub = {
                        _screens: [
                            { x: 2560, y: 0, serverWidth: 2560, serverHeight: 1440, scale },
                            { x: 0, y: 0, serverWidth: 2560, serverHeight: 1440, scale }
                        ],
                        getServerRelativeCoordinates: Display.prototype.getServerRelativeCoordinates
                    };

                    // Clicking on the 2561st physical pixel of screen 1 (x = 0..2559) must stay at 2559, never 2560 (screen 0)
                    const clampedX = clampNativeClientOffset(2560 * scale, scale, 2560);
                    const clampedY = clampNativeClientOffset(1440 * scale, scale, 1440);
                    const serverCoords = primaryDisplayStub.getServerRelativeCoordinates(1, clampedX, clampedY);
                    expect(serverCoords).to.deep.equal([2559, 1439]);
                }

                const secondaryRfbStub = {
                    _isPrimaryDisplay: false,
                    _display: {
                        _nativeSurfaceActive: true,
                        scale: 1 / 1.5,
                        screens: [{ serverWidth: 2560, serverHeight: 1440 }]
                    },
                    _clampSecondaryPointer: RFB.prototype._clampSecondaryPointer
                };

                // In-window edge click clamps into [0, 2559]
                const inWin = secondaryRfbStub._clampSecondaryPointer(2560 / 1.5, 1440 / 1.5, 1707, 960);
                expect(Math.trunc(inWin.x * 1.5)).to.equal(2559);
                expect(Math.trunc(inWin.y * 1.5)).to.equal(1439);

                // Cross-window drag outside window bounds (clientX > innerWidth or clientX < 0) is NOT clamped
                const dragRight = secondaryRfbStub._clampSecondaryPointer(1800, 500, 1800, 500);
                expect(dragRight.x).to.equal(1800);
                const dragLeft = secondaryRfbStub._clampSecondaryPointer(-50, 500, -50, 500);
                expect(dragLeft.x).to.equal(-50);
            } finally {
                window.innerWidth = origInnerWidth;
                window.innerHeight = origInnerHeight;
            }
        });
    });
});
