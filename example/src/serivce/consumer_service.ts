import Consumer from "../entity/consumer";

export default class ConsumerService {
    private static id: bigint = 0n;

    createConsumer(): Consumer {
        const consumer = new Consumer();
        consumer.id = ++ConsumerService.id;
        consumer.nickname = 'ellis';
        return consumer;
    }

    recharge(consumer: Consumer, money: bigint) {
        consumer.balance += money;
    }
}
