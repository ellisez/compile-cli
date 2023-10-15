import Order from "./order";

export default class Consumer {
    id: bigint;
    nickname: string;
    balance: bigint;

    orderList: Order[];

    toString(): string {
        return '{ id: '+this.id+', nickname:'+this.nickname+' }';
    }
}
