/*
 * KasmVNC: iOS software keyboard activation for native touch mode.
 * Licensed under MPL 2.0 (see LICENSE.txt)
 */

import * as Log from '../util/logging.js';

const TAP_SLOP = 15;
const CLICK_WINDOW_MS = 1000;

export default class IOSKeyboard {
    constructor(canvas, input, { toRemote, enabled }) {
        this._canvas = canvas;
        this._input = input;
        this._toRemote = toRemote;
        this._enabled = enabled;

        this._focused = false;
        this._field = null;         // Cached field rect, consumed by the next touchstart
        this._lastTap = null;       // Touch id of the last stationary tap
        this._tapStart = null;      // Current single contact
        this._candidate = null;     // Current contact that started inside _field
        this._pendingClick = null;  // Released candidate waiting for its click
        this._allowClick = false;
        this._mouseUntil = 0;

        this._onDocumentTouch = (ev) => {
            if (ev.target !== this._canvas) this.reset();
        };
    }

    attach() {
        document.addEventListener('touchstart', this._onDocumentTouch, true);
    }

    detach() {
        document.removeEventListener('touchstart', this._onDocumentTouch, true);
        this.reset();
        this._mouseUntil = 0;
    }

    reset() {
        this._field = null;
        this._lastTap = null;
        this._tapStart = null;
        this._candidate = null;
        this._pendingClick = null;
        this._allowClick = false;
    }

    get ownsMouse() {
        return Date.now() < this._mouseUntil;
    }

    handleTouch(ev) {
        switch (ev.type) {
            case 'touchstart': this._touchStart(ev); break;
            case 'touchmove': this._touchMove(ev); break;
            case 'touchend': this._touchEnd(ev); break;
            default: this.reset(); break;
        }

        const allow = this._allowClick;
        if (allow) this._mouseUntil = Date.now() + CLICK_WINDOW_MS;
        if (ev.type === 'touchend' || ev.type === 'touchcancel') this._allowClick = false;
        return allow;
    }

    handleMouse(ev) {
        if (!this.ownsMouse) return false;
        ev.preventDefault();
        ev.stopPropagation();
        if (ev.type === 'click') this._click(ev);
        return true;
    }

    textInputFocus(focused, tapped, touchId, field) {
        this._focused = focused;
        if (tapped) {
            const matches = this._lastTap !== null && touchId === this._lastTap;
            this._field = focused && matches && field.w > 0 && field.h > 0 ? { ...field } : null;
            Log.Debug("iOS keyboard: verdict for touch " + touchId +
                      (matches ? "" : " (not the last tap)") + ", cached field=" +
                      (this._field ? field.w + "x" + field.h + "+" + field.x + "+" + field.y : "none"));
        }
        if (!focused) {
            this._pendingClick = null;
            this._candidate = null;
        }
    }

    _touchStart(ev) {
        const field = this._field;
        this.reset();

        if (ev.touches.length !== 1 || ev.changedTouches.length !== 1) return;

        const touch = ev.changedTouches[0];
        this._tapStart = this._point(touch);

        if (field === null || !this._inside(touch, field)) return;

        this._candidate = { ...this._point(touch), field };
        this._allowClick = this._enabled() && this._focused;
        Log.Debug("iOS keyboard: tap inside the cached field, allowClick=" + this._allowClick);
    }

    _touchMove(ev) {
        const start = this._tapStart;
        const touch = start && findTouch(ev.touches, start.identifier);
        if (ev.touches.length !== 1 || !touch || !near(touch, start)) {
            this._tapStart = null;
        }

        const candidate = this._candidate;
        if (candidate === null) return;
        const moved = findTouch(ev.touches, candidate.identifier);
        if (ev.touches.length !== 1 || !moved || !this._stillOn(moved, candidate)) {
            this._candidate = null;
            this._allowClick = false;
        }
    }

    _touchEnd(ev) {
        const start = this._tapStart;
        const ended = start && findTouch(ev.changedTouches, start.identifier);
        const stationary = ended && ev.touches.length === 0 && near(ended, start);
        this._tapStart = null;
        // The server's tapped verdict for this touch id feeds the next tap.
        this._lastTap = stationary ? ended.identifier >>> 0 : null;

        const candidate = this._candidate;
        this._candidate = null;
        if (candidate === null) return;
        const touch = findTouch(ev.changedTouches, candidate.identifier);
        if (ev.touches.length === 0 && touch && this._stillOn(touch, candidate)) {
            this._pendingClick = { ...this._point(touch), field: candidate.field, at: Date.now() };
        } else {
            this._allowClick = false;
        }
    }

    _click(ev) {
        const tap = this._pendingClick;
        this._pendingClick = null;
        if (!tap) return;
        if (!ev.isTrusted || ev.target !== this._canvas ||
            Date.now() - tap.at > CLICK_WINDOW_MS ||
            !near(ev, tap) || !this._inside(ev, tap.field)) {
            Log.Debug("iOS keyboard: click rejected");
            return;
        }
        this._open(ev.pageX, ev.pageY);
    }

    _open(x, y) {
        if (!this._enabled() || !this._input || document.activeElement === this._input) {
            Log.Debug("iOS keyboard: not opening");
            return;
        }
        Log.Debug("iOS keyboard: opening");
        this._input.style.left = `${x}px`;
        this._input.style.top = `${y}px`;
        this._input.focus();
    }

    _point(touch) {
        return { identifier: touch.identifier, clientX: touch.clientX, clientY: touch.clientY };
    }

    _stillOn(touch, candidate) {
        return near(touch, candidate) && this._inside(touch, candidate.field);
    }

    _inside(point, rect) {
        const { x, y } = this._toRemote(point.clientX, point.clientY);
        return x >= rect.x && x < rect.x + rect.w &&
               y >= rect.y && y < rect.y + rect.h;
    }
}

function findTouch(touches, identifier) {
    for (let i = 0; i < touches.length; i++) {
        if (touches[i].identifier === identifier) return touches[i];
    }
    return null;
}

function near(a, b) {
    return Math.abs(a.clientX - b.clientX) <= TAP_SLOP &&
           Math.abs(a.clientY - b.clientY) <= TAP_SLOP;
}
