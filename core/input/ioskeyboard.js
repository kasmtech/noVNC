/*
 * KasmVNC: iOS software keyboard activation for native touch mode.
 * Licensed under MPL 2.0 (see LICENSE.txt)
 */

import * as Log from '../util/logging.js';

const TAP_SLOP = 15;
const CLICK_WINDOW_MS = 1000;

export default class IOSKeyboard {
    constructor(canvas, input, {toRemote, enabled}) {
        this._canvas = canvas;
        this._input = input;
        this._toRemote = toRemote;
        this._enabled = enabled;

        this._focused = false;
        this._armed = false;        // A prior tap landed in a field; the next tap opens the keyboard
        this._armedField = null;    // The field _armed refers to; arming is per-field
        this._field = null;         // Cached field rect, consumed by the next touchstart
        this._fields = [];          // All text-input rects in the active window (remote coords)
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
            case 'touchstart':
                this._touchStart(ev);
                break;
            case 'touchmove':
                this._touchMove(ev);
                break;
            case 'touchend':
                this._touchEnd(ev);
                break;
            default:
                this.reset();
                break;
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
            this._field = focused && matches && field.w > 0 && field.h > 0 ? {...field} : null;
            if (focused && matches) {
                this._armed = true;
                this._armedField = this._field;
            }
            Log.Debug("iOS keyboard: verdict for touch " + touchId +
                (matches ? "" : " (not the last tap)") + ", cached field=" +
                (this._field ? field.w + "x" + field.h + "+" + field.x + "+" + field.y : "none"));
        }
        if (!focused) {
            this._pendingClick = null;
            this._candidate = null;
            this._armed = false;   // left the field -> next field needs a fresh first tap
            this._armedField = null;
        }
    }

    _sameField(a, b) {
        if (!a || !b) return false;
        if (a.any || b.any) return a.any === true && b.any === true;
        return a.x === b.x && a.y === b.y && a.w === b.w && a.h === b.h;
    }

    textInputFields(fields) {
        this._fields = Array.isArray(fields) ? fields : [];
    }

    _touchStart(ev) {
        const field = this._field;
        this.reset();

        if (ev.touches.length !== 1 || ev.changedTouches.length !== 1) return;

        const touch = ev.changedTouches[0];
        this._tapStart = this._point(touch);

        let hit = null;
        if (field && this._inside(touch, field)) {
            hit = field;
        } else {
            hit = this._fieldAt(touch);
        }

        if (!hit && this._focused && !field && this._fields.length === 0) {
            hit = {any: true};
        }

        if (!hit) {
            this._armed = false;   // tapped away from any field -> require two taps again
            this._armedField = null;
            return;
        }

        if (this._armed && !this._sameField(hit, this._armedField)) {
            this._armed = false;
            this._armedField = null;
        }

        this._candidate = {...this._point(touch), field: hit};
        this._allowClick = this._enabled() && this._armed;
        Log.Debug("iOS keyboard: tap on a field, armed=" + this._armed + " allowClick=" + this._allowClick);
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
            this._pendingClick = {...this._point(touch), field: candidate.field, at: Date.now()};
            this._armed = true;
            this._armedField = candidate.field;
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
        return {identifier: touch.identifier, clientX: touch.clientX, clientY: touch.clientY};
    }

    _stillOn(touch, candidate) {
        return near(touch, candidate) && this._inside(touch, candidate.field);
    }

    _inside(point, rect) {
        if (rect && rect.any)
            return true;

        const {x, y} = this._toRemote(point.clientX, point.clientY);
        return x >= rect.x && x < rect.x + rect.w &&
            y >= rect.y && y < rect.y + rect.h;
    }

    _fieldAt(touch) {
        const {x, y} = this._toRemote(touch.clientX, touch.clientY);
        for (let i = 0; i < this._fields.length; i++) {
            const r = this._fields[i];
            if (r.w > 0 && r.h > 0 &&
                x >= r.x && x < r.x + r.w &&
                y >= r.y && y < r.y + r.h) {
                return {...r};
            }
        }
        return null;
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
