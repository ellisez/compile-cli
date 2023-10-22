const path = require("node:path");
const fs = require("node:fs");

const pkgPath = path.resolve('package.json');

function pkgResolve(pkgPath) {
    if (fs.existsSync(pkgPath)) {
        let content = fs.readFileSync(pkgPath).toString();
        content = content.replace(/\n\s*\/\*.*?\*\//g, '');
        content = content.replace(/\n\s*\/\/.*\n/g, '');
        return JSON.parse(content);
    }
}
const pkg = pkgResolve(pkgPath);

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
    pkgResolve,
    entryFile
};

