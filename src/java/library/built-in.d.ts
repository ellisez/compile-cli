/// declaration
interface Object {}
interface String {}
interface Boolean {}
interface Number {}
interface int {}
interface BigInt {}
interface double {}

/// implements
interface Object {
    toString(): String;
    ['+'](string: String): String;

    ['=='](object: Object): Boolean;

    ['!='](object: Object): Boolean;
}

interface String extends Object {
    toString(): String;

    ['+'](): String;

    ['=='](object: Object): Boolean;

    ['!='](object: Object): Boolean;
}

interface Boolean extends Object {
    ['&&'](b: Boolean): Boolean;

    ['||'](b: Boolean): Boolean;

    ['!'](b: Boolean): Boolean;
}

interface Number extends Object {
    ['+'](d: double): double;

    ['-'](d: double): double;

    ['*'](d: double): double;

    ['/'](d: double): double;


    ['+='](d: double): double;

    ['-='](d: double): double;

    ['*='](d: double): double;

    ['/='](d: double): double;


    ['+'](i: int): int;

    ['-'](i: int): int;

    ['*'](i: int): int;

    ['/'](i: int): int;


    ['+='](i: int): int;

    ['-='](i: int): int;

    ['*='](i: int): int;

    ['/='](i: int): int;


    ['>>'](i: int): int;

    ['>>='](i: int): int;

    ['<<'](i: int): int;

    ['<<='](i: int): int;

    ['>>>'](i: int): int;

    ['>>>='](i: int): int;

    ['<<<'](i: int): int;

    ['<<<='](i: int): int;


    ['&'](i: int): int;

    ['&='](i: int): int;

    ['|'](i: int): int;

    ['|='](i: int): int;

    ['~'](i: int): int;

    ['~='](i: int): int;

    ['^'](i: int): int;

    ['^='](i: int): int;
}
interface int extends Number {

}

interface BigInt extends Object {
    ['+'](d: double): double;

    ['-'](d: double): double;

    ['*'](d: double): double;

    ['/'](d: double): double;


    ['+='](d: double): double;

    ['-='](d: double): double;

    ['*='](d: double): double;

    ['/='](d: double): double;


    ['+'](i: int): double;

    ['-'](i: int): double;

    ['*'](i: int): double;

    ['/'](i: int): double;


    ['+='](i: int): double;

    ['-='](i: int): double;

    ['*='](i: int): double;

    ['/='](i: int): double;


    ['>>'](i: int): double;

    ['>>='](i: int): double;

    ['<<'](i: int): double;

    ['<<='](i: int): double;

    ['>>>'](i: int): double;

    ['>>>='](i: int): double;

    ['<<<'](i: int): double;

    ['<<<='](i: int): double;


    ['&'](i: int): double;

    ['&='](i: int): double;

    ['|'](i: int): double;

    ['|='](i: int): double;

    ['~'](i: int): double;

    ['~='](i: int): double;

    ['^'](i: int): double;

    ['^='](i: int): double;

}

interface double extends BigInt {}
