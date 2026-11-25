const expect = chai.expect;

import { encodings } from '../core/encodings.js';
import {
    floorEvenDimension,
    toEvenDimension,
    normalizePixelRatio,
    parsePositiveDimension,
    computeScreenDimensions
} from '../core/util/display-size.js';

describe('Display screen size helpers', function () {
    "use strict";

    describe('floorEvenDimension', function () {
        it('should return 0 for sub-2px, zero, negative, or non-finite values', function () {
            expect(floorEvenDimension(0)).to.equal(0);
            expect(floorEvenDimension(0.5)).to.equal(0);
            expect(floorEvenDimension(1)).to.equal(0);
            expect(floorEvenDimension(1.999)).to.equal(0);
            expect(floorEvenDimension(-10)).to.equal(0);
            expect(floorEvenDimension(NaN)).to.equal(0);
            expect(floorEvenDimension(Infinity)).to.equal(0);
        });

        it('should floor values >= 2 to even integers without inflating', function () {
            expect(floorEvenDimension(2)).to.equal(2);
            expect(floorEvenDimension(3.9)).to.equal(2);
            expect(floorEvenDimension(1341.8)).to.equal(1340);
        });
    });

    describe('toEvenDimension', function () {
        it('should return 0 for zero, negative, or non-finite values', function () {
            expect(toEvenDimension(0)).to.equal(0);
            expect(toEvenDimension(-10)).to.equal(0);
            expect(toEvenDimension(NaN)).to.equal(0);
            expect(toEvenDimension(Infinity)).to.equal(0);
            expect(toEvenDimension(-Infinity)).to.equal(0);
        });

        it('should never collapse positive values below 2 to 0', function () {
            expect(toEvenDimension(0.1)).to.equal(2);
            expect(toEvenDimension(1)).to.equal(2);
            expect(toEvenDimension(1.5)).to.equal(2);
            expect(toEvenDimension(1.999)).to.equal(2);
        });

        it('should floor values >= 2 to even integers', function () {
            expect(toEvenDimension(2)).to.equal(2);
            expect(toEvenDimension(3)).to.equal(2);
            expect(toEvenDimension(2469.28)).to.equal(2468);
            expect(toEvenDimension(1439.9)).to.equal(1438);
            expect(toEvenDimension(2560)).to.equal(2560);
        });
    });

    describe('normalizePixelRatio', function () {
        it('should default invalid or non-positive values to 1', function () {
            expect(normalizePixelRatio(undefined)).to.equal(1);
            expect(normalizePixelRatio(null)).to.equal(1);
            expect(normalizePixelRatio(0)).to.equal(1);
            expect(normalizePixelRatio(-1.5)).to.equal(1);
            expect(normalizePixelRatio(NaN)).to.equal(1);
            expect(normalizePixelRatio(Infinity)).to.equal(1);
        });

        it('should preserve positive finite ratios including browser zoom-out (< 1)', function () {
            expect(normalizePixelRatio(0.75)).to.equal(0.75);
            expect(normalizePixelRatio(1.25)).to.equal(1.25);
            expect(normalizePixelRatio(1.84)).to.equal(1.84);
            expect(normalizePixelRatio(2)).to.equal(2);
        });
    });

    describe('parsePositiveDimension', function () {
        it('should reject empty, boolean, zero, negative, or invalid values', function () {
            expect(parsePositiveDimension(undefined)).to.equal(null);
            expect(parsePositiveDimension(null)).to.equal(null);
            expect(parsePositiveDimension('')).to.equal(null);
            expect(parsePositiveDimension('   ')).to.equal(null);
            expect(parsePositiveDimension('0')).to.equal(null);
            expect(parsePositiveDimension(0)).to.equal(null);
            expect(parsePositiveDimension(-100)).to.equal(null);
            expect(parsePositiveDimension('abc')).to.equal(null);
            expect(parsePositiveDimension(true)).to.equal(null);
            expect(parsePositiveDimension(false)).to.equal(null);
            expect(parsePositiveDimension([])).to.equal(null);
            expect(parsePositiveDimension([1920])).to.equal(null);
            expect(parsePositiveDimension(new Date())).to.equal(null);
            expect(parsePositiveDimension(Object.create(null))).to.equal(null);
            expect(parsePositiveDimension(Symbol('dim'))).to.equal(null);
        });

        it('should parse numeric strings and positive numbers', function () {
            expect(parsePositiveDimension('1366')).to.equal(1366);
            expect(parsePositiveDimension(1920)).to.equal(1920);
        });
    });

    describe('computeScreenDimensions', function () {
        it('should produce even HiDPI dimensions across fractional devicePixelRatios', function () {
            const cases = [
                { w: 1706, h: 960, dpr: 1.5, expW: 2558, expH: 1440 },
                { w: 1006, h: 806, dpr: 1.25, expW: 1256, expH: 1006 },
                { w: 1342, h: 782, dpr: 1.84, expW: 2468, expH: 1438 },
                { w: 1280, h: 800, dpr: 2.0, expW: 2560, expH: 1600 },
                { w: 1200, h: 900, dpr: 0.75, expW: 900, expH: 674 }
            ];

            for (const c of cases) {
                const res = computeScreenDimensions({
                    parentWidth: c.w,
                    parentHeight: c.h,
                    devicePixelRatio: c.dpr,
                    resolutionQuality: 2,
                    hiDpi: true,
                    disableLimit: false,
                    disableScaling: false,
                    streamMode: encodings.pseudoEncodingStreamingModeAVCSW
                });
                expect(res.serverWidth).to.equal(c.expW);
                expect(res.serverHeight).to.equal(c.expH);
                expect(res.serverWidth % 2).to.equal(0);
                expect(res.serverHeight % 2).to.equal(0);
                expect(Number.isFinite(res.scale)).to.equal(true);
            }
        });

        it('should handle invalid devicePixelRatio values cleanly in HiDPI mode', function () {
            for (const dpr of [undefined, 0, NaN]) {
                const res = computeScreenDimensions({
                    parentWidth: 1920,
                    parentHeight: 1080,
                    devicePixelRatio: dpr,
                    resolutionQuality: 2,
                    hiDpi: true,
                    disableLimit: false,
                    disableScaling: false,
                    streamMode: encodings.pseudoEncodingStreamingModeAVCSW
                });
                expect(res.pixelRatio).to.equal(1);
                expect(res.serverWidth).to.equal(1920);
                expect(res.serverHeight).to.equal(1080);
                expect(res.scale).to.equal(1);
            }
        });

        it('should avoid float roundtrip jitter in screen width and height', function () {
            const res = computeScreenDimensions({
                parentWidth: 116,
                parentHeight: 116,
                devicePixelRatio: 0.85,
                resolutionQuality: 2,
                hiDpi: true,
                disableLimit: false,
                disableScaling: false,
                streamMode: encodings.pseudoEncodingStreamingModeAVCSW
            });
            expect(res.serverWidth).to.equal(98);
            expect(res.serverHeight).to.equal(98);
            expect(res.width).to.equal(116);
            expect(res.height).to.equal(116);
        });

        it('should produce even integer dimensions and respect boundaries in the small-device HiDPI branch', function () {
            const phone = computeScreenDimensions({
                parentWidth: 390,
                parentHeight: 844,
                devicePixelRatio: 3,
                resolutionQuality: 2,
                hiDpi: false,
                disableLimit: false,
                disableScaling: false,
                streamMode: encodings.pseudoEncodingStreamingModeAVCSW,
                antiAliasing: 0
            });
            expect(phone.serverWidth).to.equal(584);
            expect(phone.serverHeight).to.equal(1266);
            expect(phone.smallDeviceAutoScale.scaleRatio).to.equal(1.5);

            const exactOne = computeScreenDimensions({
                parentWidth: 800,
                parentHeight: 600,
                devicePixelRatio: 1.5,
                resolutionQuality: 2,
                hiDpi: false,
                disableLimit: false,
                disableScaling: false,
                streamMode: encodings.pseudoEncodingStreamingModeAVCSW,
                antiAliasing: 0
            });
            expect(exactOne.smallDeviceAutoScale.scaleRatio).to.equal(1);
            expect(exactOne.serverWidth).to.equal(800);
            expect(exactOne.serverHeight).to.equal(600);

            const dprTwo = computeScreenDimensions({
                parentWidth: 600,
                parentHeight: 400,
                devicePixelRatio: 2,
                resolutionQuality: 2,
                hiDpi: false,
                disableLimit: false,
                disableScaling: false,
                streamMode: encodings.pseudoEncodingStreamingModeAVCSW,
                antiAliasing: 0
            });
            expect(dprTwo.smallDeviceAutoScale.scaleRatio).to.equal(2 / 1.5);
            expect(dprTwo.serverWidth).to.equal(800);
            expect(dprTwo.serverHeight).to.equal(532);

            const laptop = computeScreenDimensions({
                parentWidth: 800,
                parentHeight: 700,
                devicePixelRatio: 1.25,
                resolutionQuality: 2,
                hiDpi: false,
                disableLimit: false,
                disableScaling: false,
                streamMode: encodings.pseudoEncodingStreamingModeAVCSW,
                antiAliasing: 0
            });
            expect(laptop.serverWidth).to.equal(666);
            expect(laptop.serverHeight).to.equal(582);

            const skippedAA = computeScreenDimensions({
                parentWidth: 800,
                parentHeight: 600,
                devicePixelRatio: 2,
                resolutionQuality: 2,
                hiDpi: false,
                disableLimit: false,
                disableScaling: false,
                streamMode: encodings.pseudoEncodingStreamingModeAVCSW,
                antiAliasing: 1
            });
            expect(skippedAA.smallDeviceAutoScale).to.equal(null);
            expect(skippedAA.serverWidth).to.equal(800);

            const skippedWide = computeScreenDimensions({
                parentWidth: 1000,
                parentHeight: 600,
                devicePixelRatio: 2,
                resolutionQuality: 2,
                hiDpi: false,
                disableLimit: false,
                disableScaling: false,
                streamMode: encodings.pseudoEncodingStreamingModeAVCSW,
                antiAliasing: 0
            });
            expect(skippedWide.smallDeviceAutoScale).to.equal(null);
            expect(skippedWide.serverWidth).to.equal(1000);
        });

        it('should handle Low (quality=1), static 720p (quality=0), disableLimit, and streamMode rules', function () {
            const lowJpeg = computeScreenDimensions({
                parentWidth: 1920,
                parentHeight: 950,
                devicePixelRatio: 1,
                resolutionQuality: 1,
                hiDpi: true,
                disableLimit: false,
                disableScaling: false,
                streamMode: encodings.pseudoEncodingStreamingModeJpegWebp
            });
            expect(lowJpeg.serverWidth).to.equal(1280);
            expect(lowJpeg.serverHeight).to.equal(632);

            const lowTinyHeight = computeScreenDimensions({
                parentWidth: 2000,
                parentHeight: 2,
                devicePixelRatio: 1,
                resolutionQuality: 1,
                hiDpi: false,
                disableLimit: false,
                disableScaling: false,
                streamMode: encodings.pseudoEncodingStreamingModeJpegWebp
            });
            expect(lowTinyHeight.serverWidth).to.equal(1280);
            expect(lowTinyHeight.serverHeight).to.equal(2);
            expect(Number.isFinite(lowTinyHeight.scale)).to.equal(true);

            const static720p = computeScreenDimensions({
                parentWidth: 1920,
                parentHeight: 1080,
                devicePixelRatio: 1,
                resolutionQuality: 0,
                hiDpi: true,
                disableLimit: false,
                disableScaling: false,
                streamMode: encodings.pseudoEncodingStreamingModeJpegWebp
            });
            expect(static720p.serverWidth).to.equal(1280);
            expect(static720p.serverHeight).to.equal(720);

            const limitDisabled = computeScreenDimensions({
                parentWidth: 1920,
                parentHeight: 1080,
                devicePixelRatio: 1.5,
                resolutionQuality: 0,
                hiDpi: true,
                disableLimit: true,
                disableScaling: false,
                streamMode: encodings.pseudoEncodingStreamingModeJpegWebp
            });
            expect(limitDisabled.serverWidth).to.equal(2880);
            expect(limitDisabled.serverHeight).to.equal(1620);

            const videoStreamBypass = computeScreenDimensions({
                parentWidth: 1920,
                parentHeight: 950,
                devicePixelRatio: 1,
                resolutionQuality: 1,
                hiDpi: false,
                disableLimit: false,
                disableScaling: false,
                streamMode: encodings.pseudoEncodingStreamingModeAVCSW
            });
            expect(videoStreamBypass.serverWidth).to.equal(1920);
            expect(videoStreamBypass.serverHeight).to.equal(950);
        });

        it('should not inflate sub-2px or single-axis zero containers and should prevent 0 collapse on valid containers', function () {
            for (const [pw, ph] of [[0, 0], [0.5, 0.5], [1, 1], [1.5, 900], [1920, 0], [0, 1080]]) {
                const res = computeScreenDimensions({
                    parentWidth: pw,
                    parentHeight: ph,
                    devicePixelRatio: 1.5,
                    resolutionQuality: 2,
                    hiDpi: true,
                    disableLimit: false,
                    disableScaling: false,
                    streamMode: encodings.pseudoEncodingStreamingModeAVCSW
                });
                expect(res.scale).to.equal(0);
                expect(Number.isNaN(res.width)).to.equal(false);
                expect(Number.isNaN(res.height)).to.equal(false);
                if (pw < 2) {
                    expect(res.containerWidth).to.equal(0);
                    expect(res.serverWidth).to.equal(0);
                }
                if (ph < 2) {
                    expect(res.containerHeight).to.equal(0);
                    expect(res.serverHeight).to.equal(0);
                }
            }

            const zoomOutTiny = computeScreenDimensions({
                parentWidth: 2,
                parentHeight: 2,
                devicePixelRatio: 0.75,
                resolutionQuality: 2,
                hiDpi: true,
                disableLimit: false,
                disableScaling: false,
                streamMode: encodings.pseudoEncodingStreamingModeAVCSW
            });
            expect(zoomOutTiny.serverWidth).to.equal(2);
            expect(zoomOutTiny.serverHeight).to.equal(2);
            expect(zoomOutTiny.scale).to.equal(1);

            const smallPane = computeScreenDimensions({
                parentWidth: 800,
                parentHeight: 2,
                devicePixelRatio: 1.25,
                resolutionQuality: 2,
                hiDpi: false,
                disableLimit: false,
                disableScaling: false,
                streamMode: encodings.pseudoEncodingStreamingModeAVCSW,
                antiAliasing: 0
            });
            expect(smallPane.serverHeight).to.equal(2);
            expect(Number.isFinite(smallPane.scale)).to.equal(true);
            expect(Number.isNaN(smallPane.height)).to.equal(false);
        });

        it('should handle forced maxWidth/maxHeight without double-rounding and support partial overrides', function () {
            const strForced = computeScreenDimensions({
                parentWidth: 1920,
                parentHeight: 1080,
                devicePixelRatio: 1,
                resolutionQuality: 2,
                maxWidth: '1365',
                maxHeight: '767',
                hiDpi: false,
                disableLimit: false,
                disableScaling: false,
                streamMode: encodings.pseudoEncodingStreamingModeAVCSW
            });
            expect(strForced.serverWidth).to.equal(1364);
            expect(strForced.serverHeight).to.equal(766);

            const noDoubleRound = computeScreenDimensions({
                parentWidth: 1920,
                parentHeight: 1080,
                devicePixelRatio: 2,
                resolutionQuality: 2,
                maxWidth: 1365,
                maxHeight: 767,
                hiDpi: true,
                disableLimit: false,
                disableScaling: false,
                streamMode: encodings.pseudoEncodingStreamingModeAVCSW
            });
            expect(noDoubleRound.serverWidth).to.equal(2730);
            expect(noDoubleRound.serverHeight).to.equal(1534);

            const partialForced = computeScreenDimensions({
                parentWidth: 1920,
                parentHeight: 1080,
                devicePixelRatio: 1,
                resolutionQuality: 2,
                maxWidth: '1600',
                hiDpi: false,
                disableLimit: false,
                disableScaling: false,
                streamMode: encodings.pseudoEncodingStreamingModeAVCSW
            });
            expect(partialForced.serverWidth).to.equal(1600);
            expect(partialForced.serverHeight).to.equal(1080);

            const zeroStr = computeScreenDimensions({
                parentWidth: 1920,
                parentHeight: 1080,
                devicePixelRatio: 1,
                resolutionQuality: 2,
                maxWidth: '0',
                maxHeight: '0',
                hiDpi: false,
                disableLimit: false,
                disableScaling: false,
                streamMode: encodings.pseudoEncodingStreamingModeAVCSW
            });
            expect(zeroStr.serverWidth).to.equal(1920);
            expect(zeroStr.serverHeight).to.equal(1080);
        });

        it('should honor serverReported dimensions according to ignoreServerReported and scaling flags', function () {
            const mismatchHonored = computeScreenDimensions({
                parentWidth: 1920,
                parentHeight: 1080,
                devicePixelRatio: 1.5,
                resolutionQuality: 2,
                hiDpi: true,
                disableLimit: false,
                disableScaling: false,
                streamMode: encodings.pseudoEncodingStreamingModeAVCSW,
                ignoreServerReported: false,
                serverReportedWidth: 1365,
                serverReportedHeight: 767,
                currentServerWidth: 1920,
                currentServerHeight: 1080
            });
            expect(mismatchHonored.serverWidth).to.equal(1365);
            expect(mismatchHonored.serverHeight).to.equal(767);

            const matchedFallsThrough = computeScreenDimensions({
                parentWidth: 1342,
                parentHeight: 782,
                devicePixelRatio: 1.84,
                resolutionQuality: 2,
                hiDpi: true,
                disableLimit: false,
                disableScaling: false,
                streamMode: encodings.pseudoEncodingStreamingModeAVCSW,
                ignoreServerReported: false,
                serverReportedWidth: 1600,
                serverReportedHeight: 900,
                currentServerWidth: 1600,
                currentServerHeight: 900
            });
            expect(matchedFallsThrough.serverWidth).to.equal(2468);
            expect(matchedFallsThrough.serverHeight).to.equal(1438);

            const ignored = computeScreenDimensions({
                parentWidth: 1342,
                parentHeight: 782,
                devicePixelRatio: 1.84,
                resolutionQuality: 2,
                hiDpi: true,
                disableLimit: false,
                disableScaling: true,
                streamMode: encodings.pseudoEncodingStreamingModeAVCSW,
                ignoreServerReported: true,
                serverReportedWidth: 1365,
                serverReportedHeight: 767
            });
            expect(ignored.serverWidth).to.equal(2468);
            expect(ignored.serverHeight).to.equal(1438);
        });
    });
});
