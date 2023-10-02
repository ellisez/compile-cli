import cli from "../cli.js";
import path from "node:path";
import { readConfig, writeConfig } from "../config.js";
import log from "../log.js";
import { promises } from "node:readline";
import pkgInfo from "../pkg-info.js";

import { createColors } from 'picocolors';
import Service from "../service.js";
import javaPlugin from "../plugins/java-plugin.js";

const colors = createColors(true);

const defaultVersion = '17';
const defaultPackage = getDefaultPackage();

function getDefaultPackage() {
    let name = '';
    const author = pkgInfo.author;
    if (author) {
        if (typeof (author) === 'string') {
            name = author;
        } else {
            name = author.name ?? '';
        }
    }
    if (name.length > 0) {
        name += '.' + pkgInfo.name;
    } else {
        name = pkgInfo.name;
    }
    return name.replace(/(^\/|@)/, '').replace('/', '.');
}

function isEnable() {
    return !!readConfig()?.java?.enable;
}

function doEnable() {
    writeConfig(async config => {
        const readlineInterface = promises.createInterface({
            input: process.stdin,
            output: process.stdout
        });
        readlineInterface.on("SIGTSTP", () => {
            process.exit();
        });
        if (!config.java) {
            log.info('Target "java" needs initialized:');
            config.java = {};
            const javaPackage = await readlineInterface.question(`Input java package (${colors.bold(colors.magenta(defaultPackage))}):`);
            config.java.package = javaPackage || defaultPackage;
            let javaVersion = await readlineInterface.question(`Input java version (${colors.bold(colors.magenta(defaultVersion))}):`);
            if (javaVersion) {
                const versionObject = javaVersion.match(/^(\d+)(?:\.(\d+))?(?:\.(\d+))?$/);
                if (!versionObject) {
                    log.error('Invalid version number. format x.y.z');
                    process.exit(-1);
                }
            } else {
                javaVersion = defaultVersion;
            }
            config.java.version = javaVersion;
            log.info(`\nSave to "${colors.bold(colors.blue(path.resolve('compile.json')))}"`);
        }
        config.java.enable = true;
        log.print('java has enable. \nUsage: "compile java"');
        readlineInterface.close();
    })
}

function doDisable() {
    if (isEnable()) {
        writeConfig(config => {
            config.java.enable = false;
        });
    }
    log.print('java has disable. \nChange to enabled: "compile java --enable"');
}

function validate(options) {
    if (!isEnable()) {
        log.error('Java is not enabled. \nIf you want to enable it, use the command: "compile Java --enable".');
        process.exit(-1);
        return false;
    }
    return true;
}

cli
    .command('java')
    .option('--enable', 'enable java support.')
    .option('--disable', 'disable java support.')
    .description('TypeScript compile to Java.')
    .configureHelp({ showGlobalOptions: true })
    .action(async function (args, cmd) {
        const service = new Service();
        const serviceOptions = service.options;
        // enable or disable
        const options = cmd.optsWithGlobals();
        if (options.enable) {
            doEnable();
            return;
        } else if (options.disable) {
            doDisable();
            return;
        }
        // validate
        if (!validate(options)) {
            return;
        }
        // config
        const entry = options.entry;
        const dest = options.dest;

        serviceOptions.input = path.resolve(entry);
        serviceOptions.output.dir = path.resolve(dest);
        serviceOptions.output.sourcemap = false;
        serviceOptions.plugins.push(javaPlugin(serviceOptions));
        // run
        await service.build();
    })

