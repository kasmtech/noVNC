/**
 * port-relay-worker.js — SharedWorker that hands off a direct MessageChannel
 * between the primary display and a secondary display window.
 *
 * Protocol:
 *   Primary  --> worker: { type: 'primary_ready',   screenIndex: N }
 *   Secondary --> worker: { type: 'secondary_ready', screenIndex: N }
 *
 *   Worker --> primary:   { type: 'port', screenIndex: N, port: MessagePort }
 *   Worker --> secondary: { type: 'port', port: MessagePort }
 *
 * Once both sides have registered for the same screenIndex the worker creates
 * a MessageChannel and transfers one port to each side, then deletes the room
 * entry — it is no longer in the data path after handoff.
 */

const rooms = new Map(); // screenIndex --> { primaryPort?, secondaryPort? }

self.onconnect = function (e) {
    const port = e.ports[0];
    port.start();

    let currentScreenIndex = null;
    let currentRole = null;
    let isPaired = false; // Set to true once MessageChannel handoff completes

    port.onclose = function () {
        if (currentScreenIndex === null || currentRole === null || isPaired) {
            return;
        }

        const room = rooms.get(currentScreenIndex);
        if (!room) {
            return;
        }

        if (currentRole === 'primary' && room.primaryPort === port) {
            delete room.primaryPort;
            console.debug(`[port-relay-worker] Cleaned up primary port for screenIndex ${currentScreenIndex}`);
        } else if (currentRole === 'secondary' && room.secondaryPort === port) {
            delete room.secondaryPort;
            console.debug(`[port-relay-worker] Cleaned up secondary port for screenIndex ${currentScreenIndex}`);
        }

        if (!room.primaryPort && !room.secondaryPort) {
            rooms.delete(currentScreenIndex);
            console.debug(`[port-relay-worker] Removed empty room for screenIndex ${currentScreenIndex}`);
        }
    };

    port.onmessage = function (ev) {
        const {type, screenIndex} = ev.data;
        if (typeof screenIndex !== 'number') {
            console.warn('[port-relay-worker] Received message with invalid screenIndex:', screenIndex);
            return;
        }

        if (!rooms.has(screenIndex)) {
            rooms.set(screenIndex, {});
        }

        const room = rooms.get(screenIndex);

        if (type === 'primary_ready') {
            if (room.primaryPort && room.primaryPort !== port) {
                console.warn(`[port-relay-worker] Overwriting existing primary port for screenIndex ${screenIndex}. ` +
                    `This may indicate multiple primary windows connecting to the same screen, or a reconnection scenario.`);
            }
            currentScreenIndex = screenIndex;
            currentRole = 'primary';
            room.primaryPort = port;
        } else if (type === 'secondary_ready') {
            // Detect and warn about port replacement (possible misconfiguration)
            if (room.secondaryPort && room.secondaryPort !== port) {
                console.warn(`[port-relay-worker] Overwriting existing secondary port for screenIndex ${screenIndex}. ` +
                    `This may indicate multiple secondary windows connecting to the same screen, or a reconnection scenario.`);
            }
            currentScreenIndex = screenIndex;
            currentRole = 'secondary';
            room.secondaryPort = port;
        } else {
            return;
        }

        if (room.primaryPort && room.secondaryPort) {
            const {port1, port2} = new MessageChannel();

            try {
                room.primaryPort.postMessage({type: 'port', screenIndex, port: port1}, [port1]);
                room.secondaryPort.postMessage({type: 'port', port: port2}, [port2]);
                rooms.delete(screenIndex);

                console.debug(`[port-relay-worker] Successfully paired screenIndex ${screenIndex}`);
            } catch (err) {
                console.error(`[port-relay-worker] Failed to transfer MessageChannel for screenIndex ${screenIndex}:`, err);
                rooms.delete(screenIndex);
            }
        }
    };
};
