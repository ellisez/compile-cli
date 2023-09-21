import cli from "../cli.js";

cli
    .command('java')
    .description('TypeScript compile to Java.')
    .action(function (args, cmd) {
        const dest = cmd.opts.dest;
    })


