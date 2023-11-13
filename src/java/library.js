const fs = require('node:fs');
const path = require('node:path');
const json = require('../json');
const global = require('./global');

const libDir = path.join(__dirname, 'library');
const libConfig = path.join(libDir, 'tsconfig.json');
const libOptions = json.ofFile(libConfig);

libOptions.compilerOptions.rootDir = libDir;
libOptions.compilerOptions.basePackage = '';

const entryFiles = [];

const includeRegexp = [];
const excludeRegexp = [];

function wildcardToRegexp(wildcard) {
    const itemSplit = wildcard.split('/');
    for (let i = 0; i < itemSplit.length; i++) {
        let splitElement = itemSplit[i];
        if (splitElement === '.') {
            itemSplit[i] = libDir.replace(/\\/g, '/');
            continue;
        } else if (splitElement === '**') {
            itemSplit[i] = '(/[^/]+)*';
            continue;
        }

        splitElement = splitElement.replace(/([.])/g, '\\$1');
        splitElement = splitElement.replace(/([^/]*)\*([^/]*)/g, '$1[^/]+$2');
        itemSplit[i] = '/' + splitElement;
    }

    return new RegExp(itemSplit.join(''));
}
function isMatch(filepath) {

    const include = libOptions.include;
    const exclude = libOptions.exclude;
    const files = libOptions.files;

    const filepathPattern = filepath.replace(/\\/g, '/');
    if (exclude) {
        if (excludeRegexp.length === 0) {
            for (let item of exclude) {// ./**/*.d.ts
                const regExp = wildcardToRegexp(item);
                excludeRegexp.push(regExp);
            }
        }
        for (let regExp of excludeRegexp) {
            if (regExp.test(filepathPattern)) {
                return fasle;
            }
        }
    }
    if (files) {
        for (let item of files) {
            if (item === filepath) return true;
        }
    }
    if (include) {
        if (includeRegexp.length === 0) {
            for (let item of include) {// ./**/*.d.ts
                const regExp = wildcardToRegexp(item);
                includeRegexp.push(regExp);
            }
        }
        for (let regExp of includeRegexp) {
            if (regExp.test(filepathPattern)) {
                return true;
            }
        }
    }
    return false;
}

function recurDirectory(dir) {
    const fileList = fs.readdirSync(dir);
    for (const file of fileList) {
        const filepath = path.join(dir, file);

        const stats = fs.statSync(filepath);
        if (stats.isDirectory()) {
            recurDirectory(filepath);
        } else if (stats.isFile()) {
            if (isMatch(filepath)) {
                entryFiles.push(filepath);
            }
        }
    }
}

let functionInterface, moduleMap;
let isResolved = false;
function loadLibrary() {
    if (isResolved) return;
    isResolved = true;
    recurDirectory(libDir);

    const Parser = require('./parse');
    const parser = new Parser(libOptions);

    parser.parse(entryFiles);

    const project = parser.project;

    moduleMap = project.moduleMap;

    for (let [_, value] of moduleMap) {
        global.set(value.name.text, value);
    }

}

module.exports = {
    moduleMap,
    loadLibrary,
    functionInterface,
}
