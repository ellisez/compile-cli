const cli = require("../cli.js");
const { readConfig } = require("../config.js");
const log = require("../log.js");

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
