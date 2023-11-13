const path = require("node:path");
const fs = require("node:fs");
const json = require('./json.js');

let _cfg = null;

exports.readConfig = readConfig;
function readConfig() {
    if (_cfg) return _cfg;
    const distConfigPath = path.resolve('compile.json');
    const cfg = json.ofFile(distConfigPath);
    if (cfg) {
        _cfg = cfg;
    }
    return _cfg
}


_cfg = readConfig();

exports.writeConfig = function writeConfig(fun) {
    _cfg ??= {};
    const r = fun(_cfg);

    function writeFile() {
        const distConfigPath = path.resolve('compile.json');
        fs.writeFileSync(distConfigPath, JSON.stringify(_cfg, null, '\t'));
        cache = {};
    }

    if (r && r.then) {
        r.then(writeFile)
    } else {
        writeFile();
    }
}

let cache = {}

exports.versionObject = function versionObject(target) {
    let cacheTarget = cache[target];
    if (!cacheTarget) {
        cacheTarget = {}
        cache[target] = cacheTarget;
    }
    let targetVersion = cacheTarget.versionObject;
    if (!targetVersion) {
        const version = _cfg[target].version;
        const versionObject = version.match(/^(\d+)(?:\.(\d+))?(?:\.(\d+))?$/);
        targetVersion = versionObject.filter((_, index) => index !== 0).map(item => parseInt(item));
        cache[target].versionObject = targetVersion;
    }
    return targetVersion;
}

