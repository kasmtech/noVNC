import * as Log from "../../core/util/logging.js";

const EVENT_DATA = 0x01;   // one complete raw SSH-agent-protocol frame (bidirectional)
const EVENT_CLOSE = 0x02;  // tear down this connection (bidirectional)
const EVENT_ERROR = 0x03;  // client's local agent is unreachable (client -> guest only)

const PROTOCOL_VERSION_V1 = 0x10;

const eventToString = (event) => {
    return {
        [EVENT_DATA]: "EVENT_DATA",
        [EVENT_CLOSE]: "EVENT_CLOSE",
        [EVENT_ERROR]: "EVENT_ERROR",
    }[event] || `0x${event.toString(16).toUpperCase()}`;
};

const createRelayPacket = (connectionId, event, payload = new Uint8Array(0)) => {
    const packet = new Uint8Array(10 + payload.length);
    packet[0] = PROTOCOL_VERSION_V1;
    packet[1] = (connectionId >>> 24) & 0xff;
    packet[2] = (connectionId >>> 16) & 0xff;
    packet[3] = (connectionId >>> 8) & 0xff;
    packet[4] = connectionId & 0xff;
    packet[5] = event;
    const len = payload.length;
    packet[6] = (len >>> 24) & 0xff;
    packet[7] = (len >>> 16) & 0xff;
    packet[8] = (len >>> 8) & 0xff;
    packet[9] = len & 0xff;
    packet.set(payload, 10);
    return packet;
};

const parseRelayPacket = (data) => {
    if (!data || data.length < 10 || data[0] !== PROTOCOL_VERSION_V1) {
        throw new Error("relay_packet_invalid");
    }
    const connectionId = ((data[1] << 24) | (data[2] << 16) | (data[3] << 8) | data[4]) >>> 0;
    const event = data[5];
    const payloadLength = ((data[6] << 24) | (data[7] << 16) | (data[8] << 8) | data[9]) >>> 0;
    if (data.length < 10 + payloadLength) {
        throw new Error("relay_packet_incomplete");
    }
    return { connectionId, event, payload: data.slice(10, 10 + payloadLength) };
};

const bufferToBase64 = (bytes) => {
    let binary = "";
    for (const byte of bytes) binary += String.fromCharCode(byte);
    return btoa(binary);
};

const base64ToBuffer = (b64) => {
    if (!b64) return new Uint8Array(0);
    const binary = atob(b64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    return bytes;
};

const KASM_SSH_AGENT_EXTENSION_ID = "obhhhhhfhnmfoonndahjcjpkndkeompc";

const callExtension = (connectionId, event, payload) => {
    return new Promise((resolve, reject) => {
        const message = {
            deviceId: "ssh-agent-relay",
            completionId: Date.now().toString() + Math.random().toString(36),
            type: "ssh_agent_forward",
            args: JSON.stringify({
                connectionId,
                event: event === EVENT_CLOSE ? "close" : "data",
                payload: bufferToBase64(payload),
            }),
        };

        const onResponse = (response) => {
            if (chrome.runtime.lastError) {
                reject(new Error(chrome.runtime.lastError.message));
                return;
            }

            if (!response || response.status === "error") {
                const detail = response && Array.isArray(response.result) ? response.result.join(" | ") : "ssh_agent_request_failed";
                reject(new Error(detail));
            } else {
                resolve(response.result);
            }
        };

        chrome.runtime.sendMessage(KASM_SSH_AGENT_EXTENSION_ID, message, onResponse);
    });
};

export default (rfb) => {
    Log.Debug("ssh_agent.initializeSshAgentRelay");

    const sendSshAgentEvent = (connectionId, event, payload = new Uint8Array(0)) => {
        Log.Debug(
            `ssh_agent.response: connection[${connectionId}] event=${eventToString(event)}, payloadLen=${payload.length}`
        );
        const packet = createRelayPacket(connectionId, event, payload);
        rfb.sendUnixRelayData("ssh_agent", packet);
    };

    rfb.subscribeUnixRelay("ssh_agent", async (data) => {
        let connectionId, event, payload;
        try {
            ({ connectionId, event, payload } = parseRelayPacket(data));
        } catch (err) {
            Log.Error(`ssh_agent: failed to parse relay packet: ${err.message}`);
            return;
        }

        Log.Debug(
            `ssh_agent.request: connection[${connectionId}] event=${eventToString(event)}, payloadLen=${payload.length}`
        );

        if (event === EVENT_ERROR) {
            // Only the client sends EVENT_ERROR; nothing to forward.
            return;
        }

        try {
            if (event === EVENT_CLOSE) {
                await callExtension(connectionId, EVENT_CLOSE, payload);
                return;
            }

            const responseB64 = await callExtension(connectionId, EVENT_DATA, payload);
            sendSshAgentEvent(connectionId, EVENT_DATA, base64ToBuffer(responseB64));
        } catch (error) {
            Log.Error(`ssh_agent: connection[${connectionId}]: ${error.message}`);
            sendSshAgentEvent(connectionId, EVENT_ERROR, new TextEncoder().encode(error.message));
        }
    });
};
