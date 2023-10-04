import ConsumerService from "./serivce/consumer_service";
import ProduceService from "./serivce/produce_service";
import OrderService from "./serivce/order_service";
import {OrderItem} from "./entity/order";
import { plus, minus, asterisk, slash, pi } from "./test/import_test";

const consumerService = new ConsumerService();
const productService = new ProduceService();
const orderService = new OrderService();

function testClass() {
    console.log('1. Create a Consumer instance.');
    const consumer = consumerService.createConsumer();
    console.log('> ' + consumer.toString());

    console.log('2. Recharge 200.');
    consumerService.recharge(consumer, 200);
    console.log('> balance = ' + consumer.balance);

    console.log('3. Create a Product instance.');
    const product = productService.createProduct();
    console.log('> ' + product.toString());

    console.log('4. Put 30 products on shelf.');
    productService.onShelf(product, 30);
    console.log('> count = ' + product.count);

    console.log('5. Consumers create order of 20 products.');
    let order = orderService.createOrder(consumer,
        new OrderItem(product, 20),
    );
    console.log('> order = ' + order.toString());

    console.log('6. Consumer pay order');
    orderService.doPay(order);
    console.log('> order = ' + order.toString());

    console.log('7. Product pull off shelf.');
    productService.offShelf(product);

    try {
        console.log('8. Consumer pay order');
        orderService.doPay(order);
    } catch (e) {
        console.error('> error: ' + e.message);
    }

    console.log('9. Put products on shelf again.');
    productService.onShelf(product);

    try {
        console.log('10. pay order for 20 products.');
        order = orderService.createOrder(consumer,
            new OrderItem(product, 20),
        );
        orderService.doPay(order);
    } catch (e) {
        console.error('> error: ' + e.message);
    }

}

const plusLoad = plus;

const piLoad = pi;
function testImport() {
    let a=1;
    let b=2;
    console.log(plusLoad(a, b));
    console.log(minus(a,b));
    console.log(asterisk(a,b));
    console.log(slash(a,b));
    console.log(piLoad);
}

function main(...args: string[]): void {
    testClass();
    testImport();
}
