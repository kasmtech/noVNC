const expect = chai.expect;

import {
    FRAME_RATE_MIN,
    FRAME_RATE_MAX,
    normalizeFrameRate,
    parseOptionalFrameRate,
    resolveQualityFrameRates
} from '../core/util/frame-rate.js';

describe('Frame rate helpers', function () {
    "use strict";

    describe('parseOptionalFrameRate', function () {
        it('should return null for empty, missing, boolean, non-primitive, or non-finite inputs without throwing', function () {
            expect(parseOptionalFrameRate(undefined)).to.equal(null);
            expect(parseOptionalFrameRate(null)).to.equal(null);
            expect(parseOptionalFrameRate('')).to.equal(null);
            expect(parseOptionalFrameRate('   ')).to.equal(null);
            expect(parseOptionalFrameRate('abc')).to.equal(null);
            expect(parseOptionalFrameRate(NaN)).to.equal(null);
            expect(parseOptionalFrameRate(Infinity)).to.equal(null);
            expect(parseOptionalFrameRate(-Infinity)).to.equal(null);
            expect(parseOptionalFrameRate(true)).to.equal(null);
            expect(parseOptionalFrameRate(false)).to.equal(null);
            expect(parseOptionalFrameRate({ type: 'change' })).to.equal(null);
            expect(parseOptionalFrameRate([])).to.equal(null);
            expect(parseOptionalFrameRate([60])).to.equal(null);
            expect(parseOptionalFrameRate(new Date())).to.equal(null);
            expect(parseOptionalFrameRate(Object.create(null))).to.equal(null);
            expect(parseOptionalFrameRate(Symbol('fps'))).to.equal(null);
        });

        it('should parse numeric and string values and clamp/round to supported bounds', function () {
            expect(parseOptionalFrameRate(0)).to.equal(FRAME_RATE_MIN);
            expect(parseOptionalFrameRate('0')).to.equal(FRAME_RATE_MIN);
            expect(parseOptionalFrameRate(-5)).to.equal(FRAME_RATE_MIN);
            expect(parseOptionalFrameRate(9)).to.equal(FRAME_RATE_MIN);
            expect(parseOptionalFrameRate(10)).to.equal(10);
            expect(parseOptionalFrameRate(60)).to.equal(60);
            expect(parseOptionalFrameRate('60')).to.equal(60);
            expect(parseOptionalFrameRate('59.8')).to.equal(60);
            expect(parseOptionalFrameRate(120)).to.equal(FRAME_RATE_MAX);
            expect(parseOptionalFrameRate(121)).to.equal(FRAME_RATE_MAX);
            expect(parseOptionalFrameRate(999)).to.equal(FRAME_RATE_MAX);
        });
    });

    describe('normalizeFrameRate', function () {
        it('should return fallback for whitespace, booleans, and non-primitives while clamping 0', function () {
            expect(normalizeFrameRate('   ', 24)).to.equal(24);
            expect(normalizeFrameRate(true, 24)).to.equal(24);
            expect(normalizeFrameRate(false, 24)).to.equal(24);
            expect(normalizeFrameRate([], 24)).to.equal(24);
            expect(normalizeFrameRate(Object.create(null), 24)).to.equal(24);
            expect(normalizeFrameRate(0, 24)).to.equal(FRAME_RATE_MIN);
            expect(normalizeFrameRate('0', 24)).to.equal(FRAME_RATE_MIN);
            expect(normalizeFrameRate('59.8', 24)).to.equal(60);
        });
    });

    describe('resolveQualityFrameRates', function () {
        it('should preserve streaming-mode FPS without mutating image-mode preset FPS', function () {
            const res = resolveQualityFrameRates({
                presetMode: 2,
                imageMode: false,
                requestedFps: 60,
                savedImageFps: 24,
                savedStreamingFps: 60,
                hasConfiguredStreamingFps: true
            });
            expect(res.imageFps).to.equal(24);
            expect(res.streamingFps).to.equal(60);
            expect(res.activeFps).to.equal(60);
            expect(res.explicitFps).to.equal(60);
        });

        it('should ignore DOM Event-like objects passed as requestedFps', function () {
            const res = resolveQualityFrameRates({
                presetMode: 2,
                imageMode: false,
                requestedFps: { type: 'change' },
                savedImageFps: 24,
                savedStreamingFps: 60,
                hasConfiguredStreamingFps: true
            });
            expect(res.explicitFps).to.equal(null);
            expect(res.imageFps).to.equal(24);
            expect(res.streamingFps).to.equal(60);
            expect(res.activeFps).to.equal(60);
        });

        it('should preserve configured streaming FPS across no-arg updateQuality calls in streaming mode', function () {
            for (const presetMode of [0, 1, 2, 3, 4, 5]) {
                const res = resolveQualityFrameRates({
                    presetMode,
                    imageMode: false,
                    requestedFps: undefined,
                    savedImageFps: 24,
                    savedStreamingFps: 90,
                    hasConfiguredStreamingFps: true
                });
                expect(res.streamingFps).to.equal(90);
                expect(res.activeFps).to.equal(90);
            }
        });

        it('should preserve configured streaming FPS when switching to image mode and back or receiving image-mode VDI override', function () {
            const inImage = resolveQualityFrameRates({
                presetMode: 2,
                imageMode: true,
                requestedFps: undefined,
                savedImageFps: 24,
                savedStreamingFps: 60,
                hasConfiguredStreamingFps: true
            });
            expect(inImage.imageFps).to.equal(24);
            expect(inImage.streamingFps).to.equal(60);
            expect(inImage.activeFps).to.equal(24);

            const imageVdiOverride = resolveQualityFrameRates({
                presetMode: 2,
                imageMode: true,
                requestedFps: '45',
                savedImageFps: 24,
                savedStreamingFps: 90,
                hasConfiguredStreamingFps: true
            });
            expect(imageVdiOverride.imageFps).to.equal(45);
            expect(imageVdiOverride.streamingFps).to.equal(90);
            expect(imageVdiOverride.activeFps).to.equal(45);

            const backToStreaming = resolveQualityFrameRates({
                presetMode: 2,
                imageMode: false,
                requestedFps: undefined,
                savedImageFps: inImage.imageFps,
                savedStreamingFps: inImage.streamingFps,
                hasConfiguredStreamingFps: true
            });
            expect(backToStreaming.imageFps).to.equal(24);
            expect(backToStreaming.streamingFps).to.equal(60);
            expect(backToStreaming.activeFps).to.equal(60);
        });

        it('should follow preset FPS across 0..5 and 2 -> 3 -> 2 transitions on a fresh unconfigured browser', function () {
            for (const presetMode of [0, 1, 2]) {
                const res = resolveQualityFrameRates({
                    presetMode,
                    imageMode: false,
                    requestedFps: undefined,
                    savedImageFps: 24,
                    savedStreamingFps: 24,
                    hasConfiguredStreamingFps: false
                });
                expect(res.imageFps).to.equal(24);
                expect(res.streamingFps).to.equal(24);
                expect(res.activeFps).to.equal(24);
            }

            for (const presetMode of [3, 4, 5]) {
                const inImage = resolveQualityFrameRates({
                    presetMode,
                    imageMode: true,
                    requestedFps: undefined,
                    savedImageFps: 24,
                    savedStreamingFps: 24,
                    hasConfiguredStreamingFps: false
                });
                expect(inImage.imageFps).to.equal(60);
                expect(inImage.streamingFps).to.equal(60);
                expect(inImage.activeFps).to.equal(60);

                const inStreaming = resolveQualityFrameRates({
                    presetMode,
                    imageMode: false,
                    requestedFps: undefined,
                    savedImageFps: 60,
                    savedStreamingFps: 24,
                    hasConfiguredStreamingFps: false
                });
                expect(inStreaming.imageFps).to.equal(60);
                expect(inStreaming.streamingFps).to.equal(60);
                expect(inStreaming.activeFps).to.equal(60);
            }

            const stepHigh = resolveQualityFrameRates({
                presetMode: 3,
                imageMode: true,
                requestedFps: undefined,
                savedImageFps: 24,
                savedStreamingFps: 24,
                hasConfiguredStreamingFps: false
            });
            expect(stepHigh.streamingFps).to.equal(60);

            const stepBackMedium = resolveQualityFrameRates({
                presetMode: 2,
                imageMode: true,
                requestedFps: undefined,
                savedImageFps: stepHigh.imageFps,
                savedStreamingFps: stepHigh.streamingFps,
                hasConfiguredStreamingFps: false
            });
            expect(stepBackMedium.imageFps).to.equal(24);
            expect(stepBackMedium.streamingFps).to.equal(24);
        });

        it('should handle Custom preset (10) independently for image and streaming modes', function () {
            const imgCustom = resolveQualityFrameRates({
                presetMode: 10,
                imageMode: true,
                requestedFps: undefined,
                savedImageFps: 45,
                savedStreamingFps: 75,
                hasConfiguredStreamingFps: true
            });
            expect(imgCustom.imageFps).to.equal(45);
            expect(imgCustom.streamingFps).to.equal(75);
            expect(imgCustom.activeFps).to.equal(45);

            const vdiOverrideInCustomStreaming = resolveQualityFrameRates({
                presetMode: 10,
                imageMode: false,
                requestedFps: '60',
                savedImageFps: 45,
                savedStreamingFps: 75,
                hasConfiguredStreamingFps: true
            });
            expect(vdiOverrideInCustomStreaming.imageFps).to.equal(45);
            expect(vdiOverrideInCustomStreaming.streamingFps).to.equal(60);
            expect(vdiOverrideInCustomStreaming.activeFps).to.equal(60);

            const vdiOverrideInCustomImage = resolveQualityFrameRates({
                presetMode: 10,
                imageMode: true,
                requestedFps: 0,
                savedImageFps: 45,
                savedStreamingFps: 75,
                hasConfiguredStreamingFps: true
            });
            expect(vdiOverrideInCustomImage.imageFps).to.equal(10);
            expect(vdiOverrideInCustomImage.streamingFps).to.equal(75);
            expect(vdiOverrideInCustomImage.activeFps).to.equal(10);
        });

        it('should clamp out-of-range VDI or user frame rates safely', function () {
            const high = resolveQualityFrameRates({
                presetMode: 2,
                imageMode: false,
                requestedFps: 999,
                savedImageFps: 24,
                savedStreamingFps: 24,
                hasConfiguredStreamingFps: true
            });
            expect(high.streamingFps).to.equal(120);
            expect(high.activeFps).to.equal(120);
            expect(high.imageFps).to.equal(24);

            const zero = resolveQualityFrameRates({
                presetMode: 2,
                imageMode: false,
                requestedFps: 0,
                savedImageFps: 24,
                savedStreamingFps: 60,
                hasConfiguredStreamingFps: true
            });
            expect(zero.streamingFps).to.equal(10);
            expect(zero.activeFps).to.equal(10);
        });
    });
});
