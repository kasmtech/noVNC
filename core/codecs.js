import * as Log from './util/logging';
import {encodings} from "./encodings.js";

export const CODEC_NAMES = {
    AVC: 'AVC',
    HEVC: 'HEVC',
    AV1: 'AV1'
}

export const CODEC_IDS = {
    AVCQSV: encodings.pseudoEncodingStreamingModeAVCQSV,
    AVCNVENC: encodings.pseudoEncodingStreamingModeAVCNVENC,
    AVCVAAPI: encodings.pseudoEncodingStreamingModeAVCVAAPI,
    AVCSW: encodings.pseudoEncodingStreamingModeAVCSW,
    AVC: encodings.pseudoEncodingStreamingModeAVC,

    HEVCQSV: encodings.pseudoEncodingStreamingModeHEVCQSV,
    HEVCNVENC: encodings.pseudoEncodingStreamingModeHEVCNVENC,
    HEVCVAAPI: encodings.pseudoEncodingStreamingModeHEVCVAAPI,
    HEVCSW: encodings.pseudoEncodingStreamingModeHEVCSW,
    HEVC: encodings.pseudoEncodingStreamingModeHEVC,

    AV1QSV: encodings.pseudoEncodingStreamingModeAV1QSV,
    AV1VAAPI: encodings.pseudoEncodingStreamingModeAV1VAAPI,
    AV1NVENC: encodings.pseudoEncodingStreamingModeAV1NVENC,
    AV1SW: encodings.pseudoEncodingStreamingModeAV1SW,
    AV1: encodings.pseudoEncodingStreamingModeAV1
}

export const CODEC_VARIANT_NAMES = {
    [CODEC_IDS.AVCQSV]: 'HW H.264/AVC (QSV)',
    [CODEC_IDS.AVCNVENC]: 'HW H.264/AVC (NVENC)',
    [CODEC_IDS.AVCVAAPI]: 'HW H.264/AVC (VAAPI)',
    [CODEC_IDS.AVCSW]: 'SW H.264/AVC',

    [CODEC_IDS.HEVCQSV]: 'HW H.265/HEVC (QSV)',
    [CODEC_IDS.HEVCNVENC]: 'HW H.265/HEVC (NVENC)',
    [CODEC_IDS.HEVCVAAPI]: 'HW H.265/HEVC (VAAPI)',
    [CODEC_IDS.HEVCSW]: 'SW H.265/HEVC',

    [CODEC_IDS.AV1QSV]: 'HW AV1 (QSV) (experimental)',
    [CODEC_IDS.AV1NVENC]: 'HW AV1 (NVENC) (experimental)',
    [CODEC_IDS.AV1VAAPI]: 'HW AV1 (VAAPI) (experimental)',
    [CODEC_IDS.AV1SW]: 'SW AV1 (experimental)'
}

export const preferredCodecs = [
    encodings.pseudoEncodingStreamingModeHEVCVAAPI,
    encodings.pseudoEncodingStreamingModeAVCVAAPI,
    encodings.pseudoEncodingStreamingModeHEVCSW,
    encodings.pseudoEncodingStreamingModeAVCSW
];

export default class CodecDetector {
    constructor() {
        this._capabilities = null;
    }

    async detect() {
        if (!('VideoDecoder' in window)) {
            Log.Warn('WebCodecs API not available');
            this._capabilities = {};
            return;
        }

        const codecs = {
            [CODEC_NAMES.AVC]: 'avc1.42E01E',
            [CODEC_NAMES.HEVC]: 'hev1.1.6.L93.B0',
            [CODEC_NAMES.AV1]: 'av01.0.04M.08'
        };

        this._capabilities = {};

        for (const [name, codec] of Object.entries(codecs)) {
            try {
                const config = {
                    codec: codec,
                    codedWidth: 1920,
                    codedHeight: 1080
                };

                const support = await VideoDecoder.isConfigSupported(config);
                this._capabilities[name] = support.supported;
            } catch (error) {
                console.warn(`Error checking ${name}:`, error);
                this._capabilities[name] = false;
            }
        }

        return this;
    }

    isSupported(codec) {
        return this._capabilities[codec] || false;
    }

    getSupportedCodecIds() {
        return this.getSupportedCodecs().map(codec => CODEC_IDS[codec]);
    }

    getSupportedCodecs() {
        return Object.keys(this._capabilities).filter(codec => this._capabilities[codec]);
        // return this.getPreferredCodec();
    }

    getPreferredCodec() {
        if (this._capabilities.AVC) return CODEC_NAMES.AVC;
        if (this._capabilities.HEVC) return CODEC_NAMES.HEVC;
        if (this._capabilities.AV1) return CODEC_NAMES.AV1;

        return CODEC_NAMES.AVC; // fallback
    }
}