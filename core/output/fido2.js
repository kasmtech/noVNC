import * as Log from "../../core/util/logging.js";
import { KASM_EXTENSION_ID } from "./kasm_extension.js";

const REQUEST_MAKE_CREDENTIAL = 0x01;
const REQUEST_GET_ASSERTION = 0x02;
const REQUEST_LIST_DEVICES = 0x03;
const REQUEST_CANCEL = 0x04;
const RELAY_PUSH = 0x05; // unsolicited, browser -> container; tag 0, never answered
const RESPONSE_ACK = 0x80;
const RESPONSE_ERROR = 0x81;

const PROTOCOL_VERSION_V2 = 0x11;
// v2 header: [ver][cmd][deviceId][tag:u32][session:u16][len:u32], 13 bytes,
// then payload. A response must echo the same tag as its request - KasmVNC's
// XserverDesktop.cc now routes relay replies by tag instead of to whichever
// sender happened to send last, so an unechoed/wrong tag misroutes the reply.
// Hard cutover: v1 (no tag) is no longer sent or accepted.
const V2_HEADER_SIZE = 13;

const commandToString = (command) => {
    return {
        [REQUEST_MAKE_CREDENTIAL]: "REQUEST_MAKE_CREDENTIAL",
        [REQUEST_GET_ASSERTION]: "REQUEST_GET_ASSERTION",
        [REQUEST_LIST_DEVICES]: "REQUEST_LIST_DEVICES",
        [REQUEST_CANCEL]: "REQUEST_CANCEL",
        [RELAY_PUSH]: "RELAY_PUSH",
        [RESPONSE_ACK]: "RESPONSE_ACK",
        [RESPONSE_ERROR]: "RESPONSE_ERROR",
    }[command] || `0x${command.toString(16).toUpperCase()}`;
};

const createRelayPacket = (command, deviceId, tag, session, payload = new Uint8Array(0)) => {
    if (command !== RESPONSE_ACK && command !== RESPONSE_ERROR && command !== RELAY_PUSH) {
        throw new Error("invalid_relay_response");
    }
    const packet = new Uint8Array(V2_HEADER_SIZE + payload.length);
    packet[0] = PROTOCOL_VERSION_V2;
    packet[1] = command;
    packet[2] = deviceId;
    packet[3] = (tag >>> 24) & 0xff;
    packet[4] = (tag >>> 16) & 0xff;
    packet[5] = (tag >>> 8) & 0xff;
    packet[6] = tag & 0xff;
    packet[7] = (session >>> 8) & 0xff;
    packet[8] = session & 0xff;
    const len = payload.length;
    packet[9] = (len >>> 24) & 0xff;
    packet[10] = (len >>> 16) & 0xff;
    packet[11] = (len >>> 8) & 0xff;
    packet[12] = len & 0xff;
    packet.set(payload, V2_HEADER_SIZE);
    return packet;
};

const parseRelayPacket = (data) => {
    if (!data || data.length < V2_HEADER_SIZE || data[0] !== PROTOCOL_VERSION_V2) {
        throw new Error("relay_packet_invalid");
    }
    const command = data[1];
    const deviceId = data[2];
    const tag = ((data[3] << 24) | (data[4] << 16) | (data[5] << 8) | data[6]) >>> 0;
    const session = (data[7] << 8) | data[8];
    const payloadLength = ((data[9] << 24) | (data[10] << 16) | (data[11] << 8) | data[12]) >>> 0;
    if (data.length < V2_HEADER_SIZE + payloadLength) {
        throw new Error("relay_packet_incomplete");
    }
    return { command, deviceId, tag, session, payload: data.slice(V2_HEADER_SIZE, V2_HEADER_SIZE + payloadLength) };
};

const encodeJson = (value) => new TextEncoder().encode(JSON.stringify(value ?? {}));
const decodeJson = (payload) => (payload.length === 0 ? {} : JSON.parse(new TextDecoder().decode(payload)));

const callExtension = (type, params, completionId, sessionId) => {
    return new Promise((resolve, reject) => {
        const paramsWithSession =
            params !== undefined && sessionId !== undefined ? { ...params, sessionId } : params;
        const message = {
            deviceId: "fido2-relay",
            completionId: completionId || (Date.now().toString() + Math.random().toString(36)),
            type,
            args: paramsWithSession === undefined ? "" : JSON.stringify(paramsWithSession),
        };

        const onResponse = (response) => {
            if (chrome.runtime.lastError) {
                reject(new Error(chrome.runtime.lastError.message));
                return;
            }

            if (!response || response.status === "error") {
                const detail = response && Array.isArray(response.result) ? response.result.join(" | ") : "fido2_request_failed";
                reject(new Error(detail));
            } else {
                resolve(response.result);
            }
        };

        chrome.runtime.sendMessage(KASM_EXTENSION_ID, message, onResponse);
    });
};

const PUSH_PORT_NAME = "kasm-fido2-events";
const PUSH_RECONNECT_MS = 5000;

// Exported for tests: opens the extension's event port and calls onEvent for
// each push. Reconnects (e.g. extension restarted or not yet installed) until
// the returned stop() is called.
export const subscribeExtensionEvents = (onEvent, { connect = (name) => chrome.runtime.connect(KASM_EXTENSION_ID, { name }), setTimer = setTimeout, clearTimer = clearTimeout } = {}) => {
    let stopped = false;
    let port = null;
    let timer = null;

    const open = () => {
        if (stopped) return;
        try {
            port = connect(PUSH_PORT_NAME);
        } catch (err) {
            Log.Debug(`fido2: extension push port unavailable: ${err.message}`);
            schedule();
            return;
        }
        port.onMessage.addListener((message) => {
            if (message && message.type === "push") onEvent(message);
        });
        port.onDisconnect.addListener(() => {
            port = null;
            schedule();
        });
    };

    const schedule = () => {
        if (stopped || timer !== null) return;
        timer = setTimer(() => {
            timer = null;
            open();
        }, PUSH_RECONNECT_MS);
    };

    open();

    return () => {
        stopped = true;
        if (timer !== null) clearTimer(timer);
        if (port) {
            try { port.disconnect(); } catch (err) { /* already gone */ }
        }
    };
};

export { createRelayPacket, parseRelayPacket, RELAY_PUSH };

export default (rfb) => {
    Log.Debug("fido2.initializeFido2Relay");

    // Relay packets carry no request id, so a cancel targets the ceremony in flight.
    let activeCompletionId = null;

    const cancelActive = () => {
        if (!activeCompletionId) return;
        callExtension("ctap_cancel", { targetCompletionId: activeCompletionId }).catch((err) => {
            Log.Error(`fido2: ctap_cancel failed: ${err.message}`);
        });
    };

    const sendFido2Response = (deviceId, tag, session, command, payload = new Uint8Array(0)) => {
        Log.Debug(
            `fido2.response: device[${deviceId}] tag=${tag} command=${commandToString(command)}, payloadLen=${payload.length}`
        );
        const packet = createRelayPacket(command, deviceId, tag, session, payload);
        rfb.sendUnixRelayData("fido2", packet);
    };

    // The native PIN dialog outlives this session, and the relay may already be
    // gone, so cancel through the extension directly.
    rfb.addEventListener("disconnect", cancelActive);

    // Forwards extension push events (e.g. a security key being plugged in) to
    // the container as an unsolicited relay packet. Same extension-presence
    // behavior as the request path: if the extension isn't there, nothing is sent.
    const stopPushSubscription = subscribeExtensionEvents((event) => {
        const { type, ...body } = event;
        const packet = createRelayPacket(RELAY_PUSH, 0, 0, 0, encodeJson(body));
        rfb.sendUnixRelayData("fido2", packet);
    });
    rfb.addEventListener("disconnect", stopPushSubscription);

    rfb.subscribeUnixRelay("fido2", async (data) => {
        let command, deviceId, tag, session, payload;
        try {
            ({ command, deviceId, tag, session, payload } = parseRelayPacket(data));
        } catch (err) {
            Log.Error(`fido2: failed to parse relay packet: ${err.message}`);
            return;
        }

        Log.Debug(
            `fido2.request: device[${deviceId}] tag=${tag} command=${commandToString(command)}, payloadLen=${payload.length}`
        );

        if (command === REQUEST_CANCEL) {
            cancelActive();
            return;
        }

        const completionId = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
        try {
            let result;
            switch (command) {
                case REQUEST_LIST_DEVICES:
                    result = await callExtension("ctap_list_devices", undefined, completionId, session);
                    break;

                case REQUEST_MAKE_CREDENTIAL:
                    activeCompletionId = completionId;
                    result = await callExtension("ctap_make_credential", decodeJson(payload), completionId, session);
                    break;

                case REQUEST_GET_ASSERTION:
                    activeCompletionId = completionId;
                    result = await callExtension("ctap_get_assertion", decodeJson(payload), completionId, session);
                    break;

                default:
                    throw new Error(`unknown_command: 0x${command.toString(16)}`);
            }

            sendFido2Response(deviceId, tag, session, RESPONSE_ACK, encodeJson(result));
        } catch (error) {
            Log.Error(`fido2: device[${deviceId}]: ${error.message}`);
            sendFido2Response(deviceId, tag, session, RESPONSE_ERROR, new TextEncoder().encode(error.message));
        } finally {
            if (activeCompletionId === completionId) activeCompletionId = null;
        }
    });
};