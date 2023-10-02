import exp = require("constants");

export default class Staff {
    constructor(id: number, username: string, nickname: string, birthday: Date) {
        this.id = id;
        this.username = username;
        this.nickname = nickname;
        this.birthday = birthday;
    }

    // private Long id;
    id: number;

    // private String username;
    username: string;

    // private String nickname;
    public nickname: string;

    // private Date birthday;
    birthday: Date;
}
export const newStaff = new Staff(null, null, null, null);
export const idStaff = (id: number): Staff => new Staff(id, null, null, null);
