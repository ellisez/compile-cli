declare module 'java.util.function.Consumer' {
    export default interface Consumer<T> {
        accept(t: T): boolean;

        andThen(t: Consumer<T>): Consumer<T>;
    }
}
