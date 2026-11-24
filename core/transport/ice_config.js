/*
 * KasmVNC: HTML5 VNC client
 * Copyright (C) 2026 Kasm Technologies Corp.
 * Licensed under MPL 2.0 (see LICENSE.txt)
 */

import * as Log from '../util/logging.js';

export const DEFAULT_ICE_CONFIG = Object.freeze({ iceServers: [], iceTransportPolicy: 'all' });

// Normalization matches the chrome-cdp extension so both backends accept the same server configuration.
function normalizeIceServers(servers) {
    if (!Array.isArray(servers)) {
        return [];
    }
    return servers
        .map((server) => {
            if (typeof server === 'string') {
                return { urls: server };
            }
            if (Array.isArray(server?.urls)) {
                const urls = server.urls.filter(url => typeof url === 'string' && url.length > 0);
                return urls.length > 0 ? { ...server, urls } : null;
            }
            if (typeof server?.urls === 'string' && server.urls.length > 0) {
                return server;
            }
            return null;
        })
        .filter(Boolean);
}

function normalizeTurnServers(servers) {
    return normalizeIceServers(servers)
        .map((server) => {
            const urls = Array.isArray(server.urls) ? server.urls : [server.urls];
            const turnUrls = urls.filter(url => /^(turn|turns):/i.test(url));
            if (turnUrls.length === 0) {
                return null;
            }
            return { ...server, urls: Array.isArray(server.urls) ? turnUrls : turnUrls[0] };
        })
        .filter(Boolean);
}

export function parseIceConfig(payload) {
    let parsed;
    try {
        parsed = JSON.parse(payload || '{}');
    } catch (e) {
        Log.Warn('Ignoring malformed WebRTC ICE configuration');
        return DEFAULT_ICE_CONFIG;
    }
    if (parsed === null || typeof parsed !== 'object') {
        return DEFAULT_ICE_CONFIG;
    }
    const iceTransportPolicy = parsed.iceTransportPolicy === 'relay' ? 'relay' : 'all';
    const iceServers = iceTransportPolicy === 'relay'
        ? normalizeTurnServers(parsed.iceServers)
        : normalizeIceServers(parsed.iceServers);
    return { iceServers, iceTransportPolicy };
}
