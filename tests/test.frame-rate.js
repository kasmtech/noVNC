const expect = chai.expect;

import {
    FRAME_RATE_MAX,
    FRAME_RATE_MIN,
    frameRateToPseudoEncoding,
    isValidFrameRate,
    normalizeFrameRate,
} from "../core/frame-rate.js";
import { encodings } from "../core/encodings.js";

describe("Frame rate", function () {
    describe("validation", function () {
        it("accepts integer frame rates from 10 through 120", function () {
            expect(isValidFrameRate(FRAME_RATE_MIN)).to.be.true;
            expect(isValidFrameRate(60)).to.be.true;
            expect(isValidFrameRate(FRAME_RATE_MAX)).to.be.true;
        });

        it("rejects non-integers and values outside the supported range", function () {
            expect(isValidFrameRate(9)).to.be.false;
            expect(isValidFrameRate(120.5)).to.be.false;
            expect(isValidFrameRate(121)).to.be.false;
            expect(isValidFrameRate("60")).to.be.false;
        });
    });

    describe("normalization", function () {
        it("clamps and rounds user-provided values", function () {
            expect(normalizeFrameRate(1, 24)).to.equal(FRAME_RATE_MIN);
            expect(normalizeFrameRate(10.5, 24)).to.equal(11);
            expect(normalizeFrameRate(121, 24)).to.equal(FRAME_RATE_MAX);
        });

        it("uses the configured fallback for missing or invalid values", function () {
            expect(normalizeFrameRate(null, 24)).to.equal(24);
            expect(normalizeFrameRate("", 24)).to.equal(24);
            expect(normalizeFrameRate("invalid", 24)).to.equal(24);
        });
    });

    describe("pseudo-encoding", function () {
        it("maps the full supported range without colliding with adjacent encodings", function () {
            expect(frameRateToPseudoEncoding(FRAME_RATE_MIN)).to.equal(-4096);
            expect(frameRateToPseudoEncoding(60)).to.equal(-4046);
            expect(frameRateToPseudoEncoding(FRAME_RATE_MAX)).to.equal(-3986);
            expect(frameRateToPseudoEncoding(FRAME_RATE_MAX)).to.equal(encodings.pseudoEncodingFrameRateLevel120);
            expect(encodings.pseudoEncodingFrameRateLevel120).to.be.lessThan(encodings.pseudoEncodingMaxVideoResolution);
        });

        it("rejects unsupported values instead of emitting invalid protocol data", function () {
            expect(() => frameRateToPseudoEncoding(9)).to.throw(RangeError);
            expect(() => frameRateToPseudoEncoding(121)).to.throw(RangeError);
        });
    });
});
