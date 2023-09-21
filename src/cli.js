import { Command } from "commander";
import process from 'node:process';
import log from './log.js';

const defaultOptions = {
    dest: 'dist'
}


const program = new Command();
program
    .name('compile')
    .description('TypeScript compile to the specified programming language.\nSupport: [go, java, kotlin, python, swift, web]')
    .summary('Support: [ go, java, js, kotlin, python, swift ]')
    .usage('[options] <command>')
    .option('--dest <path>', `[string] specify output directory`, defaultOptions.dest)
    .configureHelp({ showGlobalOptions: true })
    .action(function () {
        log.error(`Must be specified the target programming language.\n${this.summary()}`);
        process.exit(-1);
    });

export default program;
