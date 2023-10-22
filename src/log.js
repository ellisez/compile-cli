const { createColors } = require('picocolors');

const colors = createColors(true);

class Log {
    fatal(...msg) {
        this.error(msg);
        process.exit(-1);
    }
    error(...msg) {
        let res = '';
        for (const m of msg) {
            res += m;
        }
        console.error(colors.red(res));
        return this;
    }

    info(...msg) {
        let res = '';
        for (const m of msg) {
            res += m;
        }
        console.info(colors.green(res));
        return this;
    }

    warn(...msg) {
        let res = '';
        for (const m of msg) {
            res += m;
        }
        console.warn(colors.yellow(res));
        return this;
    }

    print(...msg) {
        let res = '';
        for (const m of msg) {
            res += m;
        }
        console.log(res);
        return this;
    }

    debug(...msg) {
        let res = '';
        for (const m of msg) {
            res += m;
        }
        console.debug(colors.blue(res));
        return this;
    }

    clear() {
        console.clear();
        return this;
    }

    custom(msg, color='inverse') {
        console.log(colors[color](msg));
        return this;
    }
}

module.exports = new Log();
