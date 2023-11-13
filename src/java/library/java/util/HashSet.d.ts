declare module 'java.util.HashSet' {
    import Set from "java.util.Set";

    export default interface HashSet<E extends Object> extends Set<E> {
    }
}
