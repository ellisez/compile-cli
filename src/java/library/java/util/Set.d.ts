declare module 'java.util.Set' {
    import Iterator from "java.util.Iterator";

    export default interface Set<E extends Object> {
        add(e: E): boolean;
        remove(e: E): boolean;
        contains(o: Object): boolean;
        iterator(): Iterator<E>;

    }
}
