/*
 * noVNC: HTML5 VNC client
 * Copyright (C) 2020 The noVNC Authors
 * Licensed under MPL 2.0 (see LICENSE.txt)
 *
 * See README.md for usage and integration instructions.
 */

/*
 * HTML element utility functions
 */

/*
 * Top-left corner of a canvas in the content coordinates of its scrolling
 * host. An absolutely positioned child of the host placed here covers the
 * canvas and scrolls with it. Requires the host to be positioned (see
 * positionHost).
 */
export function canvasOriginInHost(canvas, host) {
    const c = canvas.getBoundingClientRect();
    const h = host.getBoundingClientRect();
    return {
        x: c.left - h.left - host.clientLeft + host.scrollLeft,
        y: c.top - h.top - host.clientTop + host.scrollTop,
    };
}

/*
 * Absolutely positioned children resolve against the nearest positioned
 * ancestor, so the host needs to be one for canvasOriginInHost offsets to
 * line up.
 */
export function positionHost(host) {
    if (getComputedStyle(host).position === 'static') {
        host.style.position = 'relative';
    }
}

/*
 * Sizes and places an absolutely positioned element over a canvas, in the
 * content coordinates of the canvas's scrolling host so it scrolls with it.
 */
export function placeOverCanvas(el, canvas, host) {
    positionHost(host);
    const origin = canvasOriginInHost(canvas, host);
    const box = canvas.getBoundingClientRect();
    el.style.left = origin.x + 'px';
    el.style.top = origin.y + 'px';
    el.style.width = box.width + 'px';
    el.style.height = box.height + 'px';
}

export function clientToElement(x, y, elem) {
    const bounds = elem.getBoundingClientRect();
    let pos = { x: 0, y: 0 };
    // Clip to target bounds
    if (x < bounds.left) {
        pos.x = 0;
    } else if (x >= bounds.right) {
        pos.x = bounds.width - 1;
    } else {
        pos.x = x - bounds.left;
    }
    if (y < bounds.top) {
        pos.y = 0;
    } else if (y >= bounds.bottom) {
        pos.y = bounds.height - 1;
    } else {
        pos.y = y - bounds.top;
    }

    //multiple KasmVNC screens, Window can still receive mouse events when cursor goes
    //outside of the window if the mouse is down while the moving occurs
    if (x > window.innerWidth) {
        pos.x += (x - window.innerWidth);
    } else if (x < 0) {
        pos.x = x + bounds.left;
    }
    if (y > window.innerHeight) {
        pos.y += (y - window.innerHeight);
    } else if (y < 0) {
        pos.y = y + bounds.top;
    }

    return pos;
}
