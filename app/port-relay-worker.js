/**
 * port-relay-worker.js — SharedWorker that hands off a direct MessageChannel
 * between the primary display and a secondary display window.
 *
 * Protocol:
 *   Primary  → worker: { type: 'primary_ready',   screenIndex: N }
 *   Secondary → worker: { type: 'secondary_ready', screenIndex: N }
 *
 *   Worker → primary:   { type: 'port', screenIndex: N, port: MessagePort }
 *   Worker → secondary: { type: 'port', port: MessagePort }
 *
 * Once both sides have registered for the same screenIndex the worker creates
 * a MessageChannel and transfers one port to each side, then deletes the room
 * entry — it is no longer in the data path after handoff.
 */

const rooms = new Map(); // screenIndex → { primaryPort?, secondaryPort? }

self.onconnect = function (e) {
    const port = e.ports[0];
    port.start();

    port.onmessage = function (ev) {
        const {type, screenIndex} = ev.data;
        if (typeof screenIndex !== 'number')
            return;

        if (!rooms.has(screenIndex))
            rooms.set(screenIndex, {});

        const room = rooms.get(screenIndex);

        if (type === 'primary_ready') {
            room.primaryPort = port;
        } else if (type === 'secondary_ready') {
            room.secondaryPort = port;
        } else {
            return;
        }

        if (room.primaryPort && room.secondaryPort) {
            const {port1, port2} = new MessageChannel();
            room.primaryPort.postMessage({type: 'port', screenIndex, port: port1}, [port1]);
            room.secondaryPort.postMessage({type: 'port', port: port2}, [port2]);
            rooms.delete(screenIndex);
        }
    };
};
