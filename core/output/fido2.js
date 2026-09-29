import * as Log from "../../core/util/logging.js";
import { KASM_EXTENSION_ID } from "./kasm_extension.js";

const REQUEST_MAKE_CREDENTIAL = 0x01;
const REQUEST_GET_ASSERTION = 0x02;
const REQUEST_LIST_DEVICES = 0x03;
const REQUEST_CANCEL = 0x04;
const RESPONSE_ACK = 0x80;
const RESPONSE_ERROR = 0x81;

const PROTOCOL_VERSION_V1 = 0x10;

const commandToString = (command) => {
    return {
        [REQUEST_MAKE_CREDENTIAL]: "REQUEST_MAKE_CREDENTIAL",
        [REQUEST_GET_ASSERTION]: "REQUEST_GET_ASSERTION",
        [REQUEST_LIST_DEVICES]: "REQUEST_LIST_DEVICES",
        [REQUEST_CANCEL]: "REQUEST_CANCEL",
        [RESPONSE_ACK]: "RESPONSE_ACK",
        [RESPONSE_ERROR]: "RESPONSE_ERROR",
    }[command] || `0x${command.toString(16).toUpperCase()}`;
};

const createRelayPacket = (command, deviceId, payload = new Uint8Array(0)) => {
    if (command !== RESPONSE_ACK && command !== RESPONSE_ERROR) {
        throw new Error("invalid_relay_response");
    }
    const packet = new Uint8Array(7 + payload.length);
    packet[0] = PROTOCOL_VERSION_V1;
    packet[1] = command;
    packet[2] = deviceId;
    const len = payload.length;
    packet[3] = (len >>> 24) & 0xff;
    packet[4] = (len >>> 16) & 0xff;
    packet[5] = (len >>> 8) & 0xff;
    packet[6] = len & 0xff;
    packet.set(payload, 7);
    return packet;
};

const parseRelayPacket = (data) => {
    if (!data || data.length < 7 || data[0] !== PROTOCOL_VERSION_V1) {
        throw new Error("relay_packet_invalid");
    }
    const command = data[1];
    const deviceId = data[2];
    const payloadLength = ((data[3] << 24) | (data[4] << 16) | (data[5] << 8) | data[6]) >>> 0;
    if (data.length < 7 + payloadLength) {
        throw new Error("relay_packet_incomplete");
    }
    return { command, deviceId, payload: data.slice(7, 7 + payloadLength) };
};

const encodeJson = (value) => new TextEncoder().encode(JSON.stringify(value ?? {}));
const decodeJson = (payload) => (payload.length === 0 ? {} : JSON.parse(new TextDecoder().decode(payload)));

const callExtension = (type, params, completionId) => {
    return new Promise((resolve, reject) => {
        const message = {
            deviceId: "fido2-relay",
            completionId: completionId || (Date.now().toString() + Math.random().toString(36)),
            type,
            args: params === undefined ? "" : JSON.stringify(params),
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

    const sendFido2Response = (deviceId, command, payload = new Uint8Array(0)) => {
        Log.Debug(
            `fido2.response: device[${deviceId}] command=${commandToString(command)}, payloadLen=${payload.length}`
        );
        const packet = createRelayPacket(command, deviceId, payload);
        rfb.sendUnixRelayData("fido2", packet);
    };

    // The native PIN dialog outlives this session, and the relay may already be
    // gone, so cancel through the extension directly.
    rfb.addEventListener("disconnect", cancelActive);

    rfb.subscribeUnixRelay("fido2", async (data) => {
        let command, deviceId, payload;
        try {
            ({ command, deviceId, payload } = parseRelayPacket(data));
        } catch (err) {
            Log.Error(`fido2: failed to parse relay packet: ${err.message}`);
            return;
        }

        Log.Debug(
            `fido2.request: device[${deviceId}] command=${commandToString(command)}, payloadLen=${payload.length}`
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
                    result = await callExtension("ctap_list_devices", undefined, completionId);
                    break;

                case REQUEST_MAKE_CREDENTIAL:
                    activeCompletionId = completionId;
                    result = await callExtension("ctap_make_credential", decodeJson(payload), completionId);
                    break;

                case REQUEST_GET_ASSERTION:
                    activeCompletionId = completionId;
                    result = await callExtension("ctap_get_assertion", decodeJson(payload), completionId);
                    break;

                default:
                    throw new Error(`unknown_command: 0x${command.toString(16)}`);
            }

            sendFido2Response(deviceId, RESPONSE_ACK, encodeJson(result));
        } catch (error) {
            Log.Error(`fido2: device[${deviceId}]: ${error.message}`);
            sendFido2Response(deviceId, RESPONSE_ERROR, new TextEncoder().encode(error.message));
        } finally {
            if (activeCompletionId === completionId) activeCompletionId = null;
        }
    });
};