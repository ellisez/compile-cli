import Order from "./order";

export default class Consumer {
    id: number;
    nickname: string;
    balance: number;

    orderList: Order[];

    toString(): string {
        return '{ id: '+this.id+', nickname:'+this.nickname+' }';
    }
}
