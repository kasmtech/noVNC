import * as Log from './util/logging';
import {encodings} from "./encodings.js";
import avcUrl from './assets/avc.bin?url';
import hevcUrl from './assets/hevc.bin?url';
import av1Url from './assets/av1.bin?url';

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

const CODECS = {
    [CODEC_NAMES.AVC]: 'avc1.64001F', // avc1.42E01E', avc1.42e01f
    [CODEC_NAMES.HEVC]: 'hev1.1.6.L123.B0',
    [CODEC_NAMES.AV1]: 'av01.0.04M.08'
};

export const VIDEO_CODEC_NAMES = {
    1: CODECS[CODEC_NAMES.AVC],
    2: CODECS[CODEC_NAMES.HEVC],
    3: CODECS[CODEC_NAMES.AV1]
};

let HARDWARE_ACCELERATION = {
    [CODEC_NAMES.AVC]: 'prefer-hardware',
    [CODEC_NAMES.HEVC]: 'prefer-hardware',
    [CODEC_NAMES.AV1]: 'prefer-hardware'
};

const CACHE_CODECS_KEY = 'kasm_video_codecs_v1';

const CODEC_TEST_FRAMES = {
    AVC: {url: avcUrl, codec: CODECS[CODEC_NAMES.AVC], w: 128, h: 128},
    HEVC: {url: hevcUrl, codec: CODECS[CODEC_NAMES.HEVC], w: 128, h: 128},
    AV1: {url: av1Url, codec: CODECS[CODEC_NAMES.AV1], w: 128, h: 128},
};

export const VIDEO_CODEC_HW_ACC = {
    1: HARDWARE_ACCELERATION[CODEC_NAMES.AVC],
    2: HARDWARE_ACCELERATION[CODEC_NAMES.HEVC],
    3: HARDWARE_ACCELERATION[CODEC_NAMES.AV1]
}

export const preferredCodecs = [
    encodings.pseudoEncodingStreamingModeAVCVAAPI,
    encodings.pseudoEncodingStreamingModeAVCSW,
    encodings.pseudoEncodingStreamingModeHEVCVAAPI,
    encodings.pseudoEncodingStreamingModeHEVCSW
];

export default class CodecDetector {
    constructor() {
        this._capabilities = null;
    }

    async detect() {
        const cached = localStorage.getItem(CACHE_CODECS_KEY);
        if (cached) {
            try {
                const { capabilities, hwAcceleration } = JSON.parse(cached);
                this._capabilities = capabilities;
                Object.assign(HARDWARE_ACCELERATION, hwAcceleration);
                return this;
            } catch {
                localStorage.removeItem(CACHE_CODECS_KEY);
            }
        }

        this._capabilities = {};

        if (!('VideoDecoder' in window)) {
            Log.Warn('WebCodecs API not available');
            return this;
        }

        for (const [name, {url, codec}] of Object.entries(CODEC_TEST_FRAMES)) {
            try {
                const response = await fetch(url);
                if (!response.ok)
                    throw new Error(`HTTP ${response.status}`);

                const data = await response.arrayBuffer();

                const config = {
                    codec: codec,
                    codedWidth: 1920,
                    codedHeight: 1080,
                    optimizeForLatency: true,
                    hardwareAcceleration: 'prefer-hardware'
                };

                let supported = await this._tryDecode(data, config, name);

                if (!supported) {
                    Log.Warn(`${name}: hardware decode failed, retrying with software`);
                    config.hardwareAcceleration = 'prefer-software';
                    supported = await this._tryDecode(data, config, name);
                    if (supported) {
                        HARDWARE_ACCELERATION[name] = config.hardwareAcceleration;
                    }
                }

                this._capabilities[name] = supported;
            } catch (error) {
                Log.Warn(`${name}: frame fetch failed, falling back to isConfigSupported: ${error}`);
                this._capabilities[name] = await this._tryDetect(codec);
            }
        }

        localStorage.setItem(CACHE_CODECS_KEY, JSON.stringify({
            capabilities: this._capabilities,
            hwAcceleration: HARDWARE_ACCELERATION
        }));

        Log.Debug('Codec capabilities detected and cached:', this._capabilities);
        return this;
    }

    async _tryDetect(config) {
        let support = await VideoDecoder.isConfigSupported(config);
        return support.supported;
    }

    async _tryDecode(data, config, name) {
        return new Promise((resolve) => {
            const decoder = new VideoDecoder({
                output: frame => {
                    frame.close();
                    if (decoder.state !== 'closed')
                        decoder.close();
                    resolve(true);
                },
                error: e => {
                    if (decoder.state !== 'closed')
                        decoder.close();
                    Log.Warn(`Error decoding ${name} using ${config.hardwareAcceleration}:`, e);
                    resolve(false);
                },
            });
            try {
                decoder.configure(config);
                decoder.decode(new EncodedVideoChunk({type: 'key', timestamp: 0, data: data}));
                decoder.flush().catch(e => {
                    resolve(false);
                });

            } catch (e) {
                Log.Warn(`Error decoding ${name} using ${config.hardwareAcceleration}:`, e);
                if (decoder.state !== 'closed')
                    decoder.close();
                resolve(false);
            }
        });
    }

    isSupported(codec) {
        return this._capabilities[codec];
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