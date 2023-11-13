const plugin = require("../plugin.js");
const Parser = require('./parse.js');
const { entryFile } = require("../pkg.js");


module.exports = function (serviceOptions) {
    const basePlugin = plugin(serviceOptions);

    const tsOptions = basePlugin.tsOptions;

    const parser = new Parser(tsOptions);
    const javaBundle = parser.parse([entryFile]);
    javaBundle.generateBundle();
    javaBundle.writeBundle();
}

