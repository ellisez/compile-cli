const fs = require("node:fs");

exports.ofFile = function (filepath) {
    if (fs.existsSync(filepath)) {
        let content = fs.readFileSync(filepath).toString();
        content = content.replace(/\n\s*\/\*.*?\*\//g, '');
        content = content.replace(/\n\s*\/\/.*\n/g, '');
        return JSON.parse(content);
    }

}
