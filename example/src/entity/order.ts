import Product from "./product";
import Consumer from "./consumer";

export default class Order {
    id: bigint;
    no: string;

    consumer: Consumer;

    itemList: Array<OrderItem>;

    discount: bigint;
    total: number;

    isPaid: false;

    toString(): string {
        let code = '';
        for (const orderItem of this.itemList) {
            code += orderItem.toString() + '\n';
        }
        return code;
    }
}

export class OrderItem {
    private static _id = 0;
    id: number;
    product: Product;
    count: number;

    constructor(product: Product, count: number) {
        this.id = ++OrderItem._id;
        this.product = product;
        this.count = count;
    }

    toString(): string {
        return '{ id:' + this.id + ', product:' + this.product.name + ', count:' + this.count + '}';
    }
}
