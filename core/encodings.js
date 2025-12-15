/*
 * noVNC: HTML5 VNC client
 * Copyright (C) 2019 The noVNC Authors
 * Licensed under MPL 2.0 (see LICENSE.txt)
 *
 * See README.md for usage and integration instructions.
 */

export const encodings = {
    encodingRaw: 0,
    encodingCopyRect: 1,
    encodingRRE: 2,
    encodingHextile: 5,
    encodingTight: 7,
    encodingKasmVideo: 17,
    encodingTightPNG: -260,
    encodingUDP: -261,

    pseudoEncodingQualityLevel9: -23,
    pseudoEncodingQualityLevel0: -32,
    pseudoEncodingDesktopSize: -223,
    pseudoEncodingLastRect: -224,
    pseudoEncodingCursor: -239,
    pseudoEncodingQEMUExtendedKeyEvent: -258,
    pseudoEncodingDesktopName: -307,
    pseudoEncodingExtendedDesktopSize: -308,
    pseudoEncodingXvp: -309,
    pseudoEncodingFence: -312,
    pseudoEncodingContinuousUpdates: -313,
    pseudoEncodingCompressLevel9: -247,
    pseudoEncodingCompressLevel0: -256,

    pseudoEncodingFrameRateLevel10: -2048,
    pseudoEncodingFrameRateLevel60: -1998,
    pseudoEncodingMaxVideoResolution: -1997,
    pseudoEncodingVideoScalingLevel0: -1996,
    pseudoEncodingVideoScalingLevel9: -1987,
    pseudoEncodingVideoOutTimeLevel1: -1986,
    pseudoEncodingVideoOutTimeLevel100: -1887,
    pseudoEncodingQOI: -1886,
    pseudoEncodingKasmDisconnectNotify: -1885,

    pseudoEncodingHardwareProfile0: -1170,
    pseudoEncodingHardwareProfile4: -1166,

    pseudoEncodingGOP1: -1165,
    pseudoEncodingGOP60: -1105,
    pseudoEncodingStreamingVideoQualityLevel0: -1104,
    pseudoEncodingStreamingVideoQualityLevel63: -1041,

    // AV1
    pseudoEncodingStreamingModeAV1QSV: -1040,
    pseudoEncodingStreamingModeAV1NVENC: -1039,
    pseudoEncodingStreamingModeAV1VAAPI: -1038,
    pseudoEncodingStreamingModeAV1SW: -1037,
    pseudoEncodingStreamingModeAV1: -1036,
    // h.265
    pseudoEncodingStreamingModeHEVCQSV: -1035,
    pseudoEncodingStreamingModeHEVCNVENC: -1034,
    pseudoEncodingStreamingModeHEVCVAAPI: -1033,
    pseudoEncodingStreamingModeHEVCSW: -1032,
    pseudoEncodingStreamingModeHEVC: -1031,
    // h.264
    pseudoEncodingStreamingModeAVCQSV: -1030,
    pseudoEncodingStreamingModeAVCNVENC: -1029,
    pseudoEncodingStreamingModeAVCVAAPI: -1028,
    pseudoEncodingStreamingModeAVCSW: -1027,
    pseudoEncodingStreamingModeAVC: -1026,

    pseudoEncodingStreamingModeJpegWebp: -1025,

    pseudoEncodingWEBP: -1024,
    pseudoEncodingJpegVideoQualityLevel0: -1023,
    pseudoEncodingJpegVideoQualityLevel9: -1014,
    pseudoEncodingWebpVideoQualityLevel0: -1013,
    pseudoEncodingWebpVideoQualityLevel9: -1004,
    pseudoEncodingTreatLosslessLevel0: -1003,
    pseudoEncodingTreatLosslessLevel10: -993,
    pseudoEncodingPreferBandwidth: -992,
    pseudoEncodingDynamicQualityMinLevel0: -991,
    pseudoEncodingDynamicQualityMinLevel9: -982,
    pseudoEncodingDynamicQualityMaxLevel0: -981,
    pseudoEncodingDynamicQualityMaxLevel9: -972,
    pseudoEncodingVideoAreaLevel1: -971,
    pseudoEncodingVideoAreaLevel100: -871,
    pseudoEncodingVideoTimeLevel0: -870,
    pseudoEncodingVideoTimeLevel100: -770,

    pseudoEncodingVMwareCursor: 0x574d5664,
    pseudoEncodingVMwareCursorPosition: 0x574d5666,
    pseudoEncodingExtendedClipboard: 0xc0a1e5ce
};

export function encodingName(num) {
    switch (num) {
        case encodings.encodingRaw:             return "Raw";
        case encodings.encodingCopyRect:        return "CopyRect";
        case encodings.encodingRRE:             return "RRE";
        case encodings.encodingHextile:         return "Hextile";
        case encodings.encodingTight:           return "Tight";
        case encodings.encodingTightPNG:        return "TightPNG";
        case encodings.pseudoEncodingStreamingModeAVCQSV:
        case encodings.pseudoEncodingStreamingModeAVCNVENC:
        case encodings.pseudoEncodingStreamingModeAVCVAAPI:
        case encodings.pseudoEncodingStreamingModeAVCSW:
        case encodings.pseudoEncodingStreamingModeAVC:
            return "KasmVideo AVC";
        case encodings.pseudoEncodingStreamingModeHEVCQSV:
        case encodings.pseudoEncodingStreamingModeHEVCNVENC:
        case encodings.pseudoEncodingStreamingModeHEVCVAAPI:
        case encodings.pseudoEncodingStreamingModeHEVCSW:
        case encodings.pseudoEncodingStreamingModeHEVC:
            return "KasmVideo HEVC";
        case encodings.pseudoEncodingStreamingModeAV1QSV:
        case encodings.pseudoEncodingStreamingModeAV1NVENC:
        case encodings.pseudoEncodingStreamingModeAV1VAAPI:
        case encodings.pseudoEncodingStreamingModeAV1SW:
        case encodings.pseudoEncodingStreamingModeAV1:
            return "KasmVideo AV1";
        default:                                return "[unknown encoding " + num + "]";
    }
}
