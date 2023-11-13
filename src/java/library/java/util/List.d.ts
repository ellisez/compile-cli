declare module 'java.util.List' {
    import Iterator from "java.util.Iterator";

    export default interface List<E extends Object> {
        add(e: E): boolean;

        remove(i: int): E;

        contains(o: Object): boolean;

        get(i: int): E;

        set(i: int, e: E): E;

        iterator(): Iterator<E>;

    }
}
