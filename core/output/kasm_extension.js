/* global chrome */

// Shared access to the Kasm browser extension (smartcard / FIDO2 / SSH agent relays).
// This is the published extension ID; the dev ID is not accepted here.
export const KASM_EXTENSION_ID = "cjkohjfgidilbllbjkdhpoeonjanpomo";

// Reasons an extension call can fail, exposed as ExtensionError.code.
export const EXTENSION_ERROR_MISSING = "missing";      // no chrome.runtime, or chrome.runtime.lastError
export const EXTENSION_ERROR_TIMEOUT = "timeout";      // no callback within timeoutMs
export const EXTENSION_ERROR_RESPONSE = "response";    // extension answered status: "error" (or nothing)

export class ExtensionError extends Error {
    constructor(code, message, result = null) {
        super(message);
        this.name = "ExtensionError";
        this.code = code;
        this.result = result;
    }
}

export const isExtensionApiAvailable = () => typeof chrome !== "undefined" && !!(chrome.runtime && chrome.runtime.sendMessage);

/**
 * Send one request to the extension and resolve with the response `result`.
 *
 * `args` is sent as is (the extension requires it to be defined; callers pass a
 * string, usually JSON). Without `timeoutMs` the call waits as long as the extension
 * takes, which ceremonies need (they can wait for a PIN or touch).
 *
 * Rejects with an ExtensionError. The message is the text relays have always sent
 * back to the guest: lastError text, `result` joined with " | ", or `defaultError`.
 */
export const callExtension = (type, args = "", { deviceId = "kasm-relay", timeoutMs = 0, defaultError = "extension_request_failed" } = {}) => (
    new Promise((resolve, reject) => {
        if (!isExtensionApiAvailable()) {
            reject(new ExtensionError(EXTENSION_ERROR_MISSING, "extension_api_unavailable"));
            return;
        }

        let timer = null;
        let settled = false;
        const settle = (fn, value) => {
            if (settled) {
                return;
            }
            settled = true;
            if (timer !== null) {
                clearTimeout(timer);
            }
            fn(value);
        };

        const message = {
            deviceId,
            completionId: Date.now().toString() + Math.random().toString(36),
            type,
            args,
        };

        const onResponse = (response) => {
            if (chrome.runtime.lastError) {
                settle(reject, new ExtensionError(EXTENSION_ERROR_MISSING, chrome.runtime.lastError.message));
                return;
            }

            if (!response || response.status === "error") {
                const result = response && Array.isArray(response.result) ? response.result : null;
                settle(reject, new ExtensionError(EXTENSION_ERROR_RESPONSE, result ? result.join(" | ") : defaultError, result));
            } else {
                settle(resolve, response.result);
            }
        };

        if (timeoutMs > 0) {
            timer = setTimeout(() => {
                settle(reject, new ExtensionError(EXTENSION_ERROR_TIMEOUT, "extension_timeout"));
            }, timeoutMs);
        }

        try {
            chrome.runtime.sendMessage(KASM_EXTENSION_ID, message, onResponse);
        } catch (e) {
            settle(reject, new ExtensionError(EXTENSION_ERROR_MISSING, e.message));
        }
    })
);
