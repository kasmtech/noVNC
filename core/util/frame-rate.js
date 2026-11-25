import { encodings } from "../encodings.js";

export const FRAME_RATE_MIN = 10;
export const FRAME_RATE_MAX = 120;

export function isValidFrameRate(value) {
    return Number.isInteger(value) &&
        value >= FRAME_RATE_MIN && value <= FRAME_RATE_MAX;
}

export function parseOptionalFrameRate(value) {
    if (typeof value !== "number" && typeof value !== "string") {
        return null;
    }
    if (typeof value === "string" && value.trim() === "") {
        return null;
    }
    const numericValue = Number(value);
    if (!Number.isFinite(numericValue)) {
        return null;
    }

    return Math.round(Math.max(FRAME_RATE_MIN, Math.min(FRAME_RATE_MAX, numericValue)));
}

export function normalizeFrameRate(value, fallback) {
    const fallbackValue = isValidFrameRate(fallback) ? fallback : FRAME_RATE_MIN;
    const parsed = parseOptionalFrameRate(value);

    return parsed !== null ? parsed : fallbackValue;
}

export function resolveQualityFrameRates({
    presetMode,
    imageMode,
    requestedFps,
    savedImageFps,
    savedStreamingFps,
    hasConfiguredStreamingFps,
    presetMinFps = 24,
    presetMaxFps = 60
}) {
    const explicitFps = parseOptionalFrameRate(requestedFps);
    const currentImageFps = normalizeFrameRate(savedImageFps, presetMinFps);
    const currentStreamingFps = normalizeFrameRate(savedStreamingFps, presetMinFps);

    let imageFps;
    let streamingFps;

    if (presetMode === 10) {
        imageFps = (imageMode && explicitFps !== null) ? explicitFps : currentImageFps;
        streamingFps = (!imageMode && explicitFps !== null) ? explicitFps : currentStreamingFps;
    } else {
        const presetFps = (presetMode === 3 || presetMode === 4 || presetMode === 5) ?
            presetMaxFps : presetMinFps;

        if (imageMode) {
            imageFps = explicitFps !== null ? explicitFps : presetFps;
            streamingFps = hasConfiguredStreamingFps ? currentStreamingFps : presetFps;
        } else {
            imageFps = presetFps;
            if (explicitFps !== null) {
                streamingFps = explicitFps;
            } else if (hasConfiguredStreamingFps) {
                streamingFps = currentStreamingFps;
            } else {
                streamingFps = presetFps;
            }
        }
    }

    return {
        imageFps,
        streamingFps,
        activeFps: imageMode ? imageFps : streamingFps,
        explicitFps
    };
}

export function frameRateToPseudoEncoding(value) {
    if (!isValidFrameRate(value)) {
        throw new RangeError(`Frame rate must be an integer between ${FRAME_RATE_MIN} and ${FRAME_RATE_MAX}`);
    }

    return encodings.pseudoEncodingFrameRateLevel10 + value - FRAME_RATE_MIN;
}
