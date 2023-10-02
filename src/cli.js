import { Command } from "commander";
import process from 'node:process';
import log from './log.js';
import pkgInfo from "./pkg-info.js";

if (!pkgInfo) {
    log.error('This is not a correct application, "package.json" cannot be found.');
    process.exit(-1);
}

const defaultOptions = {
    entry: 'src/main.ts',
    dest: 'dist'
}


const program = new Command();
program
    .name('compile')
    .description('TypeScript compile to the specified programming language.\nSupport: [go, java, kotlin, python, swift, web]')
    .summary('Support: [ go, java, kotlin, python, swift ]')
    .usage('[options] <command>')
    .option('--entry <file>', `[string] specify the entry file`, defaultOptions.entry)
    .option('--dest <path>', `[string] specify output directory`, defaultOptions.dest)
    .option('-w, --watch', `[boolean] rebuilds when modules have changed on disk`)
    .action(function () {
        log.error(`Must be specified the target programming language.\n${this.summary()}`);
        process.exit(-1);
    });

export default program;
