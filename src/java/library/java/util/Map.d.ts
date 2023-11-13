declare module 'java.util.Map' {
    import Set from "java.util.Set";
    export default interface Map<K extends Object, V extends Object> {
        put(k: K, v: V): V;

        remove(k: K): V;

        containsKey(k: K): boolean;

        containsValue(v: V): boolean;

        get(k: K): V;

        keySet(): Set<K>;

        values(): Set<V>;

    }
}
