import Consumer from "../entity/consumer";

export default class ConsumerService {
    private static id = 0;

    createConsumer(): Consumer {
        const consumer = new Consumer();
        consumer.id = ++ConsumerService.id;
        consumer.nickname = 'ellis';
        return consumer;
    }

    recharge(consumer: Consumer, money: number) {
        consumer.balance += money;
    }
}
