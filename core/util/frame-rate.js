import { encodings } from "../encodings.js";

export const FRAME_RATE_MIN = 10;
export const FRAME_RATE_MAX = 120;

export function isValidFrameRate(value) {
    return Number.isInteger(value) &&
        value >= FRAME_RATE_MIN && value <= FRAME_RATE_MAX;
}

export function normalizeFrameRate(value, fallback) {
    const fallbackValue = isValidFrameRate(fallback) ? fallback : FRAME_RATE_MIN;
    const numericValue = (value === null || value === undefined || value === "") ?
        fallbackValue : Number(value);
    const finiteValue = Number.isFinite(numericValue) ? numericValue : fallbackValue;

    return Math.round(Math.max(FRAME_RATE_MIN, Math.min(FRAME_RATE_MAX, finiteValue)));
}

export function frameRateToPseudoEncoding(value) {
    if (!isValidFrameRate(value)) {
        throw new RangeError(`Frame rate must be an integer between ${FRAME_RATE_MIN} and ${FRAME_RATE_MAX}`);
    }

    return encodings.pseudoEncodingFrameRateLevel10 + value - FRAME_RATE_MIN;
}
