import * as Log from "../../core/util/logging.js";

// fido2 relay packet constants.
// Unlike smartcard.js, the payload here is a UTF-8 JSON blob carrying a
// structured WebAuthn-level request/response (rpId, clientDataHash, etc.),
// not raw APDU bytes - see smart-card-cpp-native-client's ctap_functions.cpp
// for why (libfido2 handles CTAP2 PIN/UV token derivation, so the client
// never has to speak raw CTAPHID frames itself).
const REQUEST_MAKE_CREDENTIAL = 0x01;
const REQUEST_GET_ASSERTION = 0x02;
const REQUEST_LIST_DEVICES = 0x03;
const RESPONSE_ACK = 0x80;
const RESPONSE_ERROR = 0x81;
// Sent the moment a request arrives, before the extension is asked anything.
// Tells the container bridge a viewer that can answer is subscribed; without
// it the bridge reports the relay unavailable and the page falls back to the
// browser's own WebAuthn.
const RESPONSE_PENDING = 0x82;

// v2 header, shared with virtual-smartcard-bridge's fido2_bridge.py:
// [0x11][command (1)][device_id (1)][U32 request_id (4)][U32 length (4)][payload]
// Every reply echoes the request's request_id. Xvnc hands relay replies to
// whichever bridge process sent most recently, so the bridge uses the id to
// drop a late answer that was meant for an earlier request.
const PROTOCOL_VERSION_V2 = 0x11;
const HEADER_LENGTH = 11;

const commandToString = (command) => {
    return {
        [REQUEST_MAKE_CREDENTIAL]: "REQUEST_MAKE_CREDENTIAL",
        [REQUEST_GET_ASSERTION]: "REQUEST_GET_ASSERTION",
        [REQUEST_LIST_DEVICES]: "REQUEST_LIST_DEVICES",
        [RESPONSE_ACK]: "RESPONSE_ACK",
        [RESPONSE_ERROR]: "RESPONSE_ERROR",
        [RESPONSE_PENDING]: "RESPONSE_PENDING",
    }[command] || `0x${command.toString(16).toUpperCase()}`;
};

const writeU32 = (packet, offset, value) => {
    packet[offset] = (value >>> 24) & 0xff;
    packet[offset + 1] = (value >>> 16) & 0xff;
    packet[offset + 2] = (value >>> 8) & 0xff;
    packet[offset + 3] = value & 0xff;
};

const readU32 = (data, offset) =>
    ((data[offset] << 24) | (data[offset + 1] << 16) | (data[offset + 2] << 8) | data[offset + 3]) >>> 0;

// createRelayPacket: fido2.js only sends responses.
const createRelayPacket = (command, deviceId, requestId, payload = new Uint8Array(0)) => {
    if (command !== RESPONSE_ACK && command !== RESPONSE_ERROR && command !== RESPONSE_PENDING) {
        throw new Error("invalid_relay_response");
    }
    const packet = new Uint8Array(HEADER_LENGTH + payload.length);
    packet[0] = PROTOCOL_VERSION_V2;
    packet[1] = command;
    packet[2] = deviceId;
    writeU32(packet, 3, requestId);
    writeU32(packet, 7, payload.length);
    packet.set(payload, HEADER_LENGTH);
    return packet;
};

// parseRelayPacket: the container-side fido2 bridge sends requests.
const parseRelayPacket = (data) => {
    if (!data || data.length < HEADER_LENGTH || data[0] !== PROTOCOL_VERSION_V2) {
        throw new Error("relay_packet_invalid");
    }
    const command = data[1];
    const deviceId = data[2];
    const requestId = readU32(data, 3);
    const payloadLength = readU32(data, 7);
    if (data.length < HEADER_LENGTH + payloadLength) {
        throw new Error("relay_packet_incomplete");
    }
    return { command, deviceId, requestId, payload: data.slice(HEADER_LENGTH, HEADER_LENGTH + payloadLength) };
};

const encodeJson = (value) => new TextEncoder().encode(JSON.stringify(value ?? {}));
const decodeJson = (payload) => (payload.length === 0 ? {} : JSON.parse(new TextDecoder().decode(payload)));

const KASM_FIDO2_EXTENSION_ID = "cjkohjfgidilbllbjkdhpoeonjanpomo";

// FIDO2 requests currently waiting on the extension. A request can sit in a
// PIN dialog or wait for a touch on the client for minutes; when the session
// ends nobody can answer it, so the dialog is torn down instead (see below).
let inFlight = 0;

// Asks the extension to cancel every FIDO2 request this page has in flight.
// The extension only cancels requests made by this same document.
const cancelInFlight = (reason) => {
    if (inFlight === 0) {
        return;
    }
    Log.Info(`fido2: cancelling ${inFlight} in-flight request(s) (${reason})`);
    try {
        chrome.runtime.sendMessage(
            KASM_FIDO2_EXTENSION_ID,
            { deviceId: "fido2-relay", completionId: Date.now().toString() + Math.random().toString(36), type: "ctap_cancel", args: "" },
            () => void chrome.runtime.lastError // read to silence "unchecked lastError"; older extensions reject the type
        );
    } catch (err) {
        Log.Warn(`fido2: cancel failed: ${err.message}`);
    }
};

let pageHideHooked = false;
const hookedRfbs = new WeakSet();

const callExtension = (type, params) => {
    return new Promise((resolve, reject) => {
        const message = {
            deviceId: "fido2-relay",
            completionId: Date.now().toString() + Math.random().toString(36),
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

        inFlight++;
        chrome.runtime.sendMessage(KASM_FIDO2_EXTENSION_ID, message, (response) => {
            inFlight--;
            onResponse(response);
        });
    });
};

export default (rfb) => {
    Log.Debug("fido2.initializeFido2Relay");

    // Called on every (re)connect of the same RFB, so hook each target once.
    if (!hookedRfbs.has(rfb)) {
        hookedRfbs.add(rfb);
        rfb.addEventListener("disconnect", () => cancelInFlight("session disconnected"));
    }
    if (!pageHideHooked) {
        pageHideHooked = true;
        window.addEventListener("pagehide", () => cancelInFlight("page unloading"));
    }

    const sendFido2Response = (deviceId, requestId, command, payload = new Uint8Array(0)) => {
        Log.Debug(
            `fido2.response: device[${deviceId}] request=${requestId.toString(16)} command=${commandToString(command)}, payloadLen=${payload.length}`
        );
        const packet = createRelayPacket(command, deviceId, requestId, payload);
        rfb.sendUnixRelayData("fido2", packet);
    };

    rfb.subscribeUnixRelay("fido2", async (data) => {
        let command, deviceId, requestId, payload;
        try {
            ({ command, deviceId, requestId, payload } = parseRelayPacket(data));
        } catch (err) {
            Log.Error(`fido2: failed to parse relay packet: ${err.message}`);
            return;
        }

        Log.Debug(
            `fido2.request: device[${deviceId}] request=${requestId.toString(16)} command=${commandToString(command)}, payloadLen=${payload.length}`
        );

        // Confirm receipt first: the extension call below can sit in a PIN
        // dialog for minutes.
        sendFido2Response(deviceId, requestId, RESPONSE_PENDING);

        try {
            let result;
            switch (command) {
                case REQUEST_LIST_DEVICES:
                    result = await callExtension("ctap_list_devices");
                    break;

                case REQUEST_MAKE_CREDENTIAL:
                    result = await callExtension("ctap_make_credential", decodeJson(payload));
                    break;

                case REQUEST_GET_ASSERTION:
                    result = await callExtension("ctap_get_assertion", decodeJson(payload));
                    break;

                default:
                    throw new Error(`unknown_command: 0x${command.toString(16)}`);
            }

            sendFido2Response(deviceId, requestId, RESPONSE_ACK, encodeJson(result));
        } catch (error) {
            Log.Error(`fido2: device[${deviceId}]: ${error.message}`);
            sendFido2Response(deviceId, requestId, RESPONSE_ERROR, new TextEncoder().encode(error.message));
        }
    });
};