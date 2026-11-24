/**
 * port-relay-worker.js — SharedWorker that hands off a direct MessageChannel
 * between the primary display and a secondary display window.
 *
 * Protocol:
 *   Primary   --> worker: { type: 'primary_ready',   screenID: <uuid> }
 *   Secondary --> worker: { type: 'secondary_ready', screenID: <uuid> }
 *
 *   Worker --> primary:   { type: 'port', screenID: <uuid>, port: MessagePort }
 *   Worker --> secondary: { type: 'port', port: MessagePort }
 *
 */

const rooms = new Map(); // screenID --> { primaryPort?, secondaryPort? }

self.onconnect = function (e) {
    const port = e.ports[0];
    port.start();

    port.onmessage = function (ev) {
        const {type, screenID} = ev.data;
        if (screenID === undefined || screenID === '')
            return;

        if (!rooms.has(screenID))
            rooms.set(screenID, {});

        const room = rooms.get(screenID);

        if (type === 'primary_ready') {
            room.primaryPort = port;
        } else if (type === 'secondary_ready') {
            room.secondaryPort = port;
        } else {
            return;
        }

        if (room.primaryPort && room.secondaryPort) {
            const {port1, port2} = new MessageChannel();
            room.primaryPort.postMessage({type: 'port', screenID, port: port1}, [port1]);
            room.secondaryPort.postMessage({type: 'port', port: port2}, [port2]);
            rooms.delete(screenID);
        }
    };
};
