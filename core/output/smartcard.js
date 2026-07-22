import * as Log from "../../core/util/logging.js";
import * as WebUtil from "../../app/webutil.js";

// utilities
const toHex = (data) => {
  return Array.from(data)
    .map((b) => b.toString(16).padStart(2, "0").toUpperCase())
    .join("")
    .replace(/ /g, "");
};

const fromHex = (data = "") => {
  if (data.length === 0) return new Uint8Array(0);
  if (!/^[0-9a-fA-F]*$/.test(data)) throw new Error(`invalid_hex_string: ${data}`);
  return new Uint8Array(data.match(/.{1,2}/g).map((b) => parseInt(b, 16)));
};

// smartcard relay packet constants
const REQUEST_STATUS = 0x01;
const REQUEST_POWER_ON = 0x02;
const REQUEST_POWER_OFF = 0x03;
const REQUEST_RESET = 0x04;
const REQUEST_TRANSMIT = 0x05;
const REQUEST_INITIALIZE = 0x06;
const RESPONSE_ACK = 0x80;
const RESPONSE_ERROR = 0x81;

// Protocol version marker — outside the command/response byte range (0x01-0x06, 0x80-0x81)
// so v1 packets are unambiguously distinguishable from v0 legacy packets.
// v1 layout: [0x10][command (1)][reader_id (1)][U32 length (4)][payload]
// v0 layout: [command (1)][U16 length (2)][payload]  (reader_id=0 implied)
const PROTOCOL_VERSION_V1 = 0x10;

const MAX_READER_LANES = 8;

const commandToString = (command) => {
  return {
    [REQUEST_STATUS]: "REQUEST_STATUS",
    [REQUEST_POWER_ON]: "REQUEST_POWER_ON",
    [REQUEST_POWER_OFF]: "REQUEST_POWER_OFF",
    [REQUEST_RESET]: "REQUEST_RESET",
    [REQUEST_TRANSMIT]: "REQUEST_TRANSMIT",
    [REQUEST_INITIALIZE]: "REQUEST_INITIALIZE",
    [RESPONSE_ACK]: "RESPONSE_ACK",
    [RESPONSE_ERROR]: "RESPONSE_ERROR",
  }[command] || `0x${command.toString(16).toUpperCase()}`;
};

// createRelayPacket: smartcard.js only sends responses (RESPONSE_ACK / RESPONSE_ERROR).
const createRelayPacket = (command, readerId, payload = new Uint8Array(0)) => {
  if (command !== RESPONSE_ACK && command !== RESPONSE_ERROR) {
    throw new Error("invalid_relay_response");
  }
  const packet = new Uint8Array(7 + payload.length);
  packet[0] = PROTOCOL_VERSION_V1;
  packet[1] = command;
  packet[2] = readerId;
  const len = payload.length;
  packet[3] = (len >>> 24) & 0xff;
  packet[4] = (len >>> 16) & 0xff;
  packet[5] = (len >>> 8) & 0xff;
  packet[6] = len & 0xff;
  packet.set(payload, 7);
  return packet;
};

// parseRelayPacket: the bridge (or a legacy client) sends requests.
// Returns { command, readerId, payload }.
const parseRelayPacket = (data) => {
  if (!data || data.length < 1) {
    throw new Error("relay_packet_empty");
  }

  if (data[0] === PROTOCOL_VERSION_V1) {
    // v1: [0x10][command][reader_id][U32 length][payload]
    if (data.length < 7) {
      throw new Error("relay_packet_v1_too_short");
    }
    const command = data[1];
    const readerId = data[2];
    const payloadLength = ((data[3] << 24) | (data[4] << 16) | (data[5] << 8) | data[6]) >>> 0;
    if (data.length < 7 + payloadLength) {
      throw new Error("relay_packet_v1_incomplete");
    }
    return { command, readerId, payload: data.slice(7, 7 + payloadLength) };
  }

  // v0 legacy: [command][U16 length][payload], reader_id=0 implied
  if (data.length < 3) {
    throw new Error("relay_packet_v0_too_short");
  }
  const command = data[0];
  const payloadLength = (data[1] << 8) | data[2];
  if (data.length < 3 + payloadLength) {
    throw new Error("relay_packet_v0_incomplete");
  }
  return { command, readerId: 0, payload: data.slice(3, 3 + payloadLength) };
};

const KASM_SMARTCARD_EXTENSION_ID = "cjkohjfgidilbllbjkdhpoeonjanpomo";

// SmartcardSession is bound to one specific reader name.
// readerId is the lane index (0..N-1) used for self-healing reader discovery.
// readerName=null means the lane is empty; refresh() will attempt discovery.
class SmartcardSession {
  constructor(readerName, readerId = 0) {
    this.readerName = readerName;
    this.readerId = readerId;
    this.context = null;
    this.cardAtr = null;
    this.cardHandle = null;
    this.activeProtocol = null;
    this.lastTransmitAt = null;
    this.lastRefreshAt = null;
  }

  async refresh() {
    // skip if recently refreshed or mid-transmit
    if (this.lastRefreshAt && Date.now() - this.lastRefreshAt < 1000) {
      return;
    }
    if (this.lastTransmitAt && Date.now() - this.lastTransmitAt < 1000) {
      return;
    }

    let refreshContext = null;

    try {
      refreshContext = await this._establishContext();

      // If no reader is bound yet (initializeSessions ran too early), try to bind now.
      if (!this.readerName) {
        const readers = await this._listReaders(refreshContext);
        if (readers.length > this.readerId) {
          this.readerName = readers[this.readerId];
          Log.Info(`smartcard: reader[${this.readerId}] late-bound to "${this.readerName}"`);
        }
      }

      if (this.readerName) {
        this.cardAtr = await this._getStatusChange(refreshContext, this.readerName)
          .then(({ atr }) => atr);
      } else {
        this.cardAtr = null;
      }
    } catch (error) {
      // A failed status query (bad context, unknown-reader name, native host
      // down, macOS SCARD_STATE_EMPTY quirk) must not look identical to a
      // genuinely empty reader — log it so "no card" can be told apart from
      // "status query failed".
      Log.Warn(
        `smartcard: reader[${this.readerId}] "${this.readerName || "(unbound)"}" ` +
        `status refresh failed: ${error.message}`
      );
      this.context = null;
      this.cardAtr = null;
      this.cardHandle = null;
      this.activeProtocol = null;
    }

    this.lastRefreshAt = Date.now();

    if (refreshContext) {
      await this._releaseContext(refreshContext).catch(() => {});
    }
  }

  async powerOn() {
    if (!this.readerName) throw new Error("no_reader_bound");
    this.context = this.context || (await this._establishContext());

    if (!this.cardHandle || !this.activeProtocol) {
      const { cardHandle, activeProtocol } = await this._connect(this.context, this.readerName);
      this.cardHandle = cardHandle;
      this.activeProtocol = activeProtocol;
    }
  }

  async powerOff() {
    if (this.context && this.cardHandle) {
      await this._disconnect(this.context, this.cardHandle);
      await this._releaseContext(this.context);
    }

    this.context = null;
    this.cardHandle = null;
    this.cardAtr = null;
    this.activeProtocol = null;
  }

  async transmit(apdu) {
    try {
      await this._beginTransaction();
    } catch (error) {}

    try {
      this.lastTransmitAt = Date.now();
      return await this._transmit(apdu);
    } catch (error) {
      this.lastTransmitAt = null;
      throw error;
    } finally {
      await this._endTransaction();
    }
  }

  async _establishContext() {
    return await this._callExtension("establish_context", 0).then(([status, context]) => context);
  }

  async _releaseContext(context) {
    return await this._callExtension("release_context", context).then(([status]) => status);
  }

  async _listReaders(context) {
    return await this._callExtension("list_readers", context).then(([status, readers]) => {
      return Array.isArray(readers) ? readers : readers.split(",").filter(Boolean);
    });
  }

  async _getStatusChange(context, reader) {
    return await this._callExtension("get_status_change", context, 0, 1, 0, 0, reader).then(
      ([status, readerCount, currentState, eventState, atr]) => ({
        status,
        readerCount,
        currentState,
        eventState,
        atr,
      })
    );
  }

  async _connect(context, reader) {
    return await this._callExtension("connect", context, 2, 3, reader).then(
      ([status, cardContext, cardHandle, activeProtocol]) => ({
        cardHandle,
        activeProtocol,
      })
    );
  }

  async _disconnect(context, cardHandle) {
    return await this._callExtension("disconnect", context, cardHandle, 0).then(([status]) => status);
  }

  async _beginTransaction() {
    return await this._callExtension("begin_transaction", this.context, this.cardHandle).then(([status]) => status);
  }

  async _transmit(apdu) {
    return await this._callExtension("transmit", this.context, this.cardHandle, this.activeProtocol, toHex(apdu)).then(
      ([status, context, card, protocol, response]) => fromHex(response)
    );
  }

  async _endTransaction(disposition = 0) {
    return await this._callExtension("end_transaction", this.context, this.cardHandle, disposition).then(
      ([status]) => status
    );
  }

  async _callExtension(name, ...args) {
    return new Promise((resolve, reject) => {
      const deviceId = "smartcard-relay";
      const completionId = Date.now().toString() + Math.random().toString(36);

      const message = {
        deviceId,
        completionId,
        type: name,
        args: args.join(","),
      };

      const onResponse = (response) => {
        if (chrome.runtime.lastError) {
          reject(new Error(chrome.runtime.lastError.message));
          return;
        }

        if (response.status === "error" || response.result[0] !== "0x00000000") {
          reject(new Error(response.result[0] || "0x80100001"));
        } else {
          resolve(response.result);
        }
      };

      chrome.runtime.sendMessage(KASM_SMARTCARD_EXTENSION_ID, message, onResponse);
    });
  }
}

// Discover the current reader list and build a session Map:
// lane i → the i-th reader from list_readers, capped at MAX_READER_LANES.
// Empty lanes (no reader bound) are left out of the map; lane 0 always exists for compat.
const initializeSessions = async () => {
  const sessions = new Map();
  const probe = new SmartcardSession(null);
  let readers = [];

  try {
    const ctx = await probe._establishContext();
    try {
      readers = await probe._listReaders(ctx);
    } finally {
      await probe._releaseContext(ctx).catch(() => {});
    }
  } catch (err) {
    Log.Warn(`smartcard: reader discovery failed: ${err.message}`);
  }

  const numLanes = Math.min(readers.length, MAX_READER_LANES);
  for (let i = 0; i < numLanes; i++) {
    const session = new SmartcardSession(readers[i], i);
    sessions.set(i, session);
    await session.refresh().catch(() => {});
  }

  // Always provide lane 0 for backward compat with v0 (legacy single-reader) bridges.
  // readerId is set so refresh() can late-bind the reader if discovery failed at startup.
  if (!sessions.has(0)) {
    sessions.set(0, new SmartcardSession(null, 0));
  }

  Log.Info(`smartcard: initialized ${numLanes} reader lane(s): [${readers.join(", ")}]`);
  return sessions;
};

// Aggregate per-session state into a postMessage payload for the parent frame.
// Keeps legacy top-level fields (isExtensionEnabled, isReaderConnected, isCardPresent)
// for backward compat with kasmweb ControlPanel.js, and adds a `readers` array.
const broadcastStatus = (sessions) => {
  const readers = [];
  for (const [readerId, session] of sessions) {
    readers.push({
      readerId,
      readerName: session.readerName || null,
      isCardPresent: !!session.cardAtr,
    });
  }

  const status = {
    isExtensionEnabled: readers.some((r) => !!r.readerName),
    isReaderConnected: readers.some((r) => !!r.readerName),
    isCardPresent: readers.some((r) => r.isCardPresent),
    readers,
  };

  if (WebUtil.isInsideKasmVDI()) {
    window.parent.postMessage({ action: "smartcard_status", value: status }, "*");
  }

  Log.Debug(`smartcard.status: ${JSON.stringify(status, null, 2)}`);
};

export default async (rfb) => {
  Log.Debug("smartcard.initializeSmartcardRelay");

  const sessions = await initializeSessions();

  const sendSmartcardResponse = (readerId, command, payload = new Uint8Array(0)) => {
    Log.Debug(
      `smartcard.response: reader[${readerId}] command=${commandToString(command)}, payloadLen=${payload.length}`
    );
    const packet = createRelayPacket(command, readerId, payload);
    rfb.sendUnixRelayData("smartcard", packet);
  };

  rfb.subscribeUnixRelay("smartcard", async (data) => {
    let command, readerId, payload;
    try {
      ({ command, readerId, payload } = parseRelayPacket(data));
    } catch (err) {
      Log.Error(`smartcard: failed to parse relay packet: ${err.message}`);
      return;
    }

    Log.Debug(
      `smartcard.request: reader[${readerId}] command=${commandToString(command)}, payloadLen=${payload.length}`
    );

    let session = sessions.get(readerId);
    if (!session) {
      // Lane not yet initialized — create a placeholder; refresh() will late-bind the reader.
      session = new SmartcardSession(null, readerId);
      sessions.set(readerId, session);
    }

    try {
      switch (command) {
        case REQUEST_INITIALIZE: {
          // Reply with the bound reader list so the bridge can size its active
          // lane count off real discovery instead of falling back to a static
          // --readers value. Payload format must match bridge.py's
          // parse_reader_list: repeated [name_len (1 byte)][name (UTF-8)],
          // ordered by readerId — entry i binds to lane i.
          const encoder = new TextEncoder();
          const chunks = [];
          let i = 0;
          while (sessions.has(i)) {
            const boundName = sessions.get(i).readerName;
            if (boundName) {
              const nameBytes = encoder.encode(boundName);
              chunks.push(new Uint8Array([nameBytes.length]), nameBytes);
            }
            i++;
          }
          const totalLength = chunks.reduce((sum, c) => sum + c.length, 0);
          const listPayload = new Uint8Array(totalLength);
          let offset = 0;
          for (const chunk of chunks) {
            listPayload.set(chunk, offset);
            offset += chunk.length;
          }
          sendSmartcardResponse(readerId, RESPONSE_ACK, listPayload);
          break;
        }

        case REQUEST_STATUS:
          await session.refresh();
          sendSmartcardResponse(
            readerId,
            RESPONSE_ACK,
            session.cardAtr ? fromHex(session.cardAtr) : new Uint8Array(0)
          );
          broadcastStatus(sessions);
          break;

        case REQUEST_POWER_ON:
          await session.powerOn();
          sendSmartcardResponse(readerId, RESPONSE_ACK);
          break;

        case REQUEST_POWER_OFF:
          await session.powerOff();
          sendSmartcardResponse(readerId, RESPONSE_ACK);
          break;

        case REQUEST_RESET:
          sendSmartcardResponse(readerId, RESPONSE_ACK);
          break;

        case REQUEST_TRANSMIT: {
          await session.powerOn();
          const response = await session.transmit(payload);
          sendSmartcardResponse(readerId, RESPONSE_ACK, response);
          break;
        }

        default:
          throw new Error(`unknown_command: 0x${command.toString(16)}`);
      }
    } catch (error) {
      Log.Error(`smartcard: reader[${readerId}]: ${error.message}`);
      sendSmartcardResponse(readerId, RESPONSE_ERROR, new TextEncoder().encode(error.message));
    }
  });
};
