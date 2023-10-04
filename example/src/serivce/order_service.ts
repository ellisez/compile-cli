import Order, {OrderItem} from "../entity/order";

export default class OrderService {
    private static id = 0;

    createOrder(consumer, ...itemList: OrderItem[]): Order {
        const order = new Order();
        order.id = ++OrderService.id;
        order.consumer = consumer;
        order.itemList = itemList;
        for (let item of itemList) {
            if (!item.product.isOnSale) {
                throw item.product.name + ' is off shelf';
            }
        }
        return order;
    }

    doPay(order) {
        if (order.isPaid == false) {
            for (let item of order.itemList) {
                if (item.product.count < item.count) {
                    throw item.product.name + ' is not enough.';
                }
                item.product.count -= item.count;
            }
            order.isPaid = true;
        }

    }
}
