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

// Same version-marker convention as smartcard.js's v1 header, so a future
// legacy-less-capable bridge/client pairing can still be told apart:
// [0x10][command (1)][device_id (1)][U32 length (4)][payload]
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

// createRelayPacket: fido2.js only sends responses (RESPONSE_ACK / RESPONSE_ERROR).
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

// parseRelayPacket: the container-side fido2 bridge sends requests.
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

const KASM_FIDO2_EXTENSION_ID = "cjkohjfgidilbllbjkdhpoeonjanpomo";

// Forwards a request to the client's real browser extension
// (kasm-smartcard-extension), which routes ctap_* commands to the native
// host's libfido2-backed CTAP handling. Mirrors smartcard.js's
// SmartcardSession._callExtension, but the payload here is a single
// structured params object rather than positional hex/int args (see
// background.js's isCtapCommand branch in onMessageExternal).
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

    chrome.runtime.sendMessage(KASM_FIDO2_EXTENSION_ID, message, onResponse);
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

      sendFido2Response(deviceId, RESPONSE_ACK, encodeJson(result));
    } catch (error) {
      Log.Error(`fido2: device[${deviceId}]: ${error.message}`);
      sendFido2Response(deviceId, RESPONSE_ERROR, new TextEncoder().encode(error.message));
    }
  });
};
