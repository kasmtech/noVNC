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

    pseudoEncodingHardwareProfile4: -1169,
    pseudoEncodingHardwareProfile0: -1165,

    pseudoEncodingGOP59: -1164,
    pseudoEncodingGOP1: -1105,
    pseudoEncodingStreamingVideoQualityLevel63: -1104,
    pseudoEncodingStreamingVideoQualityLevel0: -1041,

    // AV1
    pseudoEncodingAV1QSV: -1040,
    pseudoEncodingAV1NVENC: -1039,
    pseudoEncodingAV1VAAPI: -1038,
    pseudoEncodingAV1SW: -1037,
    pseudoEncodingAV1: -1036,
    // h.265
    pseudoEncodingHEVCQSV: -1035,
    pseudoEncodingHEVCNVENC: -1034,
    pseudoEncodingHEVCVAAPI: -1033,
    pseudoEncodingHEVCSW: -1032,
    pseudoEncodingHEVC: -1031,
    // h.264
    pseudoEncodingAVCQSV: -1030,
    pseudoEncodingAVCNVENC: -1029,
    pseudoEncodingAVCVAAPI: -1028,
    pseudoEncodingAVCSW: -1027,
    pseudoEncodingAVC: -1026,

    pseudoEncodingStreamingMode: -1025,

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
        case encodings.encodingRaw:         return "Raw";
        case encodings.encodingCopyRect:    return "CopyRect";
        case encodings.encodingRRE:         return "RRE";
        case encodings.encodingHextile:     return "Hextile";
        case encodings.encodingTight:       return "Tight";
        case encodings.encodingTightPNG:    return "TightPNG";
        case encodings.encodingKasmVideo:   return "KasmVideo";
        default:                            return "[unknown encoding " + num + "]";
    }
}
