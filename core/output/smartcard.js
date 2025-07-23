// utilities
const toHex = (data) => {
  return Array.from(data)
    .map((b) => b.toString(16).padStart(2, "0").toUpperCase())
    .join("")
    .replace(/ /g, "");
};

const fromHex = (data) => {
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

class SmartcardSession {
  constructor() {
    this.context = null;
    this.readers = null;
    this.cardAtr = null;
    this.cardHandle = null;
    this.activeProtocol = null;
  }

  async refresh() {
    this.context = await this._establishContext();
    this.readers = await this._listReaders(this.context);

    if (!this.readers || this.readers.length === 0) {
      this.cardAtr = null;
      this.cardHandle = null;
      this.activeProtocol = null;
      return;
    }

    const { atr } = await this._getStatusChange(this.context, this.readers[0]);
    this.cardAtr = atr;
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
    }

    this.cardHandle = null;
    this.cardAtr = null;
    this.activeProtocol = null;
  }

  async transmit(apdu) {
    const response = await this._callExtension(
      "transmit",
      this.context,
      this.cardHandle,
      this.activeProtocol,
      toHex(apdu)
    ).then(([status, context, card, protocol, response]) => response);
    return fromHex(response);
  }

  async _establishContext() {
    return await this._callExtension("establish_context", 0).then(([status, context]) => context);
  }

  async _listReaders(context) {
    return await this._callExtension("list_readers", context).then(([status, readers]) =>
      readers.split(",").filter(Boolean)
    );
  }

  async _getCardAtr(context, reader) {
    return await this._callExtension("get_status_change", context, 0, 1, 0, 0, reader).then(
      ([status, readerCount, currentState, eventState, atr]) => atr
    );
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

export default async (rfb) => {
  console.log("smartcard.initializeSmartcardRelay");

  const sendSmartcardCommand = (command, payload = new Uint8Array(0)) => {
    console.log(`smartcard.sendSmartcardCommand: command=0x${command.toString(16)}, payloadLen=${payload.length}`);
    const packet = createRelayPacket(command, payload);
    rfb.sendUnixRelayData("smartcard", packet);
  };

  const clientSession = new SmartcardSession();

  rfb.subscribeUnixRelay("smartcard", async (data) => {
    try {
      const { command, payload } = parseRelayPacket(data);
      console.log(`smartcard.processBinaryCommand: command=0x${command.toString(16)}, payloadLen=${payload.length}`);
      
      switch (command) {
        case REQUEST_INITIALIZE:
          sendSmartcardCommand(RESPONSE_ACK);
          break;

        case REQUEST_STATUS:
          await clientSession.refresh();
          const atr = clientSession.cardAtr ? fromHex(clientSession.cardAtr) : new Uint8Array(0);
          sendSmartcardCommand(RESPONSE_ACK, atr);
          break;

        case REQUEST_POWER_ON:
          await clientSession.powerOn();
          sendSmartcardCommand(RESPONSE_ACK);
          break;

        case REQUEST_POWER_OFF:
          await clientSession.powerOff();
          sendSmartcardCommand(RESPONSE_ACK);
          break;

        case REQUEST_RESET:
          sendSmartcardCommand(RESPONSE_ACK);
          break;

        case REQUEST_TRANSMIT:
          await clientSession.powerOn();
          const response = await clientSession.transmit(payload);
          sendSmartcardCommand(RESPONSE_ACK, response);
          break;

        default:
          throw new Error(`Unknown binary command: 0x${command.toString(16)}`);
      }
    } catch (error) {
      console.error(`Failed to process command: ${error.message}`);
      sendSmartcardCommand(RESPONSE_ERROR, new TextEncoder().encode(error.message));
    }
  });
};
