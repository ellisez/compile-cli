import Staff, {idStaff, newStaff as staffObject} from './entity/staff.ts';// ImportDeclaration
import Department1 from "./entity/department.ts";// ImportDeclaration

function main(...args: string[]): void {// FunctionDeclaration
    const department: Department1 = new Department1(
        100,
        'IT',
        [
            new Staff(
                301,
                'adm',
                'little pig',
                new Date()
            ),
            new Staff(
                302,
                'beni',
                'wow beni',
                new Date()
            ),
            new Staff(
                303,
                'caye',
                'new caye',
                new Date()
            ),
        ]
    );
    console.log(department);
}
console.log(idStaff);
console.log(staffObject);
// console.log(newStaff);
let v=2.0;
const c=0x3;
export default main;// ExportAssignment
export const w = v;

// export const z = function (ert = '123') {
//     ert = '1231';
//     return ert;
// }
export const z = main;
export function ty() {

}

export function yyy() {

}
