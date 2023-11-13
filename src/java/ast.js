//=============//
//    print    //
//=============//
const {
    ClassType,
    FunctionType,
    VoidType,
    IntType,
    DoubleType,
    typeFinder,
} = require("./type");
const { PrintOptions, Printer } = require('./printer');
const { BooleanType, StringType } = require("./type");
const global = require("./global");

//============//
//  ASTNode  //
//===========//

class Closure {
    // javaModule
    module;
    // astNode
    parent;
    // <string, Declaration | Type>
    variables = new Map();

    constructor(parent) {
        this.parent = parent;
    }

    // Declaration | Type
    get(name) {
        const compileUtils = this.module.project.compileUtils;
        return compileUtils.getVariable(this, name);
    }

    // boolean
    has(name) {
        return this.variables.has(name);
    }

    // boolean
    isTop() {
        return !this.parent;
    }

    set(name, declaration) {
        const compileUtils = this.module.project.compileUtils;
        compileUtils.setVariable(this, name, declaration);
    }

    var(name, declaration) {
        const compileUtils = this.module.project.compileUtils;
        compileUtils.newVariable(this, name, declaration);
    }

    // Declaration | Type
    local(name) {
        return this.variables.get(name);
    }

    replace(oldName, valueName, declaration) {
        if (oldName) {
            this.variables.remove(oldName);
        }
        this.variables.put(valueName, declaration);
    }
}

exports.Closure = Closure;
//==============//
//   ASTNode   //
//=============//
class ASTNode {
    // javaModule
    module;
    // Closure
    closure;
    // ASTNode
    parent;
    // string
    kind;
    // number
    pos;
    // number
    end;
    // string
    __fullName;

    get fullName() {
        return this.__fullName;
    }

    set fullName(fullName) {
        this.__fullName = fullName;
    }

    constructor(parent, pos, end) {
        this.parent = parent;
        this.pos = pos;
        this.end = end;
        if (parent) {
            this.module = parent.module;
        }
        this.kind = this.constructor.toString().match(/^class\s+(\w+)/)[1];
    }

    // Printer
    createPrinter() {
        return new Printer(this.module.printOptions);
    }

    // string
    getText() {
    }

    forEachChild(cb) {

    }

    applyClosure() {
        const compileUtils = this.module.project.compileUtils;
        const parentClosure = compileUtils.getClosureFromNode(this.parent);
        this.closure = new Closure(parentClosure);
        this.closure.module = this.module;
    }

}

exports.ASTNode = ASTNode;

// NamedEntity: Identifier | PropertyAccessExpression | QualifiedName

class NamedEntity extends ASTNode {
    // Type
    initialType;
    // Type
    inferType;

    // ASTNode
    initialValue;

    get type() {
        return this.initialType || this.inferType;
    }

    constructor(parent, pos, end) {
        super(parent, pos, end);
    }

    // (ASTNode):void;
    replaceWith;
}

exports.NamedEntity = NamedEntity;

// declaration: JavaModule | ClassDeclaration | ConstructorDeclaration | PropertyDeclaration | MethodDeclaration | VariableDeclaration | ParameterDeclaration
class Declaration extends ASTNode {
    // boolean
    isFinal;

    // identifier
    __name;

    // Type
    initialType;
    // Type
    inferType;

    // ASTNode
    initialValue;

    get type() {
        return this.initialType || this.inferType;
    }

    get name() {
        return this.__name;
    }

    set name(name) {
        if (this.__name !== name) {
            if (this.__name) {
                this.refs.delete(this.__name);
            }
            this.refs.add(name);

            name.replaceWith = (newNode) => {
                if (newNode instanceof Identifier) {
                    this.name = newNode;
                }
                throw new TypeError(`${this.kind}.replaceWith() called must be a Identifier.`)
            }
        }
        this.__name = name;
    }

    // { identifier }
    refs = new Set();

    exportName;

    constructor(parent, name, pos, end) {
        super(parent, pos, end);
        let id = name;
        if (typeof name === 'string') {
            id = new Identifier(this, name, pos, end);
        }
        this.name = id;
    }

}

exports.Declaration = Declaration;


class Project {
    // Map
    moduleMap = new Map();

    // JavaModule
    functionInterface;

    compileUtils;

}

exports.Project = Project;
//==============//
// Declaration //
//=============//
class ClassDeclaration extends Declaration {
    accessor;// 'public' | 'private' | 'protected'
    isStatic;

    members = new Map();

    staticBlock;

    constructors = [];

    constructor(parent, text, pos, end) {
        super(parent, text, pos, end);

        if (parent) {
            this.fullName = parent.fullName + '.' + text;
            this.inferType = new ClassType(this.fullName, text);

            this.staticBlock = new ClassStaticBlockDeclaration(parent);


            this.staticBlock.applyClosure();

            this.applyClosure();
            this.closure.var('this', this);
            this.closure.var(text, this);
        }
    }

    set name(name) {
        const oldName = this.__name;
        if (oldName !== name) {
            let oldText = undefined;
            if (oldName) {
                oldText = oldName.text;
                this.refs.remove(oldName);
                this.members.remove(oldText);
            }
            this.refs.add(name);
            if (this.members) {
                this.members.set(name.text, this);
            }
            if (this.inferType) {
                this.inferType.text = oldText;
            }
            if (this.closure) {
                this.closure.replace(oldText, name.text, this);
            }

            name.replaceWith = (newNode) => {
                if (newNode instanceof Identifier) {
                    this.name = newNode;
                }
                throw new TypeError(`${this.kind}.replaceWith() called must be a Identifier.`)
            }
        }
        this.__name = name;
    }

    addMember(member) {
        this.members.set(member.name.text, member);
        this.inferType.members.set(member.name.text, member.type);
        this.closure.var(member.name.text, member);
    }

    forEachChild(cb) {
        cb(this.staticBlock);
        this.members.forEach(node => cb(node));
    }

    getText() {
        const printer = this.createPrinter();
        printer.writeModifiers(this);

        printer.write('class');

        printer.write(this.name.getText());

        printer.write('{');

        printer.increaseIndent();
        const staticBlockCode = this.staticBlock.getText();
        if (staticBlockCode) {
            printer.writeln(staticBlockCode);
        }

        for (let [_, member] of this.members) {
            printer.writeln(member.getText());
        }
        printer.decreaseIndent();

        if (staticBlockCode || this.members.size) {
            printer.writeln('}');
        } else {
            printer.code('}');
        }

        return printer.getText();
    }
}

exports.ClassDeclaration = ClassDeclaration;

class InterfaceDeclaration extends Declaration {
    accessor;// 'public' | 'private' | 'protected'
    isStatic;

    members = new Map();

    constructor(parent, name, pos, end) {
        super(parent, pos, end);
        this.name = name;

        const moduleFullName = this.module ? this.module.fullName : null;
        this.inferType = new VariableType(moduleFullName, name);

        this.applyClosure();
        this.closure.var('this', this);
        this.closure.var(name.text, this);

        this.fullName = parent.fullName + '.' + name.text;
    }

    addMember(member) {
        this.members.set(member.name.text, member);
        this.inferType.members.set(member.name.text, member.type);
        this.closure.var(member.name.text, member);
    }

    forEachChild(cb) {
        cb(this.staticBlock);
        this.members.forEach(node => cb(node));
    }

    getText() {
        const printer = this.createPrinter();
        printer.writeModifiers(this);

        printer.write('interface');

        printer.write(this.name.getText());

        printer.write('{');

        printer.increaseIndent();
        for (let [_, member] of this.members) {
            printer.writeln(member.getText());
            printer.code(';');
        }
        printer.decreaseIndent();
        printer.writeln('}');

        return printer.getText();
    }
}

exports.InterfaceDeclaration = InterfaceDeclaration;

class MemberDeclaration extends Declaration {
    accessor;// 'public' | 'private' | 'protected'
    isStatic;

    constructor(parent, name, pos, end) {
        super(parent, name, pos, end);
    }
}

exports.MemberDeclaration = MemberDeclaration;


class JavaModule extends ClassDeclaration {
    project;
    imports = new Set();
    packageName;

    namedBindings = new Map();
    fileName;

    printOptions = new PrintOptions();

    isResolved = false;

    constructor(project, fileName, packageName, name, pos, end) {
        super(null, name, pos, end);
        this.fileName = fileName;
        this.packageName = packageName;
        this.fullName = packageName + '.' + name;
        this.inferType = new ClassType(this.fullName, name);

        this.module = this;
        this.project = project;

        this.staticBlock = new ClassStaticBlockDeclaration(this);
        this.staticBlock.applyClosure();

        this.applyClosure();
        this.closure.var('this', this);
        this.closure.var(name, this);

        this.accessor = 'public';
    }

    forEachChild(cb) {
        cb(this.defaultClass);
        this.members.forEach(node => cb(node));
    }

    getText() {
        const printer = this.createPrinter();

        printer.writeln(`package ${this.packageName};`);
        printer.writeln();

        let hasImport = false;
        for (let importModule of this.imports) {
            printer.writeln(`import ${importModule};`);
            hasImport = true;
        }
        if (hasImport) {
            printer.writeln();
        }

        const classSection = super.getText();
        printer.writeln(classSection);

        return printer.getText();
    }
}

exports.JavaModule = JavaModule;

class Identifier extends NamedEntity {
    text;

    declaration;

    get type() {
        return this.declaration.type;
    }

    constructor(parent, text, pos, end) {
        super(parent, pos, end);
        this.text = text;
    }

    getText() {
        return this.text;
    }
}

exports.Identifier = Identifier;

class ImportDeclaration extends ASTNode {
    moduleNamedBindings = new Set();
    propertyNamedBindings = {};
    modulePackage;

    constructor(parent, pos, end) {
        super(parent, pos, end);
    }
}

exports.ImportDeclaration = ImportDeclaration;

class PropertyDeclaration extends MemberDeclaration {
    __initializer;

    get initializer() {
        return this.__initializer;
    }

    set initializer(value) {
        this.__initializer = value;
        if (value) {
            const valueType = value.type;
            if (valueType) {
                this.inferType = valueType;
            }

            if (value instanceof NamedEntity) {
                value.replaceWith = (newNode) => {
                    this.__initializer = newNode;
                }
            }
        }
    }

    constructor(parent, name, pos, end) {
        super(parent, name, pos, end);
        this.fullName = parent.fullName + '.' + name;
    }


    forEachChild(cb) {
        cb(this.initializer);
    }

    getText() {
        const printer = this.createPrinter();
        printer.writeModifiers(this);

        printer.writeType(this.type, 'Object');

        printer.write(this.name.getText());

        if (this.initializer) {
            printer.write(this.initializer.getText(), ' = ');
        }
        printer.code(';');

        return printer.getText();
    }
}

exports.PropertyDeclaration = PropertyDeclaration;

function isFunction(node) {
    return 'returnType' in node
        && 'parameters' in node;

}

exports.isFunction = isFunction;

class ConstructorDeclaration extends MemberDeclaration {
    __initialReturnType;

    parameters = [];
    body;

    constructor(parent, pos, end) {
        super(parent, parent.name, pos, end);
        this.initialReturnType = parent.type;
        this.applyClosure();

        const moduleFullName = this.module ? this.module.fullName : null;
        this.inferType = new FunctionType(moduleFullName, this.typeParameters, this.initialReturnType);
    }

    addParameter(parameter) {
        this.parameters.push(parameter);
        this.typeParameters.push(parameter.type);
        this.closure.var(parameter.name.text, parameter);
    }

    get initialReturnType() {
        return this.__initialReturnType;
    }

    set initialReturnType(value) {
        this.__initialReturnType = value;
        this.inferType.returnType = this.returnType;
    }

    get returnType() {
        return this.initialReturnType || this.inferReturnType;
    }

    forEachChild(cb) {
        this.parameters.forEach(node => cb(node));
        cb(this.body);
    }

    getText() {
        const printer = this.createPrinter();

        printer.writeModifiers(this);

        printer.write(this.name.getText());

        printer.writeParams(this.parameters);

        printer.writeBody(this.body);

        return printer.getText();
    }
}

exports.ConstructorDeclaration = ConstructorDeclaration;

class MethodDeclaration extends MemberDeclaration {
    __initialReturnType;
    __inferReturnType = VoidType;

    parameters = [];
    body;

    constructor(parent, name, pos, end) {
        super(parent, name, pos, end);
        this.applyClosure();

        const moduleFullName = this.module ? this.module.fullName : null;
        this.inferType = new FunctionType(moduleFullName, this.typeParameters, this.initialReturnType);
    }

    addParameter(parameter) {
        this.parameters.push(parameter);
        this.typeParameters.push(parameter.type);
        this.closure.var(parameter.name, parameter);
    }

    get inferReturnType() {
        return this.__inferReturnType;
    }

    set inferReturnType(inferReturnType) {
        this.__inferReturnType = inferReturnType;
        this.inferType.returnType = this.returnType;
    }

    get initialReturnType() {
        return this.__initialReturnType;
    }

    set initialReturnType(value) {
        this.__initialReturnType = value;
        this.inferType.returnType = this.returnType;
    }

    get returnType() {
        return this.initialReturnType || this.inferReturnType;
    }

    forEachChild(cb) {
        this.parameters.forEach(node => cb(node));
        cb(this.body);
    }

    getText() {
        const printer = this.createPrinter();

        printer.writeModifiers(this);

        printer.writeType(this.returnType);

        printer.write(this.name.getText());

        printer.writeParams(this.parameters);

        printer.writeBody(this.body);

        return printer.getText();
    }
}

exports.MethodDeclaration = MethodDeclaration;

class ParameterDeclaration extends Declaration {
    __initializer;

    get type() {
        const moduleFullName = this.module ? this.module.fullName : null;
        return new ParameterType(moduleFullName, super.type, this.initializer);
    }

    get initializer() {
        return this.__initializer;
    }

    set initializer(value) {
        this.__initializer = value;
        if (value) {
            const valueType = value.type;
            if (valueType) {
                this.inferType = valueType;
            }

            if (value instanceof NamedEntity) {
                value.replaceWith = (newNode) => {
                    this.__initializer = newNode;
                }
            }
        }
    }

    constructor(parent, name, pos, end) {
        super(parent, pos, end);
        this.name = name;
        if (parent.fullName) {
            this.fullName = parent.fullName + '.' + name.getText();
        }
    }


    forEachChild(cb) {
        cb(this.initializer);
    }

    getText() {
        const printer = this.createPrinter();

        printer.writeType(this.type);
        printer.write(this.name);

        // if (this.initializer) {
        //     const initializerCode = this.initializer.getText();
        //     if (initializerCode) {
        //         printer.write('=');
        //         printer.write(initializerCode);
        //     }
        // }

        return printer.getText();
    }
}

exports.ParameterDeclaration = ParameterDeclaration;

class VariableDeclaration extends Declaration {
    __initializer;

    get initializer() {
        return this.__initializer;
    }

    set initializer(value) {
        this.__initializer = value;
        if (value) {
            const valueType = value.type;
            if (valueType) {
                this.inferType = valueType;
            }
            if (value instanceof NamedEntity) {
                value.replaceWith = (newNode) => {
                    this.__initializer = newNode;
                }
            }
        }
    }

    constructor(parent, name, pos, end) {
        super(parent, pos, end);
        this.name = name;
        this.fullName = parent.fullName + '.' + name.getText();
    }

    forEachChild(cb) {
        cb(this.initializer);
    }

    getText() {
        const printer = this.createPrinter();

        printer.writeModifiers(this);

        printer.writeType(this.type, 'var');

        printer.write(this.name.getText());

        if (this.initializer) {
            const initializerCode = this.initializer.getText();
            if (initializerCode) {
                printer.write('=');
                printer.write(initializerCode);
            }
        }

        return printer.getText();
    }
}

exports.VariableDeclaration = VariableDeclaration;

class ClassStaticBlockDeclaration extends ASTNode {
    body;

    constructor(parent, pos, end) {
        super(parent, pos, end);
        this.body = new Block(parent);
        if (parent) {
            this.applyClosure();
        }
    }

    forEachChild(cb) {
        cb(this.body);
    }

    getText() {
        const printer = this.createPrinter();

        if (this.body.statements.length > 0) {
            printer.write('static');
            printer.write('{');
            printer.increaseIndent();
            const bodyCode = this.body.getText();
            if (bodyCode) {
                printer.writeln(bodyCode);
                printer.decreaseIndent();
                printer.writeln('}');
            } else {
                printer.decreaseIndent();
                printer.code('}');
            }
        }
        return printer.getText();
    }
}

exports.ClassStaticBlockDeclaration = ClassStaticBlockDeclaration;

class VariableDeclarationList extends ASTNode {

    declarations = [];

    constructor(parent, pos, end) {
        super(parent, pos, end);
    }

    forEachChild(cb) {
        this.declarations.forEach(node => cb(node));
    }

    getText() {
        const printer = this.createPrinter();

        for (let declaration of this.declarations) {
            const declarationCode = declaration.getText();
            printer.writeln(declarationCode);
        }

        return printer.getText();
    }
}

exports.VariableDeclarationList = VariableDeclarationList;

//==============//
//   Closure   //
//=============//
class Block extends ASTNode {
    inferReturnType = VoidType;
    statements = [];

    constructor(parent, pos, end) {
        super(parent, pos, end);
    }

    forEachChild(cb) {
        this.statements.forEach(node => cb(node));
    }

    get(name) {
        const compileUtils = this.module.project.compileUtils;
        return compileUtils.getClosureFromNode(this).get(name);
    }

    set(name, declaration) {
        const compileUtils = this.module.project.compileUtils;
        compileUtils.getClosureFromNode(this).set(name, declaration);
    }

    var(name, declaration) {
        const compileUtils = this.module.project.compileUtils;
        this.statements.push(declaration);
        compileUtils.getClosureFromNode(this).var(name, declaration);
    }

    getText() {
        const printer = this.createPrinter();
        for (let statement of this.statements) {
            const statementCode = statement.getText();
            if (statementCode) {
                printer.writeln(statementCode);
                if (statement instanceof IterationStatement ||
                    statement instanceof IfStatement ||
                    statement instanceof TryStatement) {

                } else {
                    printer.code(';');
                }
            }
        }
        return printer.getText();
    }
}

exports.Block = Block;

//==============//
//  Statement  //
//=============//
class Statement extends ASTNode {
    constructor(parent, pos, end) {
        super(parent, pos, end);
    }
}

exports.Statement = Statement;

class ExpressionStatement extends Statement {
    expression;

    constructor(parent, pos, end) {
        super(parent, pos, end);
    }
}

exports.ExpressionStatement = ExpressionStatement;

class ArrayLiteralExpression extends Statement {
    elements = [];

    constructor(parent, pos, end) {
        super(parent, pos, end);
    }

    addElement(element) {
        const index = this.elements.length;
        this.elements.push(element);

        if (element instanceof NamedEntity) {
            element.replaceWith = (newNode) => {
                this.elements[index] = newNode;
            }
        }
    }
}

exports.ArrayLiteralExpression = ArrayLiteralExpression;

class VariableStatement extends Statement {
    isDeclare;
    accessor;
    isStatic;
    declarationList;

    constructor(parent, pos, end) {
        super(parent, pos, end);
    }

    forEachChild(cb) {
        this.declarationList.forEach(node => cb(node));
    }

    getText() {
        return this.declarationList.getText();
    }
}

exports.VariableStatement = VariableStatement;

class NewExpression extends ASTNode {

    __expression;

    arguments = [];

    type;

    get expression() {
        return this.__expression;
    }

    set expression(value) {
        this.__expression = value;
        this.type = value.type;

        if (value instanceof NamedEntity) {
            value.replaceWith = (newNode) => {
                this.__expression = newNode;
            }
        }
    }

    constructor(parent, pos, end) {
        super(parent, pos, end);
    }

    addArgument(arg) {
        const index = this.arguments.length;
        this.arguments.push(arg);

        if (arg instanceof NamedEntity) {
            arg.replaceWith = (newNode) => {
                this.arguments[index] = newNode;
            }
        }
    }

    getText() {
        const printer = this.createPrinter();

        printer.write('new');
        printer.write(this.expression.getText());
        printer.writeArguments(this.arguments);

        return printer.getText();
    }
}

exports.NewExpression = NewExpression;

class IfStatement extends Statement {
    __expression;
    thenStatement;
    thenClosure;
    elseStatement;
    elseClosure;

    get expression() {
        return this.__expression;
    }

    set expression(value) {
        this.__expression = value;

        if (value instanceof NamedEntity) {
            value.replaceWith = (newNode) => {
                this.__expression = newNode;
            }
        }
    }

    constructor(parent, pos, end) {
        super(parent, pos, end);
        const compileUtils = this.module.project.compileUtils;
        const parentClosure = compileUtils.getClosureFromNode(this.parent);
        this.thenClosure = new Closure(parentClosure);
        this.thenClosure.module = this.module;

        this.elseClosure = new Closure(parentClosure);
        this.elseClosure.module = this.module;
    }

    forEachChild(cb) {
        cb(this.expression);
        cb(this.thenStatement);
        cb(this.elseStatement);
    }

    getText() {
        const printer = this.createPrinter();

        printer.write('if');
        printer.write('(');
        printer.code(this.expression.getText());
        printer.code(')');

        printer.writeBody(this.thenStatement);

        if (this.elseStatement) {
            printer.write('else');
            printer.write(this.elseStatement.getText());
        }

        return printer.getText();
    }
}

exports.IfStatement = IfStatement;

class IterationStatement extends Statement {
    statement;

    constructor(parent, pos, end) {
        super(parent, pos, end);
        this.applyClosure();
    }

    forEachChild(cb) {
        cb(this.statement);
    }
}

exports.IterationStatement = IterationStatement;

class DoStatement extends IterationStatement {
    __expression;

    get expression() {
        return this.__expression;
    }

    set expression(value) {
        this.__expression = value;
        if (value instanceof NamedEntity) {
            value.replaceWith = (newNode) => {
                this.__expression = newNode;
            }
        }
    }

    constructor(parent, pos, end) {
        super(parent, pos, end);
    }

    forEachChild(cb) {
        cb(this.expression);
        super.forEachChild(cb);
    }
}

exports.DoStatement = DoStatement;

class WhileStatement extends IterationStatement {
    __expression;

    get expression() {
        return this.__expression;
    }

    set expression(value) {
        this.__expression = value;
        if (value instanceof NamedEntity) {
            value.replaceWith = (newNode) => {
                this.__expression = newNode;
            }
        }
    }

    constructor(parent, pos, end) {
        super(parent, pos, end);
    }

    forEachChild(cb) {
        cb(this.expression);
        super.forEachChild(cb);
    }
}

exports.WhileStatement = WhileStatement;

class ForStatement extends IterationStatement {
    __initializer;
    __condition;
    __incrementor;

    get initializer() {
        return this.__initializer;
    }

    set initializer(value) {
        this.__initializer = value;
        if (value instanceof NamedEntity) {
            value.replaceWith = (newNode) => {
                this.__initializer = newNode;
            }
        }
    }

    get condition() {
        return this.__condition;
    }

    set condition(value) {
        this.__condition = value;
        if (value instanceof NamedEntity) {
            value.replaceWith = (newNode) => {
                this.__condition = newNode;
            }
        }
    }

    get incrementor() {
        return this.__incrementor;
    }

    set incrementor(value) {
        this.__incrementor = value;
        if (value instanceof NamedEntity) {
            value.replaceWith = (newNode) => {
                this.__incrementor = newNode;
            }
        }
    }

    constructor(parent, pos, end) {
        super(parent, pos, end);
    }

    forEachChild(cb) {
        cb(this.initializer);
        cb(this.condition);
        cb(this.incrementor);
        super.forEachChild(cb);
    }

    getText() {
        const printer = this.createPrinter();

        printer.write('for');
        printer.write('(');
        printer.code(this.initializer.getText());
        printer.code(';');
        printer.code(this.condition.getText());
        printer.code(';');
        printer.code(this.incrementor.getText());
        printer.code(')');
        printer.writeBody(this.statement);

        return printer.getText();
    }
}

exports.ForStatement = ForStatement;

class ForInStatement extends IterationStatement {
    __initializer;
    __expression;

    get initializer() {
        return this.__initializer;
    }

    set initializer(value) {
        this.__initializer = value;
        if (value instanceof NamedEntity) {
            value.replaceWith = (newNode) => {
                this.__initializer = newNode;
            }
        }
    }

    get expression() {
        return this.__expression;
    }

    set expression(value) {
        this.__expression = value;
        if (value instanceof NamedEntity) {
            value.replaceWith = (newNode) => {
                this.__expression = newNode;
            }
        }
    }

    constructor(parent, pos, end) {
        super(parent, pos, end);
    }

    forEachChild(cb) {
        cb(this.initializer);
        cb(this.expression);
        super.forEachChild(cb);
    }

    getText() {
        const printer = this.createPrinter();

        printer.write('for');
        printer.write('(');
        printer.code(this.initializer.getText());
        printer.code(':');
        let expression = this.expression.getText();
        printer.code(expression);
        printer.code('.keySet()');
        printer.code(')');
        printer.writeBody(this.statement);

        return printer.getText();
    }
}

exports.ForInStatement = ForInStatement;

class ForOfStatement extends IterationStatement {
    __initializer;
    __expression;

    get initializer() {
        return this.__initializer;
    }

    set initializer(value) {
        this.__initializer = value;
        if (value instanceof NamedEntity) {
            value.replaceWith = (newNode) => {
                this.__initializer = newNode;
            }
        }
    }

    get expression() {
        return this.__expression;
    }

    set expression(value) {
        this.__expression = value;
        const valueType = value.type;
        if (this.initializer && valueType && valueType.elementType) {
            this.initializer.inferType = valueType.elementType;
        }
        if (value instanceof NamedEntity) {
            value.replaceWith = (newNode) => {
                this.__expression = newNode;
            }
        }
    }

    constructor(parent, pos, end) {
        super(parent, pos, end);
    }

    forEachChild(cb) {
        cb(this.initializer);
        cb(this.expression);
        super.forEachChild(cb);
    }

    getText() {
        const printer = this.createPrinter();

        printer.write('for');
        printer.write('(');
        printer.code(this.initializer.getText());
        printer.code(':');
        printer.code(this.expression.getText());
        printer.code(')');
        printer.writeBody(this.statement);

        return printer.getText();
    }
}

exports.ForOfStatement = ForOfStatement;

class BreakStatement extends Statement {
    label;

    constructor(parent, pos, end) {
        super(parent, pos, end);
    }

}

exports.BreakStatement = BreakStatement;

class ContinueStatement extends Statement {
    label;

    constructor(parent, pos, end) {
        super(parent, pos, end);
    }
}

exports.ContinueStatement = ContinueStatement;


class ReturnStatement extends Statement {
    __expression;

    get expression() {
        return this.__expression;
    }

    set expression(value) {
        this.__expression = value;
        if (value instanceof NamedEntity) {
            value.replaceWith = (newNode) => {
                this.__expression = newNode;
            }
        }
    }

    constructor(parent, pos, end) {
        super(parent, pos, end);
    }

    forEachChild(cb) {
        cb(this.expression);
    }

    getText() {
        const printer = this.createPrinter();

        printer.write('return');

        if (this.expression) {
            const expressionCode = this.expression.getText();
            if (expressionCode) {
                printer.write(expressionCode);
            }
        }
        return printer.getText();
    }
}

exports.ReturnStatement = ReturnStatement;

class SwitchStatement extends Statement {
    __expression;
    caseBlock;
    possiblyExhaustive;

    get expression() {
        return this.__expression;
    }

    set expression(value) {
        this.__expression = value;
        if (value instanceof NamedEntity) {
            value.replaceWith = (newNode) => {
                this.__expression = newNode;
            }
        }
    }

    constructor(parent, pos, end) {
        super(parent, pos, end);
    }

    forEachChild(cb) {
        cb(this.expression);
    }
}

exports.SwitchStatement = SwitchStatement;

class CaseBlock extends ASTNode {
    clauses = [];

    constructor(parent, pos, end) {
        super(parent, pos, end);
    }

    forEachChild(cb) {
        cb(this.clauses);
    }
}

exports.CaseBlock = CaseBlock;

class CaseClause extends ASTNode {
    __expression;
    statements = [];

    get expression() {
        return this.__expression;
    }

    set expression(value) {
        this.__expression = value;
        if (value instanceof NamedEntity) {
            value.replaceWith = (newNode) => {
                this.__expression = newNode;
            }
        }
    }

    constructor(parent, pos, end) {
        super(parent, pos, end);
        this.applyClosure();
    }

    forEachChild(cb) {
        cb(this.expression);
        this.statements.forEach(node => cb(node));
    }
}

exports.CaseClause = CaseClause;

class DefaultClause extends ASTNode {
    statements;

    constructor(parent, pos, end) {
        super(parent, pos, end);
        this.applyClosure();
    }
}

exports.DefaultClause = DefaultClause;

class ThrowStatement extends Statement {
    __expression;

    get expression() {
        return this.__expression;
    }

    set expression(value) {
        this.__expression = value;
        if (value instanceof NamedEntity) {
            value.replaceWith = (newNode) => {
                thisthis.__expression = newNode;
            }
        }
    }

    constructor(parent, pos, end) {
        super(parent, pos, end);
    }

    forEachChild(cb) {
        cb(this.expression);
    }

    getText() {
        return 'throw ' + this.expression.getText();
    }
}

exports.ThrowStatement = ThrowStatement;

class TryStatement extends Statement {
    tryBlock;
    tryClosure;
    catchClause;
    catchClosure;
    finallyBlock;
    finallyClosure;

    constructor(parent, pos, end) {
        super(parent, pos, end);

        if (parent) {
            const compileUtils = this.module.project.compileUtils;
            const parentClosure = compileUtils.getClosureFromNode(this.parent);
            this.tryClosure = new Closure(parentClosure);
            this.tryClosure.module = this.module;

            this.catchClosure = new Closure(parentClosure);
            this.catchClosure.module = this.module;

            this.finallyClosure = new Closure(parentClosure);
            this.finallyClosure.module = this.module;
        }
    }

    forEachChild(cb) {
        cb(this.tryBlock);
        cb(this.catchClause);
        cb(this.finallyBlock);
    }
}

exports.TryStatement = TryStatement;

class CatchClause extends ASTNode {
    variableDeclaration;
    block;

    constructor(parent, pos, end) {
        super(parent, pos, end);
    }

    forEachChild(cb) {
        cb(this.variableDeclaration);
        cb(this.block);
    }
}

exports.CatchClause = CatchClause;

//==============//
//  Statement  //
//=============//
class Expression extends ASTNode {
    constructor(parent, pos, end) {
        super(parent, pos, end);
    }
}

exports.Expression = Expression;

class ClassExpression extends ClassDeclaration {

    constructor(parent, name, pos, end) {
        super(parent, name, pos, end);
    }
}

exports.ClassExpression = ClassExpression;

class BinaryExpression extends Expression {
    __left;
    operator;
    __right;

    get left() {
        return this.__left;
    }

    set left(value) {
        this.__left = value;
        if (value instanceof NamedEntity) {
            value.replaceWith = (newNode) => {
                this.__left = newNode;
            }
        }
    }

    get right() {
        return this.__right;
    }

    set right(value) {
        this.__right = value;
        if (value instanceof NamedEntity) {
            value.replaceWith = (newNode) => {
                this.__right = newNode;
            }
        }
    }

    get type() {
        const leftType = this.left.type;
        const rightType = this.right.type;

        if (leftType === StringType || rightType === StringType) {
            return StringType;
        } else if (leftType === DoubleType || rightType === DoubleType) {
            return DoubleType;
        } else if (leftType === IntType || rightType === IntType) {
            return IntType;
        } else if (leftType === BooleanType || rightType === BooleanType) {
            return BooleanType;
        }
    }

    constructor(parent, pos, end) {
        super(parent, pos, end);
    }

    forEachChild(cb) {
        cb(this.left);
        cb(this.right);
    }

    getText() {
        const printer = this.createPrinter();

        printer.write(this.left.getText());

        printer.write(this.operator);

        printer.write(this.right.getText());

        return printer.getText();
    }
}

exports.BinaryExpression = BinaryExpression;

/// 3 * (1+2)
class ParenthesizedExpression extends Expression {
    __expression;


    get expression() {
        return this.__expression;
    }

    set expression(value) {
        this.__expression = value;
        if (value instanceof NamedEntity) {
            value.replaceWith = (newNode) => {
                this.__expression = newNode;
            }
        }
    }

    constructor(parent, pos, end) {
        super(parent, pos, end);
    }
}

exports.ParenthesizedExpression = ParenthesizedExpression;

/// () -> {}
class LambdaFunction extends ASTNode {
    __initialReturnType;
    __inferReturnType = VoidType;

    arguments = [];
    body;

    constructor(parent, pos, end) {
        super(parent, pos, end);
        this.applyClosure();

        const moduleFullName = this.module ? this.module.fullName : null;
        this.inferType = new FunctionType(moduleFullName, this.typeParameters, this.initialReturnType);
    }

    addArgument(arg) {
        const index = this.arguments.length;
        this.arguments.push(arg);
        this.typeParameters.push(arg.type);
        this.closure.var(arg.name, arg);
        if (arg instanceof NamedEntity) {
            arg.replaceWith = (newNode) => {
                this.arguments[index] = newNode;
            }
        }
    }

    get inferReturnType() {
        return this.__inferReturnType;
    }

    set inferReturnType(inferReturnType) {
        this.__inferReturnType = inferReturnType;
        this.inferType.returnType = this.returnType;
    }

    get initialReturnType() {
        return this.__initialReturnType;
    }

    set initialReturnType(value) {
        this.__initialReturnType = value;
        this.inferType.returnType = this.returnType;
    }

    forEachChild(cb) {
        this.arguments.forEach(node => cb(node));
        cb(this.body);
    }

    getText() {
        const printer = this.createPrinter();

        printer.writeParams(this.arguments);
        printer.write('->')
        printer.writeBody(this.body);

        return printer.getText();
    }
}

exports.LambdaFunction = LambdaFunction;

/// a? b: c
class ConditionalExpression extends Expression {
    __condition;
    __whenTrue;
    __whenFalse;

    get condition() {
        return this.__condition;
    }

    set condition(value) {
        this.__condition = value;
        if (value instanceof NamedEntity) {
            value.replaceWith = (newNode) => {
                this.__condition = newNode;
            }
        }
    }

    get whenTrue() {
        return this.__whenTrue;
    }

    set whenTrue(value) {
        this.__whenTrue = value;
        if (value instanceof NamedEntity) {
            value.replaceWith = (newNode) => {
                this.__whenTrue = newNode;
            }
        }
    }

    get whenFalse() {
        return this.__whenFalse;
    }

    set whenFalse(value) {
        this.__whenFalse = value;
        if (value instanceof NamedEntity) {
            value.replaceWith = (newNode) => {
                this.__whenFalse = newNode;
            }
        }
    }

    constructor(parent, pos, end) {
        super(parent, pos, end);
    }

    forEachChild(cb) {
        cb(this.condition);
        cb(this.whenTrue);
        cb(this.whenFalse);
    }
}

exports.ConditionalExpression = ConditionalExpression;

class PrefixUnaryExpression extends Expression {
    operator;
    __operand;

    get operand() {
        return this.__operand;
    }

    set operand(value) {
        this.__operand = value;
        if (value instanceof NamedEntity) {
            value.replaceWith = (newNode) => {
                this.__operand = newNode;
            }
        }
    }

    constructor(parent, pos, end) {
        super(parent, pos, end);
    }

    forEachChild(cb) {
        cb(this.operator);
        cb(this.operand);
    }

    getText() {
        const printer = this.createPrinter();

        printer.write(this.operator);
        printer.code(this.operand.getText());

        return printer.getText();
    }
}

exports.PrefixUnaryExpression = PrefixUnaryExpression;


class PostfixUnaryExpression extends Expression {
    operator;
    __operand;

    get operand() {
        return this.__operand;
    }

    set operand(value) {
        this.__operand = value;
        if (value instanceof NamedEntity) {
            value.replaceWith = (newNode) => {
                this.__operand = newNode;
            }
        }
    }

    constructor(parent, pos, end) {
        super(parent, pos, end);
    }

    forEachChild(cb) {
        cb(this.operator);
        cb(this.operand);
    }

    getText() {
        const printer = this.createPrinter();

        printer.write(this.operand.getText());
        printer.code(this.operator);

        return printer.getText();
    }
}

exports.PostfixUnaryExpression = PostfixUnaryExpression;

/**
 * expression(...arguments)
 */
class CallExpression extends Expression {
    __expression;
    typeArguments;
    arguments = [];

    get expression() {
        return this.__expression;
    }

    set expression(value) {
        this.__expression = value;
        if (value instanceof NamedEntity) {
            value.replaceWith = (newNode) => {
                this.__expression = newNode;
            }
        }
    }

    constructor(parent, pos, end) {
        super(parent, pos, end);
    }

    addArgument(arg) {
        const index = this.arguments.length;
        this.arguments.push(arg);

        if (arg instanceof NamedEntity) {
            arg.replaceWith = (newNode) => {
                this.arguments[index] = newNode;
            }
        }
    }

    forEachChild(cb) {
        cb(this.expression);
        this.parameters.forEach(node => cb(node));
    }

    getText() {
        const printer = this.createPrinter();

        printer.write(this.expression.getText());

        printer.writeArguments(this.arguments, this.expression.type);

        return printer.getText();
    }
}

exports.CallExpression = CallExpression;

/**
 * expression.name
 */
class PropertyAccessExpression extends NamedEntity {
    __expression;
    __name;

    get name() {
        return this.__name;
    }

    set name(value) {
        this.__name = value;
        if (value instanceof NamedEntity) {
            value.replaceWith = (newNode) => {
                this.__name = newNode;
            }
        }
    }

    get expression() {
        return this.__expression;
    }

    set expression(value) {
        this.__expression = value;
        if (value instanceof NamedEntity) {
            value.replaceWith = (newNode) => {
                this.__expression = newNode;
            }
        }
    }

    get type() {
        if (this.expression) {
            const expressionType = this.expression.type;
            return expressionType.members.get(this.name);
        } else {
            const compileUtils = this.module.project.compileUtils;
            const declaration = compileUtils.getClosureFromNode(this).get(name);
            return declaration.type;
        }
    }

    constructor(parent, pos, end) {
        super(parent, pos, end);
    }

    forEachChild(cb) {
        cb(this.expression);
    }

    getText() {
        const printer = this.createPrinter();

        printer.code(this.expression.getText());
        printer.code('.');
        printer.code(this.name.getText());

        return printer.getText();
    }
}

exports.PropertyAccessExpression = PropertyAccessExpression;

/**
 * const a: Map.entry;
 */
class QualifiedName extends NamedEntity {
    __left;
    __right;

    get left() {
        return this.__left;
    }

    set left(value) {
        this.__left = value;
        if (value instanceof NamedEntity) {
            value.replaceWith = (newNode) => {
                this.__left = newNode;
            }
        }
    }

    get right() {
        return this.__right;
    }

    set right(value) {
        this.__right = value;
        this.inferType = value.type;
        if (value instanceof NamedEntity) {
            value.replaceWith = (newNode) => {
                this.__right = newNode;
            }
        }
    }

    constructor(parent, pos, end) {
        super(parent, pos, end);
    }

    get type() {
        const printer = this.createPrinter();

        printer.code(this.left.getText());
        printer.code('.');
        printer.code(this.right.getText());

        return printer.getText();
    }
}

exports.QualifiedName = QualifiedName;

class TypeReference extends ASTNode {
    __typeName;

    typeArguments = [];

    __type;

    get typeName() {
        return this.__typeName;
    }

    set typeName(value) {
        this.__typeName = value;
        if (value instanceof NamedEntity) {
            value.replaceWith = (newNode) => {
                this.__typeName = newNode;
            }
        }
    }

    constructor(parent, pos, end) {
        super(parent, pos, end);
    }

    addArgument(arg) {
        const index = this.arguments.length;
        this.arguments.push(arg);

        if (arg instanceof NamedEntity) {
            arg.replaceWith = (newNode) => {
                this.arguments[index] = newNode;
            }
        }
    }

    get type() {
        if (!this.__type) {
            this.__type = this.typeName.type.getRuntime(this.typeArguments);
        }
        return this.__type;
    }

    getText() {
        return this.type.getText();
    }
}

exports.TypeReference = TypeReference;

/**
 * array[key]
 */
class ElementAccessExpression extends Expression {
    __expression;
    __argumentExpression;

    get expression() {
        return this.__expression;
    }

    set expression(value) {
        this.__expression = value;
        if (value instanceof NamedEntity) {
            value.replaceWith = (newNode) => {
                this.__expression = newNode;
            }
        }
    }

    get argumentExpression() {
        return this.__argumentExpression;
    }

    set argumentExpression(value) {
        this.__argumentExpression = value;
        if (value instanceof NamedEntity) {
            value.replaceWith = (newNode) => {
                this.__argumentExpression = newNode;
            }
        }
    }

    constructor(parent, pos, end) {
        super(parent, pos, end);
    }

    forEachChild(cb) {
        cb(this.expression);
        cb(this.argumentExpression);
    }
}

exports.ElementAccessExpression = ElementAccessExpression;

/**
 * { a: 1, b: 2 }
 */
class ObjectLiteralExpression extends Expression {
    properties;

    constructor(parent, pos, end) {
        super(parent, pos, end);
    }

    forEachChild(cb) {
        this.properties.forEach(node => cb(node));
    }
}

exports.ObjectLiteralExpression = ObjectLiteralExpression;

/**
 * a: 2
 */
class PropertyAssignment extends ASTNode {
    __name;
    __initializer;

    get name() {
        return this.__name;
    }

    set name(value) {
        this.__name = value;
        if (value instanceof NamedEntity) {
            value.replaceWith = (newNode) => {
                this.__name = newNode;
            }
        }
    }

    get initializer() {
        return this.__initializer;
    }

    set initializer(value) {
        this.__initializer = value;
        if (value instanceof NamedEntity) {
            value.replaceWith = (newNode) => {
                this.__initializer = newNode;
            }
        }
    }

    constructor(parent, pos, end) {
        super(parent, pos, end);
    }

    forEachChild(cb) {
        cb(this.initializer);
    }
}

exports.PropertyAssignment = PropertyAssignment;

//==============//
//  Statement  //
//=============//

class Literal extends ASTNode {
    type;
    text;

    constructor(parent, type, text, pos, end) {
        super(parent, pos, end);
        this.type = type;
        this.text = text;
    }


    getText() {
        return this.text;
    }
}

exports.Literal = Literal;

/// true

class TrueKeyword extends Literal {

    constructor(parent, pos, end) {
        super(parent, BooleanType, 'true', pos, end);
    }
}

exports.TrueKeyword = TrueKeyword;

/// false

class FalseKeyword extends Literal {

    constructor(parent, pos, end) {
        super(parent, BooleanType, 'false', pos, end);
    }
}

exports.FalseKeyword = FalseKeyword;

/// this.a

class ThisKeyword extends Literal {
    declaration;

    constructor(parent, pos, end) {
        const compileUtils = parent.module.project.compileUtils;
        const classNode = compileUtils.getClassFromNode(parent);
        super(parent, classNode.type, 'this', pos, end);

        this.declaration = classNode;
    }
}

exports.ThisKeyword = ThisKeyword;

/// a = 1;

class NumericLiteral extends Literal {
    constructor(parent, text, pos, end) {
        let type = IntType;
        if (text.indexOf('.') >= 0) {
            type = DoubleType;
        } else {
            text.replace(/n$/, '');
        }
        super(parent, type, text, pos, end);
    }
}

exports.NumericLiteral = NumericLiteral;

/// a = 1n;

class BigIntLiteral extends Literal {
    constructor(parent, text, pos, end) {
        super(parent, IntType, text.replace(/n$/, ''), pos, end);
    }
}

exports.BigIntLiteral = BigIntLiteral;

/// a = 'string';

class StringLiteral extends Literal {
    constructor(parent, text, pos, end) {
        super(parent, StringType, `"${text.replace(/\n/, '\\n')}"`, pos, end);
    }
}

exports.StringLiteral = StringLiteral;

/// /^\d{11}$/

class RegularExpressionLiteral extends Literal {
    constructor(parent, text, pos, end) {
        super(parent, typeFinder.get('Pattern'), `Pattern.compile("${text}")`, pos, end);
    }
}

exports.RegularExpressionLiteral = RegularExpressionLiteral;


