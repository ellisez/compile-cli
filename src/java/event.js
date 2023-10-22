module.exports = class EventCenter {
    #listeners = {};

    triggerEvent(name, value) {
        let funArray = this.#listeners[name];
        if (funArray) {
            for (let { fun, thisCall } of funArray) {
                fun.call(thisCall, value);
            }
            delete this.#listeners[name];
        }
    }

    listenEvent(name, fun, thisCall = null) {
        let funArray = this.#listeners[name];
        if (!funArray) {
            funArray = [];
            this.#listeners[name] = funArray;
        }
        funArray.push({ fun, thisCall });
    }
}
