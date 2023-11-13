declare module 'java.util.Iterator' {
    import Consumer from "java.util.function.Consumer";

    export default interface Iterator<E extends Object> {
        hasNext(): boolean;

        next(): E

        remove(): void;

        forEachRemaining(c: Consumer): void;
    }
}
