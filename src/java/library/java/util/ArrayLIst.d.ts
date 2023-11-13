declare module 'java.util.ArrayList' {
    import List from "java.util.List";

    export default interface ArrayList<E extends Object> extends List<E> {
    }
}
