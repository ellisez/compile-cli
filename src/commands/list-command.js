import cli from "../cli.js";
import { readConfig } from "../config.js";
import log from "../log.js";

cli
    .command('list')
    .description('list all enable target.')
    .configureHelp({ showGlobalOptions: true })
    .action(async function (args, cmd) {
        const config = readConfig();
        if (!config || config.keys().length === 0) {
            log.warn('<no target be enabled>');
            return;
        }
        config.forEach((key, value) => {
            if (value === true || value?.enable) {
                log.print(key);
            }
        });
    })
