/*
 * KasmVNC: HTML5 VNC client
 * Copyright (C) 2026 Kasm Technologies
 * Licensed under MPL 2.0 (see LICENSE.txt)
 *
 * See README.md for usage and integration instructions.
 */

import { encodings } from "../encodings.js";

export const MAX_NATIVE_ALIGNMENT_PAD = 2;

/**
 * Normalize window.devicePixelRatio to a positive finite number (defaulting to 1).
 * @param {number} pixelRatio
 * @returns {number}
 */
export function normalizePixelRatio(pixelRatio) {
    return (Number.isFinite(pixelRatio) && pixelRatio > 0) ? pixelRatio : 1;
}

/**
 * Build a tolerance-bounded resolution media query around the given DPR so
 * fractional DPRs (e.g. ChromeOS 2560/2327) reliably match despite CSS dppx/dpi
 * float rounding.
 * @param {number} devicePixelRatio
 * @returns {string}
 */
export function buildDprMediaQuery(devicePixelRatio) {
    const dpr = normalizePixelRatio(devicePixelRatio);
    const minDpr = Math.max(0.01, Number((dpr - 0.001).toFixed(6)));
    const maxDpr = Number((dpr + 0.001).toFixed(6));
    return `(min-resolution: ${minDpr}dppx) and (max-resolution: ${maxDpr}dppx)`;
}

/**
 * Floor a dimension to an even integer, returning 0 for values under 2px.
 * @param {number} value
 * @returns {number}
 */
export function floorEvenDimension(value) {
    if (!Number.isFinite(value) || value < 2) {
        return 0;
    }
    return Math.floor(value / 2) * 2;
}

/**
 * Round a positive dimension down to the nearest even integer (minimum 2).
 * @param {number} value
 * @returns {number}
 */
export function toEvenDimension(value) {
    if (!Number.isFinite(value) || value <= 0) {
        return 0;
    }
    return Math.max(2, Math.floor(value / 2) * 2);
}

/**
 * Parse an explicit dimension override (number or non-empty numeric string).
 * @param {*} value
 * @returns {number|null}
 */
export function parsePositiveDimension(value) {
    if (typeof value !== "number" && typeof value !== "string") {
        return null;
    }
    if (typeof value === "string" && value.trim() === "") {
        return null;
    }
    const numericValue = Number(value);
    if (!Number.isFinite(numericValue) || numericValue <= 0) {
        return null;
    }
    return numericValue;
}

/**
 * Extract integer physical pixel dimensions from a ResizeObserverEntry,
 * preferring devicePixelContentBoxSize when supported by the browser.
 * @param {ResizeObserverEntry} entry
 * @param {number} devicePixelRatio
 * @returns {{ width: number, height: number }}
 */
export function extractDevicePixelSize(entry, devicePixelRatio) {
    if (entry && entry.devicePixelContentBoxSize && entry.devicePixelContentBoxSize.length > 0) {
        const box = entry.devicePixelContentBoxSize[0];
        const w = box ? box.inlineSize : 0;
        const h = box ? box.blockSize : 0;
        return {
            width: (Number.isFinite(w) && w > 0) ? Math.round(w) : 0,
            height: (Number.isFinite(h) && h > 0) ? Math.round(h) : 0
        };
    }

    if (entry && entry.contentRect) {
        const dpr = normalizePixelRatio(devicePixelRatio);
        const w = entry.contentRect.width;
        const h = entry.contentRect.height;
        return {
            width: (Number.isFinite(w) && w > 0) ? Math.round(w * dpr) : 0,
            height: (Number.isFinite(h) && h > 0) ? Math.round(h * dpr) : 0
        };
    }

    return { width: 0, height: 0 };
}

/**
 * Resolve current physical pixel dimensions, ignoring cached ResizeObserver values
 * if window.devicePixelRatio has changed since the last observation.
 * @param {number} observedWidth
 * @param {number} observedHeight
 * @param {number|null} observedDpr
 * @param {number} currentDpr
 * @param {number} cssWidth
 * @param {number} cssHeight
 * @returns {{ width: number, height: number }}
 */
export function resolveObservedDevicePixelSize(
    observedWidth,
    observedHeight,
    observedDpr,
    currentDpr,
    cssWidth,
    cssHeight
) {
    const dpr = normalizePixelRatio(currentDpr);
    const safeCssW = (Number.isFinite(cssWidth) && cssWidth > 0) ? cssWidth : 0;
    const safeCssH = (Number.isFinite(cssHeight) && cssHeight > 0) ? cssHeight : 0;
    const dprMatches = observedDpr === null ||
        (Number.isFinite(observedDpr) && observedDpr > 0 && Math.abs(observedDpr - dpr) < 1e-6);
    const hasObservedW = dprMatches && Number.isFinite(observedWidth) && observedWidth > 0;
    const hasObservedH = dprMatches && Number.isFinite(observedHeight) && observedHeight > 0;
    return {
        width: hasObservedW ? Math.round(observedWidth) : Math.round(safeCssW * dpr),
        height: hasObservedH ? Math.round(observedHeight) : Math.round(safeCssH * dpr)
    };
}

/**
 * Return true when CSS scale factor * devicePixelRatio is 1:1 physical pixels.
 * @param {number} factor
 * @param {number} devicePixelRatio
 * @returns {boolean}
 */
export function isOneToOneScale(factor, devicePixelRatio) {
    const dpr = normalizePixelRatio(devicePixelRatio);
    return Number.isFinite(factor) && Math.abs(factor * dpr - 1) < 1e-3;
}

/**
 * Return true when framebuffer pixels map cleanly without fractional physical-pixel
 * resampling: either 1:1 physical pixels (factor * dpr ≈ 1) or unscaled CSS factor 1
 * on an integer DPR (e.g. 2x or 3x physical-pixel blocks).
 * @param {number} factor
 * @param {number} devicePixelRatio
 * @returns {boolean}
 */
export function isCrispScale(factor, devicePixelRatio) {
    const dpr = normalizePixelRatio(devicePixelRatio);
    return isOneToOneScale(factor, dpr) || (factor === 1 && Number.isInteger(dpr));
}

/**
 * Resolve CSS image-rendering mode for Canvas2D/WebGL canvases.
 * Returns null if no change is warranted (e.g. zero viewport width in auto mode).
 * @param {number} antiAliasing - 0 = auto, 1 = smooth, 2 = crisp
 * @param {number} factor
 * @param {number} devicePixelRatio
 * @param {number} viewPortWidth
 * @param {boolean} isFirefox
 * @returns {string|null}
 */
export function resolveImageRendering(antiAliasing, factor, devicePixelRatio, viewPortWidth, isFirefox) {
    const isCrisp = isCrispScale(factor, devicePixelRatio);
    const crispValue = isFirefox ? 'crisp-edges' : 'pixelated';

    if (antiAliasing === 2 || (antiAliasing === 0 && isCrisp && viewPortWidth > 0)) {
        return crispValue;
    }
    if (antiAliasing === 1 || (antiAliasing === 0 && !isCrisp)) {
        return 'auto';
    }
    return null;
}

/**
 * Resolve WebGL texture min/mag filter ('NEAREST' or 'LINEAR') for a VideoFrame blit.
 * @param {number} antiAliasing
 * @param {boolean} isCrisp
 * @param {number|undefined|null} frameDisplayWidth
 * @param {number|undefined|null} frameDisplayHeight
 * @param {number} targetWidth
 * @param {number} targetHeight
 * @returns {'NEAREST'|'LINEAR'}
 */
export function resolveWebGLTextureFilter(
    antiAliasing,
    isCrisp,
    frameDisplayWidth,
    frameDisplayHeight,
    targetWidth,
    targetHeight
) {
    if (antiAliasing === 2) {
        return 'NEAREST';
    }
    if (antiAliasing === 1) {
        return 'LINEAR';
    }
    const matchesTarget = frameDisplayWidth == null ||
        (frameDisplayWidth === targetWidth && frameDisplayHeight === targetHeight);
    return (isCrisp && matchesTarget) ? 'NEAREST' : 'LINEAR';
}

/**
 * Compute server framebuffer dimensions, client display dimensions, scale, and
 * native 1:1 eligibility for the primary screen.
 * @param {object} params
 * @returns {object}
 */
export function computeScreenLayout({
    parentWidth,
    parentHeight,
    devicePixelWidth = 0,
    devicePixelHeight = 0,
    devicePixelObserverDpr = null,
    devicePixelRatio,
    resolutionQuality,
    maxWidth,
    maxHeight,
    hiDpi,
    disableLimit,
    disableScaling,
    clipViewport = false,
    streamMode,
    ignoreServerReported = false,
    serverReportedWidth = 0,
    serverReportedHeight = 0,
    currentServerWidth = 0,
    currentServerHeight = 0,
    screenCount = 1,
    antiAliasing
}) {
    const pixelRatio = normalizePixelRatio(devicePixelRatio);
    const cssWidth = (Number.isFinite(parentWidth) && parentWidth > 0) ? parentWidth : 0;
    const cssHeight = (Number.isFinite(parentHeight) && parentHeight > 0) ? parentHeight : 0;
    const containerWidth = floorEvenDimension(cssWidth);
    const containerHeight = floorEvenDimension(cssHeight);
    const physicalSize = resolveObservedDevicePixelSize(
        devicePixelWidth,
        devicePixelHeight,
        devicePixelObserverDpr,
        pixelRatio,
        cssWidth,
        cssHeight
    );
    const physicalWidth = physicalSize.width;
    const physicalHeight = physicalSize.height;

    const parsedMaxWidth = parsePositiveDimension(maxWidth);
    const parsedMaxHeight = parsePositiveDimension(maxHeight);
    const hasForcedResolution = parsedMaxWidth !== null || parsedMaxHeight !== null;

    let width = parsedMaxWidth !== null ? parsedMaxWidth : containerWidth;
    let height = parsedMaxHeight !== null ? parsedMaxHeight : containerHeight;
    let usedServerReported = false;
    let usedQualityCap = false;
    let smallDeviceAutoScale = null;

    if (
        !ignoreServerReported &&
        (serverReportedWidth > 0 && serverReportedHeight > 0) &&
        (
            disableScaling ||
            (serverReportedWidth !== currentServerWidth || serverReportedHeight !== currentServerHeight)
        ) &&
        !hasForcedResolution
    ) {
        height = serverReportedHeight;
        width = serverReportedWidth;
        usedServerReported = true;
    } else if (width > 1280 && !disableLimit && resolutionQuality == 1 && streamMode == encodings.pseudoEncodingStreamingModeJpegWebp) {
        height = toEvenDimension(1280 * (height / width));
        width = 1280;
        usedQualityCap = true;
    } else if (resolutionQuality == 0 && !disableLimit && streamMode == encodings.pseudoEncodingStreamingModeJpegWebp) {
        width = 1280;
        height = 720;
        usedQualityCap = true;
    } else if (hiDpi) {
        if (!hasForcedResolution && physicalWidth > 0 && physicalHeight > 0) {
            width = toEvenDimension(physicalWidth);
            height = toEvenDimension(physicalHeight);
        } else {
            width = toEvenDimension(width * pixelRatio);
            height = toEvenDimension(height * pixelRatio);
        }
    } else if (antiAliasing === 0 && pixelRatio > 1 && width < 1000 && width > 0) {
        const reportedWidth = width;
        const reportedHeight = height;
        const targetDevicePixelRatio = pixelRatio > 2 ? 2 : 1.5;
        const scaleRatio = pixelRatio / targetDevicePixelRatio;
        width = toEvenDimension(width * scaleRatio);
        height = toEvenDimension(height * scaleRatio);
        smallDeviceAutoScale = {
            reportedWidth,
            reportedHeight,
            scaleRatio
        };
    } else if (!hasForcedResolution && !disableScaling && Math.abs(pixelRatio - 1) < 1e-4 && physicalWidth > 0 && physicalHeight > 0) {
        width = toEvenDimension(physicalWidth);
        height = toEvenDimension(physicalHeight);
    } else {
        width = toEvenDimension(width);
        height = toEvenDimension(height);
    }

    const nativeEligible = Boolean(
        !disableScaling &&
        !clipViewport &&
        !hasForcedResolution &&
        !usedQualityCap &&
        !usedServerReported &&
        screenCount === 1 &&
        (hiDpi || Math.abs(pixelRatio - 1) < 1e-4)
    );

    let scale;
    if (nativeEligible && width > 0 && height > 0 && physicalWidth >= width && physicalHeight >= height) {
        scale = 1 / pixelRatio;
    } else {
        const clientServerRatioH = height > 0 ? containerHeight / height : 0;
        const clientServerRatioW = width > 0 ? containerWidth / width : 0;
        scale = Math.min(clientServerRatioH, clientServerRatioW);
    }

    return {
        containerWidth,
        containerHeight,
        pixelRatio,
        width: width > 0 ? containerWidth : 0,
        height: height > 0 ? containerHeight : 0,
        serverWidth: width,
        serverHeight: height,
        scale,
        nativeEligible,
        smallDeviceAutoScale
    };
}

/**
 * Determine whether native 1:1 backing-store pinning should be active for the
 * current render pass.
 * @param {object} params
 * @returns {boolean}
 */
export function isNativeSurfaceActive({
    nativeEligible,
    hasContainer,
    hasTarget,
    screenCount,
    clipViewport,
    scale = 1,
    devicePixelRatio = 1,
    serverWidth,
    serverHeight,
    fbWidth,
    fbHeight,
    devicePixelWidth,
    devicePixelHeight
}) {
    if (!nativeEligible || !hasContainer || !hasTarget || screenCount !== 1 || clipViewport) {
        return false;
    }
    if (!isOneToOneScale(scale, devicePixelRatio)) {
        return false;
    }
    if (serverWidth <= 0 || serverHeight <= 0 || devicePixelWidth <= 0 || devicePixelHeight <= 0) {
        return false;
    }
    // Keep standard scaling during resize debounce until the server confirms the new framebuffer size.
    const activeFbWidth = fbWidth > 0 ? fbWidth : serverWidth;
    const activeFbHeight = fbHeight > 0 ? fbHeight : serverHeight;
    if (activeFbWidth !== serverWidth || activeFbHeight !== serverHeight) {
        return false;
    }
    const padX = devicePixelWidth - serverWidth;
    const padY = devicePixelHeight - serverHeight;
    return padX >= 0 && padX <= MAX_NATIVE_ALIGNMENT_PAD &&
        padY >= 0 && padY <= MAX_NATIVE_ALIGNMENT_PAD;
}

/**
 * Clamp a pointer coordinate to the valid server screen range [origin, origin + extent - 1]
 * when native backing-store padding is active.
 * @param {number} coord
 * @param {number} origin
 * @param {number} extent
 * @returns {number}
 */
export function clampNativeCoordinate(coord, origin, extent) {
    if (extent <= 0) {
        return coord;
    }
    return Math.max(origin, Math.min(origin + extent - 1, coord));
}

/**
 * Clamp a CSS-pixel canvas offset so that dividing by scale lands inside
 * [0, serverExtent - 1] when a secondary display has native mod-2 alignment padding.
 * @param {number} offset
 * @param {number} scale
 * @param {number} serverExtent
 * @returns {number}
 */
export function clampNativeClientOffset(offset, scale, serverExtent) {
    if (!Number.isFinite(offset) || !Number.isFinite(scale) || scale <= 0 || serverExtent <= 0) {
        return offset;
    }
    if (offset < 0) {
        return 0;
    }
    if (offset / scale >= serverExtent) {
        return (serverExtent - 0.5) * scale;
    }
    return offset;
}
