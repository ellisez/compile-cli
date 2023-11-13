declare module 'java.util.HashMap' {
    import Map from "java.util.Map";
    export default interface HashMap<K extends Object, V extends Object> extends Map {
    }
}
