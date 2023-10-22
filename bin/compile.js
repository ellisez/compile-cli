const cli = require("../src/cli.js");
require('../src/commands/list-command.js');
require('../src/java/command.js');

cli.parse(process.argv)
