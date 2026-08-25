/*
 * KasmVNC: HTML5 VNC client
 * Copyright (C) 2026 Kasm Technologies
 * Licensed under MPL 2.0 (see LICENSE.txt)
 */

import alt from './images/alt.svg';
import clipboard from './images/clipboard.svg';
import connect from './images/connect.svg';
import ctrl from './images/ctrl.svg';
import ctrlAltDel from './images/ctrlaltdel.svg';
import desktop from './images/desktop-regular.svg';
import disconnect from './images/disconnect.svg';
import drag from './images/drag.svg';
import esc from './images/esc.svg';
import expander from './images/expander.svg';
import fullscreen from './images/fullscreen.svg';
import gamepad from './images/gamepad.png';
import handle from './images/handle.svg';
import handleBackground from './images/handle_bg.svg';
import kasmLogo from './images/icons/kasm_logo.svg';
import keyboard from './images/keyboard.svg';
import power from './images/power.svg';
import settings from './images/settings.svg';
import tab from './images/tab.svg';
import toggleExtraKeys from './images/toggleextrakeys.svg';
import windows from './images/windows.svg';
import packageInfo from '../package.json';

const controlPanelAssets = {
    alt,
    clipboard,
    connect,
    ctrl,
    ctrlAltDel,
    desktop,
    disconnect,
    drag,
    esc,
    fullscreen,
    gamepad,
    kasmLogo,
    keyboard,
    power,
    settings,
    tab,
    toggleExtraKeys,
    windows,
};

function cssUrl(asset) {
    return `url(${JSON.stringify(asset)})`;
}

export function applyControlPanelAssets() {
    document.querySelectorAll('[data-control-panel-src]').forEach((element) => {
        const asset = controlPanelAssets[element.dataset.controlPanelSrc];
        if (asset) {
            element.src = asset;
        }
    });

    const style = document.documentElement.style;
    style.setProperty('--noVNC-control-bar-handle-background', cssUrl(handleBackground));
    style.setProperty('--noVNC-control-bar-handle', cssUrl(handle));
    style.setProperty('--noVNC-control-bar-expander', cssUrl(expander));
    style.setProperty('--noVNC-control-panel-font-family', "'Orbitron', 'OrbitronTTF', sans-serif");

    document.querySelectorAll('.noVNC_version')
        .forEach(element => element.innerText = packageInfo.version);
}

export function applyKeyboardControlAssets() {
    const style = document.documentElement.style;
    style.setProperty('--noVNC-keyboard-control-ctrl', cssUrl(ctrl));
    style.setProperty('--noVNC-keyboard-control-alt', cssUrl(alt));
    style.setProperty('--noVNC-keyboard-control-windows', cssUrl(windows));
    style.setProperty('--noVNC-keyboard-control-tab', cssUrl(tab));
    style.setProperty('--noVNC-keyboard-control-escape', cssUrl(esc));
    style.setProperty('--noVNC-keyboard-control-ctrl-alt-del', cssUrl(ctrlAltDel));
    style.setProperty('--noVNC-keyboard-control-keyboard', cssUrl(keyboard));
}
