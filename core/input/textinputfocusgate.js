import * as Log from '../util/logging.js';

const TAP_SLOP = 15;

export default class TextInputFocusGate {
    constructor(dispatch) {
        this._dispatch = dispatch;

        this._touches = new Map();
        this._moved = false;
        this._deferred = null;
    }

    reset() {
        this._touches.clear();
        this._moved = false;
        this._deferred = null;
    }

    handleTouch(ev) {
        const changed = ev.changedTouches;
        for (let i = 0; i < changed.length; i++) {
            this._track(ev, changed[i]);
        }

        if (this._touches.size === 0) this._flush();
    }

    textInputFocus(detail) {
        if (!detail.tapped && this._touches.size > 0) {
            this._deferred = detail;
            return;
        }

        this._deferred = null;
        this._dispatch(detail);
    }

    _track(ev, touch) {
        switch (ev.type) {
            case 'touchstart':
                if (ev.touches.length === ev.changedTouches.length) {
                    this._touches.clear();
                    this._moved = false;
                }
                this._touches.set(touch.identifier, {clientX: touch.clientX, clientY: touch.clientY});
                if (this._touches.size > 1) this._moved = true;
                break;
            case 'touchmove': {
                const start = this._touches.get(touch.identifier);
                if (start && !near(touch, start)) this._moved = true;
                break;
            }
            case 'touchcancel':
                this._moved = true;
                this._touches.delete(touch.identifier);
                break;
            default:
                this._touches.delete(touch.identifier);
                break;
        }
    }

    _flush() {
        let detail = this._deferred;
        this._deferred = null;
        if (!detail) return;

        if (detail.focused && this._moved) {
            Log.Debug("Text input focus gained during a drag: not showing the keyboard");
            detail = {...detail, focused: false};
        }

        this._dispatch(detail);
    }
}

function near(a, b) {
    return Math.abs(a.clientX - b.clientX) <= TAP_SLOP &&
        Math.abs(a.clientY - b.clientY) <= TAP_SLOP;
}
