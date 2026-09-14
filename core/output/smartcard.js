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
const REQUEST_DISCOVER = 0x06;
const RESPONSE_ACK = 0x80;
const RESPONSE_ERROR = 0x81;

<<<<<<< Updated upstream
// Protocol version marker, checked so a mismatched/garbled peer is rejected
// rather than silently misparsed.
// layout: [0x10][command (1)][reader_id (1)][U32 length (4)][payload]
const PROTOCOL_VERSION_V1 = 0x10;

const MAX_READER_LANES = 8;

// Reserved reader_id the bridge uses for REQUEST_INITIALIZE discovery traffic —
// must match bridge.py's DISCOVERY_READER_ID. Kept off every real lane id so a
// discovery request/response can never be mistaken for a lane's own ATR/status
// traffic, and so discovery works even while lane 0 is serving a card.
=======
// Protocol version marker,
// layout: [0x10][command (1)][reader_id (1)][request_tag (1)][U32 length (4)][payload]
const PROTOCOL_VERSION_V1 = 0x10;
const V1_HEADER_LENGTH = 8;

// Must match DEFAULT_MAX_LANES in bridge.py (virtual-smartcard-bridge repo).
const MAX_READER_LANES = 8;

// Reserved reader_id the bridge uses for REQUEST_DISCOVER discovery traffic —
// must match bridge.py's DISCOVERY_READER_ID.
>>>>>>> Stashed changes
const DISCOVERY_READER_ID = 0xff;

const commandToString = (command) => {
  return {
    [REQUEST_STATUS]: "REQUEST_STATUS",
    [REQUEST_POWER_ON]: "REQUEST_POWER_ON",
    [REQUEST_POWER_OFF]: "REQUEST_POWER_OFF",
    [REQUEST_RESET]: "REQUEST_RESET",
    [REQUEST_TRANSMIT]: "REQUEST_TRANSMIT",
    [REQUEST_DISCOVER]: "REQUEST_DISCOVER",
    [RESPONSE_ACK]: "RESPONSE_ACK",
    [RESPONSE_ERROR]: "RESPONSE_ERROR",
  }[command] || `0x${command.toString(16).toUpperCase()}`;
};

<<<<<<< Updated upstream
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
=======
const createRelayPacket = (command, readerId, requestTag, payload = new Uint8Array(0)) => {
  if (command !== RESPONSE_ACK && command !== RESPONSE_ERROR) {
    throw new Error("invalid_relay_response");
  }
  const packet = new Uint8Array(V1_HEADER_LENGTH + payload.length);
  packet[0] = PROTOCOL_VERSION_V1;
  packet[1] = command;
  packet[2] = readerId;
  packet[3] = requestTag;
  const len = payload.length;
  packet[4] = (len >>> 24) & 0xff;
  packet[5] = (len >>> 16) & 0xff;
  packet[6] = (len >>> 8) & 0xff;
  packet[7] = len & 0xff;
  packet.set(payload, V1_HEADER_LENGTH);
>>>>>>> Stashed changes
  return packet;
};

// parseRelayPacket: the bridge sends requests. Returns { command, readerId, payload }.
const parseRelayPacket = (data) => {
<<<<<<< Updated upstream
  if (!data || data.length < 7) {
=======
  if (!data || data.length < V1_HEADER_LENGTH) {
>>>>>>> Stashed changes
    throw new Error("relay_packet_too_short");
  }
  if (data[0] !== PROTOCOL_VERSION_V1) {
    throw new Error(`relay_packet_unknown_version: 0x${data[0].toString(16)}`);
<<<<<<< Updated upstream
  }
  const command = data[1];
  const readerId = data[2];
  const payloadLength = ((data[3] << 24) | (data[4] << 16) | (data[5] << 8) | data[6]) >>> 0;
  if (data.length < 7 + payloadLength) {
    throw new Error("relay_packet_incomplete");
  }
  return { command, readerId, payload: data.slice(7, 7 + payloadLength) };
=======
  }
  const command = data[1];
  const readerId = data[2];
  const requestTag = data[3];
  const payloadLength = ((data[4] << 24) | (data[5] << 16) | (data[6] << 8) | data[7]) >>> 0;
  if (data.length < V1_HEADER_LENGTH + payloadLength) {
    throw new Error("relay_packet_incomplete");
  }
  return {
    command,
    readerId,
    requestTag,
    payload: data.slice(V1_HEADER_LENGTH, V1_HEADER_LENGTH + payloadLength),
  };
>>>>>>> Stashed changes
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
<<<<<<< Updated upstream
    // Injected by registerSession() so the positional late-bind in refresh() can
    // see what the other lanes already hold. Defaults to "no peers" for a probe
    // session that isn't in any map.
=======
>>>>>>> Stashed changes
    this.getPeerSessions = () => [];
  }

  isReaderNameBoundElsewhere(readerName) {
    return this.getPeerSessions().some((s) => s !== this && s.readerName === readerName);
  }

  async refresh() {
<<<<<<< Updated upstream
    // skip if recently refreshed or mid-transmit
=======
>>>>>>> Stashed changes
    if (this.lastRefreshAt && Date.now() - this.lastRefreshAt < 1000) {
      return;
    }
    if (this.lastTransmitAt && Date.now() - this.lastTransmitAt < 1000) {
      return;
    }

    let refreshContext = null;

    try {
      refreshContext = await this._establishContext();

<<<<<<< Updated upstream
      // If no reader is bound yet (initializeSessions ran too early), try to bind
      // now. This is a POSITIONAL guess (readers[readerId]), so it must not claim a
      // name that reconcileSessions has already bound to another lane: after a
      // reader is unplugged, lane 0 is unbound while readers[0] is now the reader
      // living on lane 1, and binding it here would leave one physical reader
      // bound to two lanes — the bridge would then activate two vpcd lanes for one
      // card and interleave transactions against it.
=======
>>>>>>> Stashed changes
      if (!this.readerName) {
        const readers = await this._listReaders(refreshContext);
        const candidate = readers.length > this.readerId ? readers[this.readerId] : null;
        if (candidate && this.isReaderNameBoundElsewhere(candidate)) {
          Log.Debug(
            `smartcard: reader[${this.readerId}] skipping late-bind to "${candidate}" ` +
            "(already bound to another lane)"
          );
        } else if (candidate) {
          this.readerName = candidate;
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
<<<<<<< Updated upstream
      // A failed status query (bad context, unknown-reader name, native host
      // down, macOS SCARD_STATE_EMPTY quirk) must not look identical to a
      // genuinely empty reader — log it so "no card" can be told apart from
      // "status query failed".
=======
>>>>>>> Stashed changes
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
<<<<<<< Updated upstream
    // The local handle/context fields MUST be cleared even if the PC/SC calls
    // fail — which they routinely do once the reader is physically gone
    // (_disconnect rejects with SCARD_E_* ). Leaving cardHandle set makes a later
    // powerOn() skip _connect entirely ("already connected"), so every subsequent
    // transmit on this session goes to a dead handle and fails.
=======
>>>>>>> Stashed changes
    try {
      if (this.context && this.cardHandle) {
        await this._disconnect(this.context, this.cardHandle);
        await this._releaseContext(this.context);
      }
    } finally {
      this.context = null;
      this.cardHandle = null;
      this.cardAtr = null;
      this.activeProtocol = null;
    }
  }

  async transmit(apdu) {
    const context = this.context;
    const cardHandle = this.cardHandle;
    const activeProtocol = this.activeProtocol;
    if (!context || !cardHandle) {
      throw new Error("no_card_handle");
    }

    try {
      await this._beginTransaction(context, cardHandle);
    } catch (error) {}

    try {
      this.lastTransmitAt = Date.now();
      return await this._transmit(context, cardHandle, activeProtocol, apdu);
    } catch (error) {
      this.lastTransmitAt = null;
      throw error;
    } finally {
      await this._endTransaction(context, cardHandle);
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

  async _beginTransaction(context, cardHandle) {
    return await this._callExtension("begin_transaction", context, cardHandle).then(([status]) => status);
  }

  async _transmit(context, cardHandle, activeProtocol, apdu) {
    return await this._callExtension("transmit", context, cardHandle, activeProtocol, toHex(apdu)).then(
      ([status, context, card, protocol, response]) => fromHex(response)
    );
  }

  async _endTransaction(context, cardHandle, disposition = 0) {
    return await this._callExtension("end_transaction", context, cardHandle, disposition).then(
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

<<<<<<< Updated upstream
// Whether the smartcard Chrome extension + native host are reachable, independent of
// whether any reader is attached. ControlPanel.js renders this as its own
// "Smartcard Chrome Extension: Enabled/Disabled" row, separate from the reader and
// card rows, so it must NOT be conflated with reader presence: a working extension
// with no reader plugged in has to read Enabled + Reader Disconnected, otherwise the
// user is sent off troubleshooting the extension instead of plugging in a reader.
=======
>>>>>>> Stashed changes
let extensionResponsive = false;

const isPcscStatusError = (error) => /^0x[0-9a-f]{8}$/i.test((error && error.message) || "");

const SCARD_E_NO_READERS_AVAILABLE = "0x8010002e";

const isNoReadersError = (error) =>
  (((error && error.message) || "").toLowerCase() === SCARD_E_NO_READERS_AVAILABLE);

<<<<<<< Updated upstream
// Add a session to the lane map, wiring up the peer lookup its late-bind guard
// needs. All session inserts must go through this.
=======
>>>>>>> Stashed changes
const registerSession = (sessions, laneId, session) => {
  session.getPeerSessions = () => Array.from(sessions.values());
  sessions.set(laneId, session);
  return session;
};

const enumerateReaders = async () => {
  const probe = new SmartcardSession(null);
  let ctx;
  try {
    ctx = await probe._establishContext();
  } catch (error) {
<<<<<<< Updated upstream
    // Couldn't even get a context: extension unreachable, unless the native host
    // answered with a PC/SC status code (in which case it's alive and something
    // else is wrong).
=======
>>>>>>> Stashed changes
    extensionResponsive = isPcscStatusError(error);
    throw error;
  }
  extensionResponsive = true;
  try {
    return await probe._listReaders(ctx);
  } catch (error) {
<<<<<<< Updated upstream
    // "No readers attached" arrives as a PC/SC error rather than an empty list, so
    // treat it as the empty list it logically is. Without this, unplugging the LAST
    // reader makes enumeration throw, reconcileSessions() never runs, the stale
    // binding is kept, and the bridge holds a phantom active lane while ControlPanel
    // shows "Reader: Connected" with nothing attached.
    //
    // Deliberately handled HERE and not in the native host's
    // handle_smartcard_list_readers: that function is shared with the RDP path, where
    // guac_server forwards the result to guacd WITHOUT checking status, so returning
    // success+empty there would make redirected SCardListReaders stop reporting
    // SCARD_E_NO_READERS_AVAILABLE to the RDP client.
=======
>>>>>>> Stashed changes
    if (isNoReadersError(error)) {
      Log.Debug("smartcard: no readers attached, treating as empty reader list");
      return [];
    }
    throw error;
  } finally {
    await probe._releaseContext(ctx).catch(() => {});
  }
};

const initializeSessions = async () => {
  const sessions = new Map();
  let readers = [];

  try {
    readers = await enumerateReaders();
  } catch (err) {
    Log.Warn(`smartcard: reader discovery failed: ${err.message}`);
  }

  const numLanes = Math.min(readers.length, MAX_READER_LANES);
  for (let i = 0; i < numLanes; i++) {
    const session = registerSession(sessions, i, new SmartcardSession(readers[i], i));
    await session.refresh().catch(() => {});
  }

  // Always provide lane 0: a bridge may address lane 0 before discovery has bound
  // any reader to it. readerId is set so refresh() can late-bind the reader if
  // discovery failed at startup.
  if (!sessions.has(0)) {
    registerSession(sessions, 0, new SmartcardSession(null, 0));
  }

  Log.Info(`smartcard: initialized ${numLanes} reader lane(s): [${readers.join(", ")}]`);
  return sessions;
};

<<<<<<< Updated upstream
// Reconcile the session map against a freshly enumerated reader-name list
// (positional, no ids — PC/SC's list_readers has no native id concept). A
// bound session whose reader disappeared is unbound (never renumbered away —
// a live card session keeps its lane even if this poll's list omits it only
// transiently is NOT handled here; the caller decides whether to call this at
// all on enumeration failure). A newly seen name takes the lowest lane with no
// session or an unbound session, so the lane-0 compat placeholder never blocks
// a real reader from claiming lane 0.
=======
>>>>>>> Stashed changes
const reconcileSessions = (sessions, readerNames) => {
  const nameSet = new Set(readerNames);

  for (const [laneId, session] of sessions) {
    if (session.readerName && !nameSet.has(session.readerName)) {
      Log.Info(`smartcard: reader[${laneId}] "${session.readerName}" no longer present, unbinding`);
<<<<<<< Updated upstream
      // Clear the card/context state SYNCHRONOUSLY here rather than relying on the
      // in-flight powerOff(): this lane may be rebound to a different reader later
      // in this same pass, and a powerOff() promise resolving after that would null
      // out a cardHandle the new binding had already established.
=======
>>>>>>> Stashed changes
      const staleContext = session.context;
      const staleHandle = session.cardHandle;
      session.readerName = null;
      session.cardAtr = null;
      session.context = null;
      session.cardHandle = null;
      session.activeProtocol = null;

      if (staleContext && staleHandle) {
        session._disconnect(staleContext, staleHandle)
          .catch(() => {})
          .then(() => session._releaseContext(staleContext).catch(() => {}));
      }
    }
  }

  const boundNames = new Set(
    Array.from(sessions.values()).map((s) => s.readerName).filter(Boolean)
  );

  for (const name of readerNames) {
    if (boundNames.has(name)) continue; // already bound to some lane

    let freeLaneId = null;
    for (let i = 0; i < MAX_READER_LANES; i++) {
      const existing = sessions.get(i);
      if (!existing || !existing.readerName) {
        freeLaneId = i;
        break;
      }
    }
    if (freeLaneId === null) {
      Log.Warn(`smartcard: reader "${name}" discovered but all ${MAX_READER_LANES} lanes are bound; ignoring`);
      continue;
    }

    let session = sessions.get(freeLaneId);
    if (session) {
      session.readerName = name;
    } else {
      session = registerSession(sessions, freeLaneId, new SmartcardSession(name, freeLaneId));
    }
    boundNames.add(name);
    Log.Info(`smartcard: reader[${freeLaneId}] bound to "${name}"`);
  }
};

<<<<<<< Updated upstream
// Encode the session map's bound reader names for a REQUEST_INITIALIZE reply.
// Wire format must match bridge.py's parse_reader_list: repeated
// [reader_id (1 byte)][name_len (1 byte)][name (UTF-8)], one entry per bound
// lane. reader_id is explicit (rather than inferred from list position) so a
// gap in the lane map never truncates or misattributes an entry.
=======
>>>>>>> Stashed changes
const encodeReaderList = (sessions) => {
  const encoder = new TextEncoder();
  const chunks = [];
  for (const [laneId, laneSession] of sessions) {
    const boundName = laneSession.readerName;
    if (!boundName) continue;

    const nameBytes = encoder.encode(boundName);
    if (nameBytes.length > 255) {
<<<<<<< Updated upstream
      // name_len is a single byte; a longer name would silently wrap and
      // desync every entry after it, so drop this one instead.
      Log.Warn(
        `smartcard: reader[${laneId}] name too long (${nameBytes.length} bytes) ` +
        "for REQUEST_INITIALIZE encoding, omitting from reader list"
=======
      Log.Warn(
        `smartcard: reader[${laneId}] name too long (${nameBytes.length} bytes) ` +
        "for REQUEST_DISCOVER encoding, omitting from reader list"
>>>>>>> Stashed changes
      );
      continue;
    }
    chunks.push(new Uint8Array([laneId, nameBytes.length]), nameBytes);
  }

  const totalLength = chunks.reduce((sum, c) => sum + c.length, 0);
  const listPayload = new Uint8Array(totalLength);
  let offset = 0;
  for (const chunk of chunks) {
    listPayload.set(chunk, offset);
    offset += chunk.length;
  }
  return listPayload;
};

<<<<<<< Updated upstream
// Aggregate per-session state into a postMessage payload for the parent frame.
// Keeps legacy top-level fields (isExtensionEnabled, isReaderConnected, isCardPresent)
// for backward compat with kasmweb ControlPanel.js, and adds a `readers` array.
=======
>>>>>>> Stashed changes
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
    isExtensionEnabled: extensionResponsive,
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
  broadcastStatus(sessions);

<<<<<<< Updated upstream
  const sendSmartcardResponse = (readerId, command, payload = new Uint8Array(0)) => {
    Log.Debug(
      `smartcard.response: reader[${readerId}] command=${commandToString(command)}, payloadLen=${payload.length}`
    );
    const packet = createRelayPacket(command, readerId, payload);
=======
  const sendSmartcardResponse = (readerId, requestTag, command, payload = new Uint8Array(0)) => {
    Log.Debug(
      `smartcard.response: reader[${readerId}] command=${commandToString(command)}, tag=${requestTag}, payloadLen=${payload.length}`
    );
    const packet = createRelayPacket(command, readerId, requestTag, payload);
>>>>>>> Stashed changes
    rfb.sendUnixRelayData("smartcard", packet);
  };

  rfb.subscribeUnixRelay("smartcard", async (data) => {
<<<<<<< Updated upstream
    let command, readerId, payload;
    try {
      ({ command, readerId, payload } = parseRelayPacket(data));
=======
    let command, readerId, requestTag, payload;
    try {
      ({ command, readerId, requestTag, payload } = parseRelayPacket(data));
>>>>>>> Stashed changes
    } catch (err) {
      Log.Error(`smartcard: failed to parse relay packet: ${err.message}`);
      return;
    }

    Log.Debug(
<<<<<<< Updated upstream
      `smartcard.request: reader[${readerId}] command=${commandToString(command)}, payloadLen=${payload.length}`
    );

    // The discovery lane is not a real reader lane — it never gets a
    // SmartcardSession. Every REQUEST_INITIALIZE re-enumerates PC/SC live
    // (rather than replaying whatever initializeSessions() saw at page load),
    // so hot-plugged/removed readers are picked up on the bridge's next
    // discovery poll without a page reload.
    if (readerId === DISCOVERY_READER_ID) {
      if (command !== REQUEST_INITIALIZE) {
        Log.Error(`smartcard: unexpected command ${commandToString(command)} on discovery lane`);
        sendSmartcardResponse(readerId, RESPONSE_ERROR, new TextEncoder().encode("unsupported_on_discovery_lane"));
=======
      `smartcard.request: reader[${readerId}] command=${commandToString(command)}, tag=${requestTag}, payloadLen=${payload.length}`
    );

    if (readerId === DISCOVERY_READER_ID) {
      if (command !== REQUEST_DISCOVER) {
        Log.Error(`smartcard: unexpected command ${commandToString(command)} on discovery lane`);
        sendSmartcardResponse(readerId, requestTag, RESPONSE_ERROR, new TextEncoder().encode("unsupported_on_discovery_lane"));
>>>>>>> Stashed changes
        return;
      }
      try {
        const readerNames = await enumerateReaders();
        reconcileSessions(sessions, readerNames);
      } catch (error) {
        Log.Warn(`smartcard: discovery enumeration failed, keeping existing bindings: ${error.message}`);
      }
      broadcastStatus(sessions);
<<<<<<< Updated upstream
      sendSmartcardResponse(readerId, RESPONSE_ACK, encodeReaderList(sessions));
=======
      sendSmartcardResponse(readerId, requestTag, RESPONSE_ACK, encodeReaderList(sessions));
>>>>>>> Stashed changes
      return;
    }

    if (readerId >= MAX_READER_LANES) {
      Log.Error(`smartcard: reader[${readerId}] exceeds MAX_READER_LANES (${MAX_READER_LANES}), rejecting`);
<<<<<<< Updated upstream
      sendSmartcardResponse(readerId, RESPONSE_ERROR, new TextEncoder().encode("reader_id_out_of_range"));
=======
      sendSmartcardResponse(readerId, requestTag, RESPONSE_ERROR, new TextEncoder().encode("reader_id_out_of_range"));
>>>>>>> Stashed changes
      return;
    }

    let session = sessions.get(readerId);
    if (!session) {
      // Lane not yet initialized — create a placeholder; refresh() will late-bind the reader.
      session = registerSession(sessions, readerId, new SmartcardSession(null, readerId));
    }

    try {
      switch (command) {
<<<<<<< Updated upstream
        case REQUEST_INITIALIZE:
          // A v1 bridge predating the discovery lane sends INITIALIZE on a real
          // lane. Reply from current bindings without a live re-enumeration.
          // (True v0 bridges never reach here — parseRelayPacket rejects them on
          // the version byte.)
          sendSmartcardResponse(readerId, RESPONSE_ACK, encodeReaderList(sessions));
=======
        case REQUEST_DISCOVER:
          sendSmartcardResponse(readerId, requestTag, RESPONSE_ACK, encodeReaderList(sessions));
>>>>>>> Stashed changes
          break;

        case REQUEST_STATUS:
          await session.refresh();
          sendSmartcardResponse(
            readerId,
<<<<<<< Updated upstream
=======
            requestTag,
>>>>>>> Stashed changes
            RESPONSE_ACK,
            session.cardAtr ? fromHex(session.cardAtr) : new Uint8Array(0)
          );
          broadcastStatus(sessions);
          break;

        case REQUEST_POWER_ON:
          await session.powerOn();
<<<<<<< Updated upstream
          sendSmartcardResponse(readerId, RESPONSE_ACK);
=======
          sendSmartcardResponse(readerId, requestTag, RESPONSE_ACK);
>>>>>>> Stashed changes
          break;

        case REQUEST_POWER_OFF:
          await session.powerOff();
<<<<<<< Updated upstream
          sendSmartcardResponse(readerId, RESPONSE_ACK);
          break;

        case REQUEST_RESET:
          sendSmartcardResponse(readerId, RESPONSE_ACK);
=======
          sendSmartcardResponse(readerId, requestTag, RESPONSE_ACK);
          break;

        case REQUEST_RESET:
          sendSmartcardResponse(readerId, requestTag, RESPONSE_ACK);
>>>>>>> Stashed changes
          break;

        case REQUEST_TRANSMIT: {
          await session.powerOn();
          const response = await session.transmit(payload);
<<<<<<< Updated upstream
          sendSmartcardResponse(readerId, RESPONSE_ACK, response);
=======
          sendSmartcardResponse(readerId, requestTag, RESPONSE_ACK, response);
>>>>>>> Stashed changes
          break;
        }

        default:
          throw new Error(`unknown_command: 0x${command.toString(16)}`);
      }
    } catch (error) {
      Log.Error(`smartcard: reader[${readerId}]: ${error.message}`);
<<<<<<< Updated upstream
      sendSmartcardResponse(readerId, RESPONSE_ERROR, new TextEncoder().encode(error.message));
=======
      sendSmartcardResponse(readerId, requestTag, RESPONSE_ERROR, new TextEncoder().encode(error.message));
>>>>>>> Stashed changes
    }
  });
};
