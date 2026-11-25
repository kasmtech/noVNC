import { encodings } from "../encodings.js";

export function floorEvenDimension(value) {
    if (!Number.isFinite(value) || value < 2) {
        return 0;
    }

    return Math.floor(value / 2) * 2;
}

export function toEvenDimension(value) {
    if (!Number.isFinite(value) || value <= 0) {
        return 0;
    }

    return Math.max(2, Math.floor(value / 2) * 2);
}

export function normalizePixelRatio(pixelRatio) {
    return (Number.isFinite(pixelRatio) && pixelRatio > 0) ? pixelRatio : 1;
}

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

export function computeScreenDimensions({
    parentWidth,
    parentHeight,
    devicePixelRatio,
    resolutionQuality,
    maxWidth,
    maxHeight,
    hiDpi,
    disableLimit,
    disableScaling,
    streamMode,
    ignoreServerReported = false,
    serverReportedWidth = 0,
    serverReportedHeight = 0,
    currentServerWidth = 0,
    currentServerHeight = 0,
    antiAliasing
}) {
    const containerHeight = floorEvenDimension(parentHeight);
    const containerWidth = floorEvenDimension(parentWidth);
    const pixelRatio = normalizePixelRatio(devicePixelRatio);

    const parsedMaxWidth = parsePositiveDimension(maxWidth);
    const parsedMaxHeight = parsePositiveDimension(maxHeight);

    let width = parsedMaxWidth !== null ? parsedMaxWidth : containerWidth;
    let height = parsedMaxHeight !== null ? parsedMaxHeight : containerHeight;
    let smallDeviceAutoScale = null;

    if (
        !ignoreServerReported &&
        (serverReportedWidth > 0 && serverReportedHeight > 0) &&
        (
            disableScaling ||
            (serverReportedWidth !== currentServerWidth || serverReportedHeight !== currentServerHeight)
        ) &&
        (parsedMaxWidth === null && parsedMaxHeight === null)
    ) {
        height = serverReportedHeight;
        width = serverReportedWidth;
    } else if (width > 1280 && !disableLimit && resolutionQuality == 1 && streamMode == encodings.pseudoEncodingStreamingModeJpegWebp) {
        height = toEvenDimension(1280 * (height / width));
        width = 1280;
    } else if (resolutionQuality == 0 && !disableLimit && streamMode == encodings.pseudoEncodingStreamingModeJpegWebp) {
        width = 1280;
        height = 720;
    } else if (hiDpi) {
        width = toEvenDimension(width * pixelRatio);
        height = toEvenDimension(height * pixelRatio);
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
    } else {
        width = toEvenDimension(width);
        height = toEvenDimension(height);
    }

    const clientServerRatioH = height > 0 ? containerHeight / height : 0;
    const clientServerRatioW = width > 0 ? containerWidth / width : 0;

    return {
        containerWidth,
        containerHeight,
        pixelRatio,
        width: width > 0 ? containerWidth : 0,
        height: height > 0 ? containerHeight : 0,
        serverWidth: width,
        serverHeight: height,
        scale: Math.min(clientServerRatioH, clientServerRatioW),
        smallDeviceAutoScale
    };
}
