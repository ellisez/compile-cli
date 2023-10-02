import { rollup } from "rollup";
import log from "./log.js";

export default class Service {
    options = {
        logLevel: 'debug',
        input: 'src/main.ts',
        external: [],
        plugins: [],
        output: [
            {
                dir: 'dist',
                //entryFileNames: `[name].js`,
                // chunkFileNames: 'chunk-[hash].js',
                // assetFileNames: 'assets/[name]-[hash][extname]',
                format: 'es',
                sourcemap: true,
                // globals: {}
            }
        ],
        onLog(level, { loc, frame, message }) {
            if (loc) {
                console.warn(`${loc.file} (${loc.line}:${loc.column}) ${message}`);
                if (frame) console.warn(frame);
            } else {
                console.warn(message);
            }
        }
    }

    /**
     *
     * @param mode 0b01 generate, 0b010 write
     * @returns {Promise<void>}
     */
    async #build(mode = 0) {
        let bundle;
        let buildFailed = false;
        try {
            const outputOptionsList = this.options.output;
            bundle = await rollup(this.options);
            for (const outputOptions of outputOptionsList) {
                if ((mode | 0b001) === 0b001) {
                    await bundle.generate(outputOptions);
                }
                if ((mode | 0b010) === 0b010) {
                    await bundle.write(outputOptions);
                }
            }
        } catch (error) {
            buildFailed = true;
            if (error.name === 'RollupError') {
                const loc = error.loc;
                log.info(`${loc.file}:${loc.line}:${loc.column} \n`);
                log.print(error.frame+'\n');

                if (this.options.logLevel === 'debug') {
                    log.error(error.stack);
                } else {
                    log.error(`${error.name}: ${error.message}`);
                }
            } else {
                log.error(error.message, error.stack || '');
            }
        }
        if (bundle) {
            await bundle.close();
        }
        process.exit(buildFailed ? 1 : 0);
    }

    async build() {
        return this.#build(0b000);
    }

    async generateBundle() {
        await this.#build(0b001);
    }

    async writeBundle() {
        await this.#build(0b011);
    }
}




