//==============//
//     Type    //
//=============//
const { toCamel } = require("./utils.js");
const { readConfig } = require("../config");
const global = require('./global.js');

const config = readConfig();

class Type {
    moduleFullName;

    members = new Map();

    declaration;

    constructor(moduleFullName) {
        this.moduleFullName = moduleFullName;
    }

    get type() {
        return this;
    }

    getText() {

    }
}

/// single type
class BaseType extends Type {
    text = '';

    constructor(moduleFullName, text) {
        super(moduleFullName);
        this.text = text;
    }

    getText() {
        return this.text;
    }
}

/// basic type: int, double, boolean, String
/// no need to import
class PrimitiveType extends BaseType {

    constructor(text) {
        super(undefined, text);
    }
}

/// support generic type
class GenericType extends BaseType {
    __typeName;
    typeParameters = [];

    get typeName() {
        return this.__typeName;
    }

    set typeName(value) {
        this.__typeName = value;
    }

    constructor(moduleFullName, typeName) {
        super(moduleFullName);
        this.__typeName = typeName;
    }

    getRuntime(typeParameters) {
        return this;
    }

    getText() {
        if (!this.text) {
            let code = '';
            if (this.typeParameters.length > 0) {
                let typeParameterCode = '';
                for (let typeParameter of this.typeParameters) {
                    if (typeParameterCode) {
                        typeParameterCode += ', ';
                    }
                    typeParameterCode += typeParameter.getText();
                }
                code += `<${typeParameterCode}>`;
            }
            this.text = this.typeName + code;
        }
        return this.text;
    }
}

/// object type: class
class ClassType extends GenericType {
    members = new Map();
    constructor(moduleFullName, typeName, members = new Map()) {
        super(moduleFullName, typeName);
        members.forEach((key, value) => this.members.set(key, value));
    }

    getRuntime(typeArguments) {
        if (typeArguments || typeArguments.length) {
            const classType = new ClassType(this.moduleFullName, this.typeName, this.members);
            classType.typeParameters = typeArguments;
            return classType;
        }
        return this;
    }
}

/// function type: FunctionStringReturnVoid
class FunctionType extends GenericType {
    parameters = [];

    returnType;

    constructor(parameters = [], returnType) {
        super();
        this.parameters = parameters;
        this.returnType = returnType;
    }

    getRuntime(typeParameters) {
        if (typeParameters || typeParameters.length) {
            const functionType = new FunctionType(this.parameters, this.returnType);
            functionType.typeParameters = typeParameters;
            return functionType;
        }
        return this;
    }

    get typeName() {
        if (!this.__typeName) {
            let code = 'Function';
            for (let parameter of this.parameters) {
                if (!parameter) continue;
                const typeString = parameter.getText();
                code += toCamel(typeString);
            }
            code += 'Return' + toCamel(this.returnType.getText());
            this.__typeName = code;
            this.moduleFullName = `${config.java.package}.FunctionInterface.${this.__typeName}`;
        }
        return this.__typeName;
    }
}

/// like ArrayList<String>, FunctionStringReturnVoid<String>
class ExtensionType extends Type {
    rawType;

    constructor(rawType) {
        super(rawType.moduleFullName);
        this.rawType = rawType;
    }

    get type() {
        return this.rawType.type;
    }
}

/// like T of List<T extends String>
class GenericParameter extends ExtensionType {
    typeName;// T
    extendsConstraint = ObjectType; // T extends String
    superConstraint;// T super String,

    constructor(typeName, extendsConstraint, superConstraint, rawType) {
        super(rawType);
        this.typeName = typeName;
        if (extendsConstraint) {
            this.extendsConstraint = extendsConstraint;
        }
        if (superConstraint) {
            this.superConstraint = superConstraint;
        }
    }

    get type() {
        return this.rawType? this.rawType.type : this.extendsConstraint;
    }
    getText() {
        if (!this.type) {
            if (this.superConstraint) {
                this.text = this.typeName + ' super ' + this.superConstraint.getText();
            } else
            if (this.extendsConstraint !== ObjectType) {
                this.text = this.typeName + ' extends ' + this.extendsConstraint.getText();
            } else {
                this.text = this.typeName;
            }
        }
        return this.text;
    }
}

/// like T in List<T extends String>
class TypeVariable extends ExtensionType {
    typeName;// T
    constructor(typeName, rawType) {
        if (rawType instanceof GenericType) {
            super(rawType);
            this.typeName = typeName;
        }
        throw new TypeError(`${typeName} must be GenericType.`);
    }

    get type() {
        return this.rawType.typeParameters.find(typeParameter => typeParameter.typeName === this.typeName);
    }

    getText() {
        if (!this.text) {
            this.text = this.typeName;
        }
        return this.text;
    }
}

// fun(int a=0, double... b)
class TypeParameter extends ExtensionType {
    defaultValue;

    constructor(rawType, defaultValue) {
        super(rawType);
        this.defaultValue = defaultValue;
    }

}

/// String[], String... args
class ArrayType extends Type {
    isDotDotDot = false;
    elementType;

    constructor(elementType) {
        super(elementType.moduleFullName);
        this.elementType = elementType;
    }

    getText() {
        if (!this.text) {
            if (this.isDotDotDot) {
                this.text = this.elementType.getText() + '...';
            } else {
                this.text = this.elementType.getText() + '[]';
            }
        }
        return this.text;
    }
}


const VoidType = new PrimitiveType('void');
const BooleanType = new PrimitiveType('boolean');
const NumberType = new PrimitiveType('number');
const IntType = new PrimitiveType('int');
const DoubleType = new PrimitiveType('double');
const BigintType = new PrimitiveType('bigint');
const StringType = new PrimitiveType('string');
const ObjectType = new PrimitiveType('Object');

// noinspection JSUnresolvedFunction
global.set(VoidType.text, VoidType)
    .set(BooleanType.text, BooleanType)
    .set(NumberType.text, NumberType)
    .set(IntType.text, IntType)
    .set(DoubleType.text, DoubleType)
    .set(BigintType.text, BigintType)
    .set(StringType.text, StringType)
    .set(ObjectType.text, ObjectType)
;

module.exports = {
    Type,
    BaseType,
    PrimitiveType,
    ClassType,
    FunctionType,
    ExtensionType,
    GenericParameter,
    GenericType,
    TypeVariable,
    TypeParameter,
    ArrayType,
    VoidType,
    BooleanType,
    NumberType,
    BigintType,
    StringType,
    IntType,
    DoubleType,
    ObjectType,
};
