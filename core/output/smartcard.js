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

// smartcard relay packets
const REQUEST_STATUS = 0x01;
const REQUEST_POWER_ON = 0x02;
const REQUEST_POWER_OFF = 0x03;
const REQUEST_RESET = 0x04;
const REQUEST_TRANSMIT = 0x05;
const REQUEST_INITIALIZE = 0x06;
const RESPONSE_ACK = 0x80;
const RESPONSE_ERROR = 0x81;

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

const createRelayPacket = (command, payload = new Uint8Array(0)) => {
  if (command !== RESPONSE_ACK && command !== RESPONSE_ERROR) {
    throw new Error("invalid_relay_response");
  }

  const packet = new Uint8Array(3 + payload.length);
  packet[0] = command;
  packet[1] = (payload.length >> 8) & 0xff;
  packet[2] = payload.length & 0xff;
  packet.set(payload, 3);
  return packet;
};

const parseRelayPacket = (data) => {
  if (data.length < 3) {
    throw new Error("invalid_relay_packet");
  }

  const command = data[0];
  const payloadLength = (data[1] << 8) | data[2];
  
  if (data.length < 3 + payloadLength) {
    throw new Error("invalid_relay_packet");
  }

  return {
    command,
    payload: data.slice(3, 3 + payloadLength),
  };
};

const KASM_SMARTCARD_EXTENSION_ID = "cjkohjfgidilbllbjkdhpoeonjanpomo";

// Used whenever the server does not provide (valid) extension IDs.
const DEFAULT_EXTENSION_IDS = [KASM_SMARTCARD_EXTENSION_ID];

class SmartcardSession {
  constructor(getExtensionIds = () => DEFAULT_EXTENSION_IDS) {
    this.getExtensionIds = getExtensionIds;
    this.activeExtensionId = null;
    this.context = null;
    this.cardAtr = null;
    this.cardHandle = null;
    this.activeProtocol = null;
    this.lastTransmitAt = null;
    this.lastRefreshAt = null;
  }

  async refresh() {
    // skip check if we have refreshed recently
    if (this.lastRefreshAt && Date.now() - this.lastRefreshAt < 1000) {
      return;
    }

    // skip check if we have sent data recently
    if (this.lastTransmitAt && Date.now() - this.lastTransmitAt < 1000) {
      return;
    }

    // query state
    let refreshContext = null;

    try {
      refreshContext = await this._establishContext();

      this.readers = await this._listReaders(refreshContext);
      if (this.readers.length == 0) {
        throw new Error("no_readers");
      }

      this.cardAtr = await this._getStatusChange(refreshContext, this.readers[0]).then(({ atr }) => atr);
    } catch (error) {
      this.context = null;
      this.readers = [];
      this.cardAtr = null;
      this.cardHandle = null;
      this.activeProtocol = null;
    }

    // update web ui
    const smartcardStatus = {
      isExtensionEnabled: !!refreshContext,
      isReaderConnected: this.readers.length > 0,
      isCardPresent: !!this.cardAtr,
    };

    if (WebUtil.isInsideKasmVDI()) {
      window.parent.postMessage({
        action: "smartcard_status",
        value: smartcardStatus,
      }, "*");
    }

    Log.Debug(`smartcard.refresh: ${JSON.stringify(smartcardStatus, null, 2)}`);

    // clean up
    this.lastRefreshAt = Date.now();

    if (refreshContext) {
      await this._releaseContext(refreshContext);
    }
  }

  async powerOn() {
    this.context = this.context || (await this._establishContext());

    if (!this.cardHandle || !this.activeProtocol) {
      const { cardHandle, activeProtocol } = await this._connect(this.context, this.readers[0]);
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
    const deviceId = "smartcard-relay";
    const completionId = Date.now().toString() + Math.random().toString(36);

    const message = {
      deviceId,
      completionId,
      type: name,
      args: args.join(","),
    };

    // Read the IDs per call so a server config that arrives late still applies.
    const extensionIds = this.getExtensionIds();

    // Prefer the extension that answered last time, then the configured order.
    // The last responder is retried first on purpose, even ahead of the configured order.
    const candidates = this.activeExtensionId && extensionIds.includes(this.activeExtensionId)
      ? [this.activeExtensionId, ...extensionIds.filter((id) => id !== this.activeExtensionId)]
      : extensionIds;

    let lastError = null;

    for (const extensionId of candidates) {
      try {
        const result = await this._sendToExtension(extensionId, message);
        this.activeExtensionId = extensionId;
        return result;
      } catch (error) {
        // Only an unreachable extension moves on to the next ID; an error
        // reported by a reachable extension is final.
        if (!error.unreachable) {
          this.activeExtensionId = extensionId;
          throw error;
        }
        lastError = error;
      }
    }

    this.activeExtensionId = null;
    throw lastError || new Error("no_extension_ids");
  }

  _sendToExtension(extensionId, message) {
    return new Promise((resolve, reject) => {
      const onResponse = (response) => {
        if (chrome.runtime.lastError) {
          const error = new Error(chrome.runtime.lastError.message);
          error.unreachable = true;
          reject(error);
          return;
        }

        if (response.status === "error" || response.result[0] !== "0x00000000") {
          reject(new Error(response.result[0] || "0x80100001"));
        } else {
          resolve(response.result);
        }
      };

      try {
        chrome.runtime.sendMessage(extensionId, message, onResponse);
      } catch (error) {
        // Chrome refused the ID outright (e.g. malformed): treat it like an unreachable one.
        const failure = new Error(error.message);
        failure.unreachable = true;
        reject(failure);
      }
    });
  }
}

export default async (rfb, getServerExtensionIds = () => null) => {
  Log.Debug("smartcard.initializeSmartcardRelay");

  // Server IDs replace the default when present; otherwise the built-in ID is used.
  const getExtensionIds = () => {
    const serverIds = getServerExtensionIds();
    return Array.isArray(serverIds) && serverIds.length > 0 ? serverIds : DEFAULT_EXTENSION_IDS;
  };
  Log.Debug(`smartcard extension IDs: ${getExtensionIds().join(", ")}`);

  const sendSmartcardResponse = (command, payload = new Uint8Array(0)) => {
    Log.Debug(`smartcard.response: command=${commandToString(command)}, payloadLen=${payload.length}`);
    const packet = createRelayPacket(command, payload);
    rfb.sendUnixRelayData("smartcard", packet);
  };

  const clientSession = new SmartcardSession(getExtensionIds);
  await clientSession.refresh();

  rfb.subscribeUnixRelay("smartcard", async (data) => {
    try {
      const { command, payload } = parseRelayPacket(data);
      Log.Debug(`smartcard.request: command=${commandToString(command)}, payloadLen=${payload.length}`);

      switch (command) {
        case REQUEST_INITIALIZE:
          sendSmartcardResponse(RESPONSE_ACK);
          break;

        case REQUEST_STATUS:
          await clientSession.refresh();
          sendSmartcardResponse(RESPONSE_ACK, clientSession.cardAtr ? fromHex(clientSession.cardAtr) : new Uint8Array(0));
          break;

        case REQUEST_POWER_ON:
          await clientSession.powerOn();
          sendSmartcardResponse(RESPONSE_ACK);
          break;

        case REQUEST_POWER_OFF:
          await clientSession.powerOff();
          sendSmartcardResponse(RESPONSE_ACK);
          break;

        case REQUEST_RESET:
          sendSmartcardResponse(RESPONSE_ACK);
          break;

        case REQUEST_TRANSMIT:
          await clientSession.powerOn();
          const response = await clientSession.transmit(payload);
          sendSmartcardResponse(RESPONSE_ACK, response);
          break;

        default:
          throw new Error(`Unknown binary command: 0x${command.toString(16)}`);
      }
    } catch (error) {
      Log.Error(`Failed to process command: ${error.message}`);
      sendSmartcardResponse(RESPONSE_ERROR, new TextEncoder().encode(error.message));
    }
  });
};
