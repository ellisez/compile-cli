import path from 'node:path';
import process from 'node:process';
import fs from 'node:fs';
import typescript from "typescript";
import log from "./log.js";

const cwd = process.cwd();

function getNodeEntry(nodePath) {
    const pkgPath = path.resolve(nodePath, 'package.json');
    const pkgInfo = JSON.parse(fs.readFileSync(pkgPath).toString());
    const entry = pkgInfo.main ?? 'src/main.js';
    return path.resolve(nodePath, entry);
}

function matchAbsolute(id) {
    if (path.isAbsolute(id) && fs.existsSync(id)) {
        return id;
    }
}

function matchRelative(id, importer) {
    const regexp = /^[./]/;
    if (regexp.test(id)) {
        const importerDir = path.dirname(importer);
        const relativePath = path.join(importerDir, id);
        if (fs.existsSync(relativePath)) {
            return relativePath;
        }
    }
}

function matchRootPath(id) {
    const regexp = /^@\//;
    const matches = regexp.exec(id);
    if (matches) {
        const rootPath = path.join(cwd, matches[1]);
        if (fs.existsSync(rootPath)) {
            return rootPath;
        }
    }
}

function matchNode(id) {
    const nodePath = path.join(cwd, 'node_modules', id);
    if (fs.existsSync(nodePath)) {
        return getNodeEntry(nodePath);
    }
}

export default function plugin(serviceOptions) {
    return {
        resolveId(id, importer) {
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
            const transpileOutput = typescript.transpileModule(contents, {
                compilerOptions: {
                    sourceMap: true, target: typescript.ScriptTarget.Latest
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
