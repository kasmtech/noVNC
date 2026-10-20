// Live status for the WebAuthn (FIDO2) and SSH-agent passthrough features.
//
// Mirrors smartcard_status: the page posts a flat object to the parent window and the
// parent renders it. One extension call (`get_status`) answers both features, so the
// probe and its schedule are shared by fido2.js and ssh_agent.js through one monitor
// per RFB connection.
import * as Log from "../util/logging.js";
import * as WebUtil from "../../app/webutil.js";
import {
    callExtension,
    EXTENSION_ERROR_MISSING,
    EXTENSION_ERROR_TIMEOUT,
    EXTENSION_ERROR_RESPONSE,
} from "./kasm_extension.js";

const PROBE_INTERVAL_MS = 10000;     // while the page is visible
const EXTENSION_TIMEOUT_MS = 5000;   // no answer from the extension => extension_unresponsive
const QUIET_PERIOD_MS = 1000;        // no probe this soon after a ceremony / agent exchange
const STATE_DEBOUNCE_MS = 100;       // lets both relay subscribe replies land in one probe

const STATUS_DEVICE_ID = "status-relay";

const FEATURES = {
    fido2: { action: "fido2_status", relay: "fido2" },
    sshAgent: { action: "ssh_agent_status", relay: "ssh_agent" },
};

// What the extension may report for nativeClientReason when it is not connected.
const NATIVE_CLIENT_REASONS = new Set(["native_client_unreachable", "unsupported_platform"]);

const fido2Status = isAllowed => ({
    isAllowed,
    isExtensionEnabled: false,
    isNativeClientConnected: false,
    isBackendUsable: false,
    isDevicePresent: null,
    deviceCount: null,
    reason: "policy_disabled",
});

const sshAgentStatus = isAllowed => ({
    isAllowed,
    isExtensionEnabled: false,
    isNativeClientConnected: false,
    isAgentConfigured: false,
    isAgentReachable: false,
    reason: "policy_disabled",
});

// Turn a failed extension call into a probe outcome (spec section 5, "Detection from the page").
export const classifyProbeError = (error) => {
    switch (error && error.code) {
        case EXTENSION_ERROR_MISSING:
            return { reason: "extension_missing" };
        case EXTENSION_ERROR_TIMEOUT:
            return { reason: "extension_unresponsive" };
        case EXTENSION_ERROR_RESPONSE:
            if (error.result && error.result[1] === "unsupported_instruction") {
                return { reason: "extension_outdated" };
            }
            return { reason: "extension_unresponsive" };
        default:
            return { reason: "extension_unresponsive" };
    }
};

// Turn a successful get_status result into a probe outcome. A probe outcome is either
// {reason} (the extension-level failure) or {result} (a usable get_status payload).
export const classifyProbeResult = (result) => {
    if (!result || typeof result !== "object") {
        return { reason: "extension_unresponsive" };
    }
    return { result };
};

// Shared first links of the chain. Returns a failing reason, or null when the native
// client answered and the feature object has to be evaluated.
const failingLink = (status, probe) => {
    if (probe.reason) {
        return probe.reason;
    }

    status.isExtensionEnabled = true;
    const result = probe.result;

    if (result.platform === "cros") {
        return "unsupported_platform";
    }

    if (!result.nativeClientConnected) {
        return NATIVE_CLIENT_REASONS.has(result.nativeClientReason) ? result.nativeClientReason : "native_client_unreachable";
    }

    status.isNativeClientConnected = true;
    return null;
};

export const buildFido2Status = (isAllowed, probe) => {
    const status = fido2Status(isAllowed);
    if (isAllowed === false) {
        return status;
    }

    const failure = failingLink(status, probe);
    if (failure) {
        status.reason = failure;
        return status;
    }

    const fido2 = probe.result.fido2;
    if (!fido2) {
        status.reason = "native_client_outdated";
        return status;
    }

    status.isBackendUsable = fido2.backendUsable === true;
    if (Number.isInteger(fido2.deviceCount) && fido2.deviceCount >= 0) {
        status.deviceCount = fido2.deviceCount;
        status.isDevicePresent = fido2.deviceCount > 0;
    }
    status.reason = status.isBackendUsable ? "ok" : "backend_unavailable";
    return status;
};

export const buildSshAgentStatus = (isAllowed, probe) => {
    const status = sshAgentStatus(isAllowed);
    if (isAllowed === false) {
        return status;
    }

    const failure = failingLink(status, probe);
    if (failure) {
        status.reason = failure;
        return status;
    }

    const agent = probe.result.sshAgent;
    if (!agent) {
        status.reason = "native_client_outdated";
        return status;
    }

    status.isAgentConfigured = agent.configured === true;
    status.isAgentReachable = status.isAgentConfigured && agent.reachable === true;
    if (!status.isAgentConfigured) {
        status.reason = "agent_not_configured";
    } else if (!status.isAgentReachable) {
        status.reason = "agent_unreachable";
    } else {
        status.reason = "ok";
    }
    return status;
};

const BUILDERS = {
    fido2: buildFido2Status,
    sshAgent: buildSshAgentStatus,
};

class PassthroughStatusMonitor {
    constructor(rfb) {
        this._rfb = rfb;
        this._started = false;
        this._enabled = false;
        this._stopped = false;

        this._probing = false;
        this._reprobe = false;
        this._activeCount = 0;
        this._lastActivityEndedAt = 0;
        this._disabledPosted = {};

        this._debounceTimer = null;
        this._intervalTimer = null;

        this._onRelayState = this._onRelayState.bind(this);
        this._onVisibilityChange = this._onVisibilityChange.bind(this);
        this._onDisconnect = this._onDisconnect.bind(this);
    }

    // Idempotent. Called by each relay once it has subscribed.
    start() {
        if (this._started) {
            return;
        }
        this._started = true;

        // Same guards as smartcard_status, plus the primary display (the only one that
        // subscribes to relays).
        if (!this._rfb._isPrimaryDisplay || !WebUtil.isInsideKasmVDI()) {
            return;
        }
        this._enabled = true;

        this._rfb.addEventListener("unixrelaystate", this._onRelayState);
        this._rfb.addEventListener("disconnect", this._onDisconnect);
        document.addEventListener("visibilitychange", this._onVisibilityChange);
        this._startTimer();

        for (const feature of Object.keys(FEATURES)) {
            if (this._relayState(feature).isAllowed === false) {
                this._postDisabledOnce(feature);
            }
        }
        this._requestProbe("state");
    }

    stop() {
        this._stopped = true;
        this._enabled = false;
        this._stopTimer();
        clearTimeout(this._debounceTimer);
        this._debounceTimer = null;
        this._rfb.removeEventListener("unixrelaystate", this._onRelayState);
        this._rfb.removeEventListener("disconnect", this._onDisconnect);
        document.removeEventListener("visibilitychange", this._onVisibilityChange);
    }

    // A ceremony or agent exchange is starting. No probe runs while any is in flight.
    beginActivity() {
        this._activeCount++;
    }

    // It finished. A failure triggers one immediate probe so the panel explains why.
    endActivity(failed = false) {
        this._activeCount = Math.max(0, this._activeCount - 1);
        this._lastActivityEndedAt = Date.now();
        if (failed) {
            this._requestProbe("failure");
        }
    }

    _relayState(feature) {
        const relay = FEATURES[feature].relay;
        return {
            isAllowed: this._rfb.getUnixRelayState(relay),
            replied: this._rfb.hasUnixRelayReply(relay),
        };
    }

    _onRelayState(event) {
        const feature = Object.keys(FEATURES).find(key => FEATURES[key].relay === event.detail.name);
        if (!feature) {
            return;
        }
        if (event.detail.isAllowed === false) {
            this._postDisabledOnce(feature);
        }
        this._requestProbe("state");
    }

    _onVisibilityChange() {
        if (document.hidden) {
            this._stopTimer();
        } else {
            this._startTimer();
            this._requestProbe("visible");
        }
    }

    _onDisconnect() {
        this.stop();
    }

    _startTimer() {
        if (this._intervalTimer !== null || document.hidden) {
            return;
        }
        this._intervalTimer = setInterval(() => this._requestProbe("timer"), PROBE_INTERVAL_MS);
    }

    _stopTimer() {
        if (this._intervalTimer !== null) {
            clearInterval(this._intervalTimer);
            this._intervalTimer = null;
        }
    }

    // A disabled feature gets one policy_disabled message and is never probed.
    _postDisabledOnce(feature) {
        if (this._disabledPosted[feature]) {
            return;
        }
        this._disabledPosted[feature] = true;
        this._post(feature, BUILDERS[feature](false, null));
    }

    // Features worth probing: relay answered (the policy is known) and not disabled.
    // isAllowed null with a reply means an old Xvnc that does not name the relay.
    _probeableFeatures() {
        return Object.keys(FEATURES).filter((feature) => {
            const { isAllowed, replied } = this._relayState(feature);
            return replied && isAllowed !== false;
        });
    }

    _requestProbe(kind) {
        if (!this._enabled || this._stopped) {
            return;
        }

        if (this._probing) {
            // A state change while probing may add a feature that this probe skipped.
            if (kind === "state") {
                this._reprobe = true;
            }
            return;
        }

        if (kind === "state") {
            if (this._debounceTimer === null) {
                this._debounceTimer = setTimeout(() => {
                    this._debounceTimer = null;
                    this._probeIfEligible(false);
                }, STATE_DEBOUNCE_MS);
            }
            return;
        }

        // A failure probe skips the quiet period, since the failure just ended it.
        this._probeIfEligible(kind === "failure");
    }

    _probeIfEligible(ignoreQuietPeriod) {
        if (!this._enabled || this._stopped || this._probing || document.hidden) {
            return;
        }
        if (this._activeCount > 0) {
            return;
        }
        if (!ignoreQuietPeriod && Date.now() - this._lastActivityEndedAt < QUIET_PERIOD_MS) {
            return;
        }
        if (this._probeableFeatures().length === 0) {
            return;
        }
        this._probe();
    }

    async _probe() {
        this._probing = true;
        let probe;
        try {
            const result = await callExtension("get_status", "", {
                deviceId: STATUS_DEVICE_ID,
                timeoutMs: EXTENSION_TIMEOUT_MS,
                defaultError: "get_status_failed",
            });
            probe = classifyProbeResult(result);
        } catch (error) {
            Log.Debug(`passthrough_status: get_status failed: ${error.message}`);
            probe = classifyProbeError(error);
        } finally {
            this._probing = false;
        }

        if (this._stopped) {
            return;
        }

        for (const feature of this._probeableFeatures()) {
            const { isAllowed } = this._relayState(feature);
            this._post(feature, BUILDERS[feature](isAllowed, probe));
        }

        if (this._reprobe) {
            this._reprobe = false;
            this._requestProbe("state");
        }
    }

    _post(feature, value) {
        Log.Debug(`passthrough_status.${FEATURES[feature].action}: ${JSON.stringify(value)}`);
        window.parent.postMessage({ action: FEATURES[feature].action, value }, "*");
    }
}

const monitors = new WeakMap();

export const getPassthroughStatusMonitor = (rfb) => {
    let monitor = monitors.get(rfb);
    if (!monitor) {
        monitor = new PassthroughStatusMonitor(rfb);
        monitors.set(rfb, monitor);
    }
    return monitor;
};
