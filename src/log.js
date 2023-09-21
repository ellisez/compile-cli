import { createColors } from 'picocolors';

const colors = createColors(true);

class Log {
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
}

export default new Log();
