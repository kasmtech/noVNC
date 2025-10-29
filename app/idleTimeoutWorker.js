"use strict";

let lastActiveAt = Date.now();
let idleDisconnectInS = 1200;
let checkIntervalMs = 5000;
let monitorTimer = null;
let idleTimeoutFired = false;

function stopTimer() {
    if (monitorTimer !== null) {
        clearInterval(monitorTimer);
        monitorTimer = null;
    }
}

function startTimer() {
    if (monitorTimer === null) {
        monitorTimer = setInterval(checkIdleState, checkIntervalMs);
    }
}

function checkIdleState() {
    if (idleTimeoutFired) {
        return;
    }

    const now = Date.now();
    const idleSeconds = (now - lastActiveAt) / 1000;

    if (idleSeconds >= idleDisconnectInS) {
        idleTimeoutFired = true;
        self.postMessage({
            type: "idle-timeout",
            idleSeconds,
            idleDisconnectInS
        });
        stopTimer();
        return;
    }

    self.postMessage({
        type: "keep-alive",
        idleSeconds,
        idleDisconnectInS
    });
}

function handleConfigure(data) {
    if (Number.isFinite(data.idleDisconnectInS) && data.idleDisconnectInS > 0) {
        idleDisconnectInS = data.idleDisconnectInS;
    }

    if (Number.isFinite(data.checkIntervalMs) && data.checkIntervalMs > 0) {
        checkIntervalMs = data.checkIntervalMs;
    }

    if (Number.isFinite(data.lastActiveAt) && data.lastActiveAt > 0) {
        lastActiveAt = data.lastActiveAt;
    }

    idleTimeoutFired = false;
    stopTimer();
    startTimer();
}

function handleActivity(data) {
    if (Number.isFinite(data.timestamp) && data.timestamp > 0) {
        lastActiveAt = data.timestamp;
    } else {
        lastActiveAt = Date.now();
    }

    idleTimeoutFired = false;
}

self.onmessage = function(event) {
    const data = event.data || {};

    switch (data.type) {
        case "configure":
            handleConfigure(data);
            break;
        case "activity":
            handleActivity(data);
            break;
        case "stop":
            idleTimeoutFired = false;
            stopTimer();
            break;
        default:
            break;
    }
};
