const path = require("node:path");
const process = require("node:process");
const { readConfig } = require("../config.js");

const cwd = process.cwd();
const config = readConfig();

function toPackageName(fileName, basePackage = config.java.package, rootDir = cwd) {
    const fileDir = path.dirname(fileName);
    let relative = path.relative(rootDir, fileDir);
    relative = relative.replace(/^src[\\/]?/, '').replace(/[\\/]/, '.');
    let packageName = `${basePackage}.${relative}`;
    if (!basePackage) {
        packageName = relative;
    } else if (!relative) {
        packageName = basePackage;
    }
    return packageName;
}

function toClassName(fileName) {
    const fileInfo = path.parse(fileName);
    let name = fileInfo.base;
    if (name.endsWith('.d.ts')) {
        const dtsLength = '.d.ts'.length;
        name = name.slice(0, -dtsLength);
    } else {
        name = fileInfo.name;
    }
    return name.replace(/(^[a-z])|_([a-z])/g, (_, $1, $2) => {
        if ($2) return $2.toUpperCase()
        return $1.toUpperCase();
    });
}

function toClassFullName(fileName, basePackage = config.java.package, rootDir = cwd) {
    const packageName = toPackageName(fileName, basePackage, rootDir);
    const className = toClassName(fileName);
    return `${packageName}.${className}`;
}

function toClassInfo(fileName, basePackage = config.java.package, rootDir = cwd) {
    const packageName = toPackageName(fileName, basePackage, rootDir);
    const className = toClassName(fileName);
    const fullName = `${packageName}.${className}`;
    return {
        packageName,
        className,
        fullName,
    }
}

function toFileName(classFullName, basePackage = config.java.package, rootDir = cwd) {
    if (classFullName.startsWith(basePackage)) {
        let relativePath = classFullName.substr(basePackage);
        relativePath = relativePath.replace(/(?<=\.)(\w+)$/, ($0, $1) => $1.toLowerCase());
        relativePath = relativePath.replace(/\./g, path.sep);
        return path.join(rootDir, 'src', relativePath + '.ts');
    }
}

function toJavaFile(classFullName, basePackage = config.java.package, rootDir = cwd) {
    if (classFullName.startsWith(basePackage)) {
        let relativePath = classFullName.substr(basePackage);
        relativePath = relativePath.replace(/\./g, path.sep);
        return path.join(rootDir, 'dist', 'src', 'main', 'java', relativePath + '.java');
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
    toClassInfo,
    toFileName,
    toCamel,
    toUnderline,
    toJavaFile,
}
