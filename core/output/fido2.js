import * as Log from "../../core/util/logging.js";
import { callExtension } from "./kasm_extension.js";
import { getPassthroughStatusMonitor } from "./passthrough_status.js";

const REQUEST_MAKE_CREDENTIAL = 0x01;
const REQUEST_GET_ASSERTION = 0x02;
const REQUEST_LIST_DEVICES = 0x03;
const RESPONSE_ACK = 0x80;
const RESPONSE_ERROR = 0x81;

const PROTOCOL_VERSION_V1 = 0x10;

const commandToString = (command) => {
    return {
        [REQUEST_MAKE_CREDENTIAL]: "REQUEST_MAKE_CREDENTIAL",
        [REQUEST_GET_ASSERTION]: "REQUEST_GET_ASSERTION",
        [REQUEST_LIST_DEVICES]: "REQUEST_LIST_DEVICES",
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

const callFido2Extension = (type, params) => {
    return callExtension(type, params === undefined ? "" : JSON.stringify(params), {
        deviceId: "fido2-relay",
        defaultError: "fido2_request_failed",
    });
};

export default (rfb) => {
    Log.Debug("fido2.initializeFido2Relay");

    const sendFido2Response = (deviceId, command, payload = new Uint8Array(0)) => {
        Log.Debug(
            `fido2.response: device[${deviceId}] command=${commandToString(command)}, payloadLen=${payload.length}`
        );
        const packet = createRelayPacket(command, deviceId, payload);
        rfb.sendUnixRelayData("fido2", packet);
    };

    const statusMonitor = getPassthroughStatusMonitor(rfb);

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

        // Ceremonies can wait for a PIN or touch, so status probes stay out of their way.
        const isCeremony = command === REQUEST_MAKE_CREDENTIAL || command === REQUEST_GET_ASSERTION;
        if (isCeremony) {
            statusMonitor.beginActivity();
        }
        let failed = false;

        try {
            let result;
            switch (command) {
                case REQUEST_LIST_DEVICES:
                    result = await callFido2Extension("ctap_list_devices");
                    break;

                case REQUEST_MAKE_CREDENTIAL:
                    result = await callFido2Extension("ctap_make_credential", decodeJson(payload));
                    break;

                case REQUEST_GET_ASSERTION:
                    result = await callFido2Extension("ctap_get_assertion", decodeJson(payload));
                    break;

                default:
                    throw new Error(`unknown_command: 0x${command.toString(16)}`);
            }

            sendFido2Response(deviceId, RESPONSE_ACK, encodeJson(result));
        } catch (error) {
            failed = true;
            Log.Error(`fido2: device[${deviceId}]: ${error.message}`);
            sendFido2Response(deviceId, RESPONSE_ERROR, new TextEncoder().encode(error.message));
        } finally {
            if (isCeremony) {
                statusMonitor.endActivity(failed);
            }
        }
    });

    statusMonitor.start();
};