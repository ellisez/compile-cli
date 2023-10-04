export default class Product {
    id: number;
    name: string;
    price: number;

    count: number;

    isOnSale: boolean = false;

    toString(): string {
        return '{ id:' + this.id + ', name:' + this.name + ', price:' + this.price + ', count:' + this.count + ' }';
    }
}
