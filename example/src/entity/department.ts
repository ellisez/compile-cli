import Staff from "./staff.ts";

export default class Department {
    constructor(id: number, name: string, staffList: Staff[]) {
        this.id = id;
        this.name = name;
        this.staffList = staffList;
    }

    // private Long id;
    id: number;

    // private String name;
    name: string;

    // private List<Staff> staffList;
    staffList: Staff[];
}
