import path from "node:path";
import fs from "node:fs";

const pkgPath = path.resolve('package.json');

function getPkgInfo() {
    if (fs.existsSync(pkgPath)) {
        return JSON.parse(fs.readFileSync(pkgPath).toString());
    }
}
let pkg = getPkgInfo();
export default pkg;
