const path = require('node:path');
const process = require('node:process');
const fs = require('node:fs');
const ts = require("typescript");
const log = require("./log.js");
const { pkgResolve, entryFile } = require("./pkg");

const cwd = process.cwd();

function pathExists(id) {
    if (fs.existsSync(id)) {
        return id;
    }
    id += '.ts';
    if (fs.existsSync(id)) {
        return id;
    }
}

function matchAbsolute(id) {
    if (path.isAbsolute(id)) {
        return pathExists(id);
    }
}

function matchRelative(id, conster) {
    const regexp = /^[./]/;
    if (regexp.test(id)) {
        const consterDir = path.dirname(conster);
        const relativePath = path.join(consterDir, id);
        return pathExists(relativePath);
    }
}

function matchRootPath(id) {
    const regexp = /^@\//;
    const matches = regexp.exec(id);
    if (matches) {
        const rootPath = path.join(cwd, matches[1]);
        return pathExists(rootPath);
    }
}

function matchNode(id) {
    const nodePath = path.join(cwd, 'node_modules', id);
    if (pathExists(nodePath)) {
        return entryFile;
    }
}

function tsconfig(directory = cwd) {
    let tsconfigPath = path.join(directory, 'tsconfig.json');
    const json = pkgResolve(tsconfigPath);
    if (!json) {
        const parentPath = path.dirname(directory);
        if (!parentPath) {
            throw Error(`Not found tsconfig.json in ${cwd}.`);
        }
        return tsconfig(parentPath);
    }
    return json;
}

module.exports = function(serviceOptions) {
    return {
        tsOptions: tsconfig(cwd),
        resolveId(id, importer) {
            // let rawPath = id;
            const absolutePath = matchAbsolute(id);
            if (absolutePath) {
                return absolutePath;
            }
            const relativePath = matchRelative(id, importer);
            if (relativePath) {
                return relativePath;
            }
            const rootPath = matchRootPath(id);
            if (rootPath) {
                return rootPath;
            }

            const nodePath = matchNode(id);
            if (nodePath) {
                return nodePath;
            }
            //return { id, external: true };
            return null;
        },

        load(id) {
            return fs.readFileSync(id).toString();
        },

        transform(contents, id) {
            const transpileOutput = ts.transpileModule(contents, {
                compilerOptions: {
                    sourceMap: true, target: ts.ScriptTarget.Latest
                },
                fileName: id
            });

            return {
                code: transpileOutput.outputText, //moduleSideEffects: 'no-treeshake',
                map: transpileOutput.sourceMapText
            };
        },
    }
}
