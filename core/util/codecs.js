import * as Log from './logging';

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
            av1: 'av01.0.04M.08',
            h265: 'hev1.1.6.L93.B0',
            h264: 'avc1.42E01E',
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

    getSupportedCodecs() {
        return Object.keys(this._capabilities).filter(codec => this._capabilities[codec]);
    }

    getPreferredCodec() {
        if (this._capabilities.h264) return 'h264';
        if (this._capabilities.h265) return 'h265';
        if (this._capabilities.av1) return 'av1';

        return 'h264'; // fallback
    }

    getCapabilities() {
        return { ...this._capabilities };
    }
}