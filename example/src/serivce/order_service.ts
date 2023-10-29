import Order, {OrderItem} from "../entity/order";
import Consumer from "../entity/consumer";

export default class OrderService {
    private static id = 0n;

    createOrder(consumer: Consumer, ...itemList: OrderItem[]): Order {
        const order = new Order();
        order.id = ++OrderService.id;
        order.consumer = consumer;
        order.itemList = itemList;
        for (const item of itemList) {
            if (!item.product.isOnSale) {
                throw item.product.name + ' is off shelf';
            }
        }
        return order;
    }

    doPay(order: Order) {
        if (order.isPaid == false) {
            for (const item of order.itemList) {
                if (item.product.count < item.count) {
                    throw item.product.name + ' is not enough.';
                }
                item.product.count -= item.count;
            }
            order.isPaid = true;
        }

    }
}
