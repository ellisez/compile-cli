export default class ListMap extends Map {
    queue = [];


    at(index) {
        const key = this.queue[index];
        const value = this.get(key);
        return { key, value }
    }

    clear() {
        this.queue.clear();
        super.clear();
    }

    delete(key) {
        let i = this.queue.indexOf(key);
        if (i >= 0) this.queue.splice(i, 1);
        return super.delete(key);
    }

    forEach(callbackfn, thisArg) {
        this.queue.forEach((key, index) => {
            callbackfn.call(thisArg, key, this.get(key), index, this);
        });
    }

    get(key) {
        return super.get(key);
    }

    has(key) {
        return super.has(key);
    }

    set(key, value) {
        this.queue.push(key);
        return super.set(key, value);
    }

    toString() {
        return super.toString();
    }

    toLocaleString() {
        return super.toLocaleString();
    }

    valueOf() {
        return super.valueOf();
    }

    hasOwnProperty(v) {
        return super.hasOwnProperty(v);
    }

    isPrototypeOf(v) {
        return super.isPrototypeOf(v);
    }

    propertyIsEnumerable(v) {
        return super.propertyIsEnumerable(v);
    }

    [Symbol.iterator]() {
        return this.queue[Symbol.iterator]();
    }

    entries() {
        return super.entries();
    }

    keys() {
        return this.queue[Symbol.iterator]();
    }

    values() {
        return super.values();
    }
}
