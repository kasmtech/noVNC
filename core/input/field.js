/*
 * KasmVNC: text-input field geometry for native touch mode.
 * Licensed under MPL 2.0 (see LICENSE.txt)
 */

export default class Field {
    constructor(x, y, w, h) {
        this.x = x;
        this.y = y;
        this.w = w;
        this.h = h;
        this._any = false;
    }

    static any() {
        const f = new Field(0, 0, 0, 0);
        f._any = true;
        return f;
    }

    static from(rect) {
        return new Field(rect.x, rect.y, rect.w, rect.h);
    }

    get any() {
        return this._any;
    }

    get valid() {
        return this._any || (this.w > 0 && this.h > 0);
    }

    contains(x, y) {
        if (this._any)
            return true;

        return x >= this.x && x < this.x + this.w && y >= this.y && y < this.y + this.h;
    }

    equals(other) {
        if (!other)
            return false;
        if (this._any || other._any)
            return this._any && other._any;

        return this.x === other.x && this.y === other.y && this.w === other.w && this.h === other.h;
    }
}

export class FieldList {
    constructor(toRemote) {
        this._toRemote = toRemote;
        this._fields = [];
    }

    set(rects) {
        this._fields = Array.isArray(rects) ? rects.map(r => Field.from(r)) : [];
    }

    get length() {
        return this._fields.length;
    }

    contains(field, clientX, clientY) {
        const {x, y} = this._toRemote(clientX, clientY);
        return field.contains(x, y);
    }

    at(clientX, clientY) {
        const {x, y} = this._toRemote(clientX, clientY);
        for (const field of this._fields) {
            if (field.valid && field.contains(x, y))
                return field;
        }
        return null;
    }
}
