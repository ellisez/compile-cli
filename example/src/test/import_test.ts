export function plus(a: bigint, b: bigint): bigint {
    return a + b;
}

export function minus(a: bigint, b: bigint): bigint {
    return a - b;
}

export function asterisk(a: bigint, b: bigint): bigint {
    for (let i = 0; i < b; i++) {
        a += a;
    }
    return a
}

export function slash(a: bigint, b: bigint): bigint {
    if (b == 0n) {
        return;
    } else if (b == 1n) {
        return a;
    } else {
        return a / b;
    }
}

export function contains(arr: bigint[], a: bigint): boolean {
    for (let it of arr) {
        if (it === a) {
            return true;
        }
    }
    return false;
}

export function containsKey(map: Map<string, string>, k: string) {
    for (let kk in map) {
        if (kk === k) {
            return true;
        }
    }
    return false;
}


export const pi = 3.1415926;
