declare module 'java.util.LinkedList' {
    import List from "java.util.List";

    export default interface LinkedList<E extends Object> extends List<E> {
    }
}
