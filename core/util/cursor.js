/*
 * noVNC: HTML5 VNC client
 * Copyright (C) 2019 The noVNC Authors
 * Licensed under MPL 2.0 or any later version (see LICENSE.txt)
 */

import { supportsCursorURIs } from './browser.js';

class CursorMode {
    static _mobileLike() {
        return window.matchMedia('(hover: none) and (pointer: coarse)').matches;
    }

    constructor() {
        this._pointerType = null;
        this._forced = false;
        this._hidden = false;
        this._emulate = false;
        this._target = null;
        this._cssCursor = 'none';
        this._mediaLists = [];
        this._update = this._update.bind(this);
        this._handlePointer = this._handlePointer.bind(this);
        this.onchange = () => {
        };
        this._evaluate();
    }

    get forced() {
        return this._forced;
    }

    get hidden() {
        return this._hidden;
    }

    get active() {
        return !this._hidden && (this._forced || this._emulate);
    }

    get emulate() {
        return this._emulate;
    }

    set emulate(value) {
        this._emulate = !!value;
    }

    get cssCursor() {
        return this._cssCursor;
    }

    set cssCursor(value) {
        this._cssCursor = value;
        this._applyCssCursor();
    }

    start(target) {
        this._target = target;
        const queries = ['(pointer: coarse)', '(hover: none)', '(any-pointer: coarse)'];
        this._mediaLists = queries.map(q => window.matchMedia(q));
        this._mediaLists.forEach(l => l.addEventListener('change', this._update));
        const options = {capture: true, passive: true};
        this._target.addEventListener('pointerdown', this._handlePointer, options);
        this._target.addEventListener('pointermove', this._handlePointer, options);
        this._update();
    }

    stop() {
        this._mediaLists.forEach(l => l.removeEventListener('change', this._update));
        this._mediaLists = [];
        const options = {capture: true, passive: true};
        this._target.removeEventListener('pointerdown', this._handlePointer, options);
        this._target.removeEventListener('pointermove', this._handlePointer, options);
        this._target = null;
    }

    _handlePointer(event) {
        if (!event.pointerType || event.pointerType === this._pointerType) {
            return;
        }
        this._pointerType = event.pointerType;
        this._update();
    }

    _evaluate() {
        const mobileLike = CursorMode._mobileLike();
        const touch = this._pointerType ? this._pointerType === 'touch' : mobileLike;
        this._hidden = touch && !mobileLike;
        this._forced = !this._hidden && (touch || !supportsCursorURIs);
    }

    _applyCssCursor() {
        if (this._target) {
            this._target.style.cursor = (this._forced || this._hidden) ? 'none' : this._cssCursor;
        }
    }

    _update() {
        const forced = this._forced;
        const hidden = this._hidden;
        this._evaluate();
        this._applyCssCursor();
        if (forced !== this._forced || hidden !== this._hidden) {
            this.onchange();
        }
    }
}

export default class Cursor {
    constructor() {
        this._target = null;

        this._canvas = document.createElement('canvas');
        this._canvas.style.position = 'fixed';
        this._canvas.style.zIndex = '65535';
        this._canvas.style.pointerEvents = 'none';
        // Can't use "display" because of Firefox bug #1445997
        this._canvas.style.visibility = 'hidden';
        this._mode = new CursorMode();
        this._mode.onchange = this._handleModeChange.bind(this);
        this._nativeTouch = false;

        this._position = { x: 0, y: 0 };
        this._hotSpot = { x: 0, y: 0 };

        this._eventHandlers = {
            'mouseover': this._handleMouseOver.bind(this),
            'mouseleave': this._handleMouseLeave.bind(this),
            'mousemove': this._handleMouseMove.bind(this),
            'mouseup': this._handleMouseUp.bind(this),
        };
    }

    attach(target) {
        if (this._target) {
            this.detach();
        }

        this._target = target;

        
        document.body.appendChild(this._canvas);

        const options = { capture: true, passive: true };
        this._target.addEventListener('mouseover', this._eventHandlers.mouseover, options);
        this._target.addEventListener('mouseleave', this._eventHandlers.mouseleave, options);
        this._target.addEventListener('mousemove', this._eventHandlers.mousemove, options);
        this._target.addEventListener('mouseup', this._eventHandlers.mouseup, options);

        this._mode.start(this._target);

        this.clear();
    }

    detach() {
        if (!this._target) {
            return;
        }

        const options = { capture: true, passive: true };
        this._target.removeEventListener('mouseover', this._eventHandlers.mouseover, options);
        this._target.removeEventListener('mouseleave', this._eventHandlers.mouseleave, options);
        this._target.removeEventListener('mousemove', this._eventHandlers.mousemove, options);
        this._target.removeEventListener('mouseup', this._eventHandlers.mouseup, options);

        this._mode.stop();

        document.body.removeChild(this._canvas);

        this._target = null;
    }

    change(rgba, hotx, hoty, w, h) {
        if ((w === 0) || (h === 0)) {
            this.clear();
            return;
        }

        this._position.x = this._position.x + this._hotSpot.x - hotx;
        this._position.y = this._position.y + this._hotSpot.y - hoty;
        this._hotSpot.x = hotx;
        this._hotSpot.y = hoty;

        let ctx = this._canvas.getContext('2d');

        this._canvas.width = w;
        this._canvas.height = h;

        let img = new ImageData(new Uint8ClampedArray(rgba), w, h);
        ctx.clearRect(0, 0, w, h);
        ctx.putImageData(img, 0, 0);

        if (this._mode.active) {
            this._updatePosition();
        }
        if (supportsCursorURIs) {
            let url = this._canvas.toDataURL();
            this._mode.cssCursor = 'url(' + url + ')' + hotx + ' ' + hoty + ', default';
        }
    }

    clear() {
        this._mode.cssCursor = 'none';
        this._canvas.width = 0;
        this._canvas.height = 0;
        this._position.x = this._position.x + this._hotSpot.x;
        this._position.y = this._position.y + this._hotSpot.y;
        this._hotSpot.x = 0;
        this._hotSpot.y = 0;
    }

    // Mouse events might be emulated, this allows
    // moving the cursor in such cases
    move(clientX, clientY) {
        if (!this._mode.active) {
            return;
        }
        // clientX/clientY are relative the _visual viewport_,
        // but our position is relative the _layout viewport_,
        // so try to compensate when we can
        if (window.visualViewport) {
            this._position.x = clientX + window.visualViewport.offsetLeft;
            this._position.y = clientY + window.visualViewport.offsetTop;
        } else {
            this._position.x = clientX;
            this._position.y = clientY;
        }
        this._updatePosition();
        let target = document.elementFromPoint(clientX, clientY);
        this._updateVisibility(target);
    }

    // Force the use of cursor emulation. This is needed when the pointer lock
    // is in use, since the browser will not render the cursor.
    setEmulateCursor(emulate) {
        this._mode.emulate = emulate;
        if (this._mode.forced) {
            // We need to use the fallback all the time, so we shouldn't update
            // the fallback flag.
            return;
        }
        if (this._mode.active) {
            this._showCursor();
        } else {
            this._hideCursor();
        }
    }

    _handleModeChange() {
        if (!this._mode.active) {
            this._hideCursor();
        }
    }

    _handleMouseOver(event) {
        // This event could be because we're entering the target, or
        // moving around amongst its sub elements. Let the move handler
        // sort things out.
        this._handleMouseMove(event);
    }

    _handleMouseLeave(event) {
        if (!this._mode.forced) {
            return;
        }
        // Check if we should show the cursor on the element we are leaving to
        this._updateVisibility(event.relatedTarget);
    }

    _handleMouseMove(event) {
        if (!this._mode.forced) {
            return;
        }
        this._updateVisibility(event.target);

        this._position.x = event.clientX - this._hotSpot.x;
        this._position.y = event.clientY - this._hotSpot.y;

        this._updatePosition();
    }

    _handleMouseUp(event) {
        if (!this._mode.forced) {
            return;
        }
        // We might get this event because of a drag operation that
        // moved outside of the target. Check what's under the cursor
        // now and adjust visibility based on that.
        let target = document.elementFromPoint(event.clientX, event.clientY);
        this._updateVisibility(target);

        // Captures end with a mouseup but we can't know the event order of
        // mouseup vs releaseCapture.
        //
        // In the cases when releaseCapture comes first, the code above is
        // enough.
        //
        // In the cases when the mouseup comes first, we need wait for the
        // browser to flush all events and then check again if the cursor
        // should be visible.
        if (this._captureIsActive()) {
            window.setTimeout(() => {
                // We might have detached at this point
                if (!this._target) {
                    return;
                }
                // Refresh the target from elementFromPoint since queued events
                // might have altered the DOM
                target = document.elementFromPoint(event.clientX,
                                                   event.clientY);
                this._updateVisibility(target);
            }, 0);
        }
    }

    _showCursor() {
        if (this._canvas.style.visibility === 'hidden') {
            this._canvas.style.visibility = '';
        }
    }

    _hideCursor() {
        if (this._canvas.style.visibility !== 'hidden') {
            this._canvas.style.visibility = 'hidden';
        }
    }

    // Should we currently display the cursor?
    // (i.e. are we over the target, or a child of the target without a
    // different cursor set)
    _shouldShowCursor(target) {
        if (!target) {
            return false;
        }
        // Easy case
        if (target === this._target) {
            return true;
        }
        // Other part of the DOM?
        if (!this._target.contains(target)) {
            return false;
        }
        // Has the child its own cursor?
        // FIXME: How can we tell that a sub element has an
        //        explicit "cursor: none;"?
        if (window.getComputedStyle(target).cursor !== 'none') {
            return false;
        }
        return true;
    }

    set nativeTouch(value) {
        value = !!value;
        if (this._nativeTouch === value)
            return;
        this._nativeTouch = value;
        if (value)
            this._hideCursor();
    }

    _updateVisibility(target) {
        if (this._nativeTouch) {
            this._hideCursor();
            return;
        }
        // When the cursor target has capture we want to show the cursor.
        // So, if a capture is active - look at the captured element instead.
        if (this._captureIsActive()) {
            target = document.captureElement;
        }
        if (this._shouldShowCursor(target)) {
            this._showCursor();
        } else {
            this._hideCursor();
        }
    }

    _updatePosition() {
        this._canvas.style.left = this._position.x + "px";
        this._canvas.style.top = this._position.y + "px";
    }

    _captureIsActive() {
        return document.captureElement &&
            document.documentElement.contains(document.captureElement);
    }
}
