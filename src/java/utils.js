const path = require("node:path");
const process = require("node:process");
const { readConfig } = require("../config.js");

const cwd = process.cwd();
const config = readConfig();

function toPackageName(fileName) {
    const fileDir = path.dirname(fileName);
    let relative = path.relative(cwd, fileDir);
    relative = relative.replace(/^src[\\/]?/, '').replace(/[\\/]/, '.');
    let packageName = `${config.java.package}.${relative}`;
    packageName = packageName.replace(/(^\.)|(\.$)/g, '');
    return packageName;
}

function toClassName(fileName) {
    let basename = path.basename(fileName);
    basename = /^\w+/g.exec(basename)[0];
    return basename.replace(/(^[a-z])|_([a-z])/g, (_, $1, $2) => {
        if ($2) return $2.toUpperCase()
        return $1.toUpperCase();
    });
}

function toClassFullName(fileName) {
    const packageName = toPackageName(fileName);
    const className = toClassName(fileName);
    return `${packageName}.${className}`;
}

function toFileName(classFullName) {
    if (classFullName.startsWith(config.java.package)) {
        let relativePath = classFullName.substr(config.java.package);
        relativePath = relativePath.replace('.', path.sep);
        return path.join(cwd, 'src', relativePath + '.java');
    }
}

function toCamel(underline) {
    return underline.replace(/^([a-z])|_([a-z])/g, function ($0, $1, $2) {
        if ($1) return $1.toUpperCase();
        if ($2) return $2.toUpperCase();
    });
}

function toUnderline(camel) {
    return camel.replace(/^([A-Z])|(?<=[a-z0-9])([A-Z])/g, function ($0, $1, $2) {
        if ($1) return $1.toLowerCase();
        if ($2) return '_' + $2.toLowerCase();
    })
}

module.exports = {
    toPackageName,
    toClassName,
    toClassFullName,
    toFileName,
    toCamel,
    toUnderline,
}
