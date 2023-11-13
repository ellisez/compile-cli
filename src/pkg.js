const path = require("node:path");
const fs = require("node:fs");
const json = require('./json.js');

const pkgPath = path.resolve('package.json');
const pkg = json.ofFile(pkgPath);

function entryResolve() {
    let entry = pkg.main;
    if (!entry) {
        entry = 'src/main.ts';
        let entryPath = path.resolve(entry);
        if (fs.existsSync(entryPath)) {
            return entryPath;
        }
        entry = 'src/main.js';
    }
    return path.resolve(entry);
}
const entryFile = entryResolve();

module.exports = {
    pkg,
    entryFile
};

