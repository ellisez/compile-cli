//=============//
//    print    //
//=============//
class Printer {
    compileUtils;
    #text = '';

    constructor(compileUtils) {
        this.compileUtils = compileUtils;
    }

    getText() {
        return this.#text;
    }

    code(code, pre = '') {
        if (code) {
            if (this.#text) {
                this.#text += pre;
            }
            this.#text += code;
        }
    }

    write(node, pre = ' ') {
        if (node) {
            let code = node.toString();
            if (node instanceof ASTNode) {
                code = node.getText();
            }
            this.code(code, pre);
        }
    }

    writeln(node) {
        const newLine = this.compileUtils.newLine;
        if (node) {
            this.write(node, newLine);
        } else {
            this.#text += newLine;
        }
    }

    writeType(type, defaultValue = '') {
        if (type) {
            this.write(type.getText());
            return;
        }
        this.write(defaultValue);
    }

    writeModifiers(member) {
        if (member.accessor) {
            this.write(member.accessor);
        }
        if (member.isStatic) {
            this.write('static');
        }
        if (member.isFinal) {
            this.write('final');
        }
    }

    writeParams(parameters) {
        const paramPrinter = new Printer();
        for (let parameter of parameters) {
            paramPrinter.write(parameter.getText(), ', ');
        }
        this.code('(');
        this.code(paramPrinter.getText());
        this.code(')');
    }

    writeBody(body) {
        if (body) {
            this.write('{');
            this.compileUtils.increaseIndent();
            const bodySegment = body.getText();
            if (body.statements.length) {
                this.writeln(bodySegment);
                this.compileUtils.decreaseIndent();
                this.writeln('}');
            } else {
                this.compileUtils.decreaseIndent();
                this.code('}');
            }
        }
    }

    writeArguments(args) {
        if (args) {
            const paramPrinter = new Printer();
            for (let arg of args) {
                paramPrinter.write(arg.getText(), ', ');
            }
            this.code('(');
            this.code(paramPrinter.getText());
            this.code(')');
        }
    }
}

//============//
//  ASTNode  //
//===========//
class Closure {
    module;

    parent;

    variables = {};

    constructor(parent) {
        this.parent = parent;
    }

    get(name) {
        const compileUtils = this.module.project.compileUtils;
        return compileUtils.getVariable(this, name);
    }

    has(name) {
        return this.variables.hasOwnProperty(name);
    }

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

    local(name) {
        return this.variables[name];
    }
}

class ASTNode {
    module;
    closure;
    parent;
    kind;
    pos;
    end;
    #fullName;

    get fullName() {
        return this.#fullName;
    }

    set fullName(fullName) {
        this.#fullName = fullName;
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

class Project {
    moduleMap = new Map();

    compileUtils;

}

//==============//
// Declaration //
//=============//
class Type {

    getText() {

    }
}
class NormalType extends Type {
    typeName;

    typeArguments = [];

    elementType;

    constructor(typeName, typeArguments= []) {
        super();
        this.typeName = typeName;
        this.typeArguments = typeArguments;
    }

    getText() {
        let code = this.typeName;
        if (this.typeArguments.length > 0) {
            let typeArgumentCode = '';
            for (let typeArgument of this.typeArguments) {
                if (typeArgumentCode) {
                    typeArgumentCode += ', ';
                }
                typeArgumentCode += typeArgument.getText();
            }
            code += `<${typeArgumentCode}>`;
        }
        return code;
    }
}
class ArrayType extends Type {
    elementType;

    constructor(elementType) {
        super();
        this.elementType = elementType;
    }

    getText() {
        return this.elementType + '[]';
    }
}

const VoidType = new NormalType('void');
const BooleanType = new NormalType('boolean');
const IntType = new NormalType('int');
const DoubleType = new NormalType('double');
const StringType = new NormalType('String');
const PatternType = new NormalType('Pattern');
//==============//
// Declaration //
//=============//
class Declaration extends ASTNode {
    isFinal;
    explicitType;
    implicitType;

    #name;

    get name() {
        return this.#name;
    }

    set name(name) {
        if (this.#name !== name) {
            for (let ref of this.refs) {
                ref.text = name;
            }
        }
        this.#name = name;
    }

    refs = [];

    constructor(parent, name, pos, end) {
        super(parent, pos, end);
        this.name = name;
    }

    get type() {
        return this.explicitType || this.implicitType;
    }

}

function isDeclaration(node) {
    return node instanceof Declaration;
}

class ClassDeclaration extends Declaration {
    accessor;// 'public' | 'private' | 'protected'
    isStatic;

    members = [];

    staticBlock;

    constructors = [];

    constructor(parent, name, pos, end) {
        super(parent, pos, end);
        this.name = name;
        this.explicitType = name;

        this.staticBlock = new ClassStaticBlockDeclaration(parent);

        if (parent) {
            this.staticBlock.applyClosure();

            this.applyClosure();
            this.closure.var('this', this);
            this.closure.var(name, this);
        }
    }

    addMember(member) {
        this.members.push(member);
        this.closure.var(member.name, member);
    }

    forEachChild(cb) {
        cb(this.staticBlock);
        this.members.forEach(node => cb(node));
    }

    getText() {
        const compileUtils = this.module.project.compileUtils;

        const printer = new Printer(compileUtils);
        printer.writeModifiers(this);

        printer.write('class');

        printer.write(this.name);

        printer.write('{');

        compileUtils.increaseIndent();
        const staticBlockCode = this.staticBlock.getText();
        if (staticBlockCode) {
            printer.writeln(staticBlockCode);
        }

        for (let member of this.members) {
            printer.writeln(member);
        }
        compileUtils.decreaseIndent();

        if (staticBlockCode || this.members.length) {
            printer.writeln('}');
        } else {
            printer.code('}');
        }

        return printer.getText();
    }
}

class MemberDeclaration extends Declaration {
    accessor;// 'public' | 'private' | 'protected'
    isStatic;

    constructor(parent, name, pos, end) {
        super(parent, name, pos, end);
    }
}

class JavaModule extends ClassDeclaration {
    project;
    imports = new Set();
    packageName;

    isResolved = false;
    fileName;

    constructor(project, fileName, packageName, name, pos, end) {
        super(null, name, pos, end);
        this.fileName = fileName;
        this.packageName = packageName;
        this.fullName = packageName + '.' + name;
        this.project = project;
        this.module = this;
        this.staticBlock.module = this;

        this.accessor = 'public';

        this.staticBlock.applyClosure();
        this.applyClosure(name);
        this.closure.var('this', this);
        this.closure.var(name, this);
    }

    forEachChild(cb) {
        cb(this.defaultClass);
        this.members.forEach(node => cb(node));
    }

    getText() {
        const compileUtils = this.module.project.compileUtils;
        const printer = new Printer(compileUtils);

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

class Identifier extends ASTNode {
    implicitType;
    text;

    declaration;

    constructor(parent, pos, end) {
        super(parent, pos, end);
    }

    getText() {
        return this.text;
    }
}

class ImportDeclaration extends ASTNode {
    moduleNamedBindings = new Set();
    propertyNamedBindings = {};
    modulePackage;

    constructor(parent, pos, end) {
        super(parent, pos, end);
    }
}

class PropertyDeclaration extends MemberDeclaration {
    #initializer;

    get initializer() {
        return this.#initializer;
    }

    set initializer(value) {
        this.#initializer = value;
        if (value) {
            const valueType = value.type;
            if (valueType) {
                this.implicitType = valueType;
            }
        }
    }

    constructor(parent, name, pos, end) {
        super(parent, pos, end);
        this.name = name;
        this.fullName = parent.fullName + '.' + name;
    }


    forEachChild(cb) {
        cb(this.initializer);
    }

    getText() {
        const compileUtils = this.module.project.compileUtils;
        const printer = new Printer(compileUtils);
        printer.writeModifiers(this);

        printer.writeType(this.type, 'Object');

        printer.write(this.name);

        if (this.initializer) {
            printer.write(this.initializer.getText(), ' = ');
        }
        printer.code(';');

        return printer.getText();
    }
}

function isFunction(node) {
    return 'returnType' in node
        && 'parameters' in node
        && 'typeParameters' in node;

}

class ConstructorDeclaration extends MemberDeclaration {
    explicitReturnType;
    implicitReturnType = VoidType;
    typeParameters = [];
    parameters = [];
    body;

    constructor(parent, pos, end) {
        super(parent, pos, end);
        this.name = parent.name;
        this.applyClosure();
    }

    addParameter(parameter) {
        this.parameters.push(parameter);
        this.typeParameters.push(parameter.type);
        this.closure.var(parameter.name.escapedText, parameter);
    }

    get returnType() {
        return this.explicitReturnType || this.implicitReturnType;
    }

    forEachChild(cb) {
        this.parameters.forEach(node => cb(node));
        cb(this.body);
    }

    getText() {
        const compileUtils = this.module.project.compileUtils;
        const printer = new Printer(compileUtils);

        printer.writeModifiers(this);

        printer.write(this.name);

        printer.writeParams(this.parameters);

        printer.writeBody(this.body);

        return printer.getText();
    }
}

class MethodDeclaration extends MemberDeclaration {
    explicitReturnType;
    implicitReturnType = new NormalType(VoidType);
    typeParameters = [];
    parameters = [];
    body;

    constructor(parent, name, pos, end) {
        super(parent, pos, end);
        this.name = name;
        this.applyClosure(name);
    }

    addParameter(parameter) {
        this.parameters.push(parameter);
        this.typeParameters.push(parameter.type);
        this.closure.var(parameter.name, parameter);
    }

    get returnType() {
        return this.explicitReturnType || this.implicitReturnType;
    }

    forEachChild(cb) {
        this.parameters.forEach(node => cb(node));
        cb(this.body);
    }

    getText() {
        const compileUtils = this.module.project.compileUtils;
        const printer = new Printer(compileUtils);

        printer.writeModifiers(this);

        printer.writeType(this.returnType);

        printer.write(this.name);

        printer.writeParams(this.parameters);

        printer.writeBody(this.body);

        return printer.getText();
    }
}

class FunctionDeclaration extends Declaration {
    explicitReturnType;
    implicitReturnType = VoidType;
    typeParameters = [];
    parameters = [];
    body;

    constructor(parent, name, pos, end) {
        super(parent, pos, end);
        this.name = name;
        this.applyClosure(name);
    }

    addParameter(parameter) {
        this.parameters.push(parameter);
        this.typeParameters.push(parameter.type);
        this.closure.var(parameter.name.escapedText, parameter);
    }

    get returnType() {
        return this.explicitReturnType || this.implicitReturnType;
    }

    forEachChild(cb) {
        this.parameters.forEach(node => cb(node));
        cb(this.body);
    }
}

class ParameterDeclaration extends Declaration {
    dotDotDotToken;
    initializer;

    constructor(parent, name, pos, end) {
        super(parent, pos, end);
        this.name = name;
        this.fullName = parent.fullName + '.' + name;
    }


    forEachChild(cb) {
        cb(this.initializer);
    }

    getText() {
        const compileUtils = this.module.project.compileUtils;
        const printer = new Printer(compileUtils);

        printer.writeType(this.type);
        printer.write(this.name);

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

class VariableDeclaration extends Declaration {
    #initializer;

    get initializer() {
        return this.#initializer;
    }

    set initializer(value) {
        this.#initializer = value;
        if (value) {
            const valueType = value.type;
            if (valueType) {
                this.implicitType = valueType;
            }
        }
    }

    constructor(parent, name, pos, end) {
        super(parent, pos, end);
        this.name = name;
        this.fullName = parent.fullName + '.' + name;
    }

    forEachChild(cb) {
        cb(this.initializer);
    }

    getText() {
        const compileUtils = this.module.project.compileUtils;
        const printer = new Printer(compileUtils);

        printer.writeModifiers(this);

        printer.writeType(this.type, 'var');

        printer.write(this.name);

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
        const compileUtils = this.module.project.compileUtils;
        const printer = new Printer(compileUtils);

        if (this.body.statements.length > 0) {
            printer.write('static');
            printer.write('{');
            compileUtils.increaseIndent();
            const bodyCode = this.body.getText();
            if (bodyCode) {
                printer.writeln(bodyCode);
                compileUtils.decreaseIndent();
                printer.writeln('}');
            } else {
                compileUtils.decreaseIndent();
                printer.code('}');
            }
        }
        return printer.getText();
    }
}

class VariableDeclarationList extends ASTNode {

    declarations = [];

    constructor(parent, pos, end) {
        super(parent, pos, end);
    }

    forEachChild(cb) {
        this.declarations.forEach(node => cb(node));
    }

    getText() {
        const compileUtils = this.module.project.compileUtils;
        const printer = new Printer(compileUtils);

        for (let declaration of this.declarations) {
            const declarationCode = declaration.getText();
            printer.writeln(declarationCode);
        }

        return printer.getText();
    }
}

//==============//
//   Closure   //
//=============//
class Block extends ASTNode {
    implicitReturnType = VoidType;
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
        const compileUtils = this.module.project.compileUtils;
        const printer = new Printer(compileUtils);
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

//==============//
//  Statement  //
//=============//
class Statement extends ASTNode {
    constructor(parent, pos, end) {
        super(parent, pos, end);
    }
}

class ExpressionStatement extends Statement {
    expression;

    constructor(parent, pos, end) {
        super(parent, pos, end);
    }
}

class ArrayLiteralExpression extends Statement {
    elements = [];

    constructor(parent, pos, end) {
        super(parent, pos, end);
    }
}

class VariableStatement extends Statement {

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

class NewExpression extends ASTNode {

    expression;

    arguments = [];

    constructor(parent, pos, end) {
        super(parent, pos, end);
    }
}

class IfStatement extends Statement {
    expression;
    thenStatement;
    thenClosure;
    elseStatement;
    elseClosure;

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
}

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

class DoStatement extends IterationStatement {
    expression;

    constructor(parent, pos, end) {
        super(parent, pos, end);
    }

    forEachChild(cb) {
        cb(this.expression);
        super.forEachChild(cb);
    }
}

class WhileStatement extends IterationStatement {
    expression;

    constructor(parent, pos, end) {
        super(parent, pos, end);
    }

    forEachChild(cb) {
        cb(this.expression);
        super.forEachChild(cb);
    }
}

class ForStatement extends IterationStatement {
    initializer;
    condition;
    incrementor;

    constructor(parent, pos, end) {
        super(parent, pos, end);
    }

    forEachChild(cb) {
        cb(this.initializer);
        cb(this.condition);
        cb(this.incrementor);
        super.forEachChild(cb);
    }
}

class ForInStatement extends IterationStatement {
    initializer;
    expression;

    constructor(parent, pos, end) {
        super(parent, pos, end);
    }

    forEachChild(cb) {
        cb(this.initializer);
        cb(this.expression);
        super.forEachChild(cb);
    }
}

class ForOfStatement extends IterationStatement {
    initializer;
    #expression;

    get expression() {
        return this.#expression;
    }

    set expression(value) {
        this.#expression = value;
        if (this.initializer && value.elementType) {
            this.initializer.implicitType = value.elementType;
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
        const compileUtils = this.module.project.compileUtils;
        const printer = new Printer(compileUtils);

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

class BreakStatement extends Statement {
    label;

    constructor(parent, pos, end) {
        super(parent, pos, end);
    }

}

class ContinueStatement extends Statement {
    label;

    constructor(parent, pos, end) {
        super(parent, pos, end);
    }
}


class ReturnStatement extends Statement {
    expression;

    constructor(parent, pos, end) {
        super(parent, pos, end);
    }

    forEachChild(cb) {
        cb(this.expression);
    }

    getText() {
        const compileUtils = this.module.project.compileUtils;
        const printer = new Printer(compileUtils);

        printer.write('return');

        const expressionCode = this.expression.getText();
        if (expressionCode) {
            printer.write(expressionCode);
        }
        return printer.getText();
    }
}

class SwitchStatement extends Statement {
    expression;
    caseBlock;
    possiblyExhaustive;

    constructor(parent, pos, end) {
        super(parent, pos, end);
    }

    forEachChild(cb) {
        cb(this.expression);
    }
}

class CaseBlock extends ASTNode {
    clauses = [];

    constructor(parent, pos, end) {
        super(parent, pos, end);
    }

    forEachChild(cb) {
        cb(this.clauses);
    }
}

class CaseClause extends ASTNode {
    expression;
    statements = [];

    constructor(parent, pos, end) {
        super(parent, pos, end);
        this.applyClosure();
    }

    forEachChild(cb) {
        cb(this.expression);
        this.statements.forEach(node => cb(node));
    }
}

class DefaultClause extends ASTNode {
    statements;

    constructor(parent, pos, end) {
        super(parent, pos, end);
        this.applyClosure();
    }
}

class ThrowStatement extends Statement {
    expression;

    constructor(parent, pos, end) {
        super(parent, pos, end);
    }

    forEachChild(cb) {
        cb(this.expression);
    }
}

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

//==============//
//  Statement  //
//=============//
class Expression extends ASTNode {
    constructor(parent, pos, end) {
        super(parent, pos, end);
    }
}

class ClassExpression extends ClassDeclaration {

    constructor(parent, name, pos, end) {
        super(parent, name, pos, end);
    }
}

class BinaryExpression extends Expression {
    left;
    operator;
    right;

    constructor(parent, pos, end) {
        super(parent, pos, end);
    }

    forEachChild(cb) {
        cb(this.left);
        cb(this.right);
    }

    getText() {
        const compileUtils = this.module.project.compileUtils;
        const printer = new Printer(compileUtils);

        printer.write(this.left.getText());

        printer.write(this.operator);

        printer.write(this.right.getText());

        return printer.getText();
    }
}

class ParenthesizedExpression extends Expression {
    expression;

    constructor(parent, pos, end) {
        super(parent, pos, end);
    }
}

class LambdaFunction extends ASTNode {
    implicitType;
    explicitReturnType;
    implicitReturnType = VoidType;
    typeParameters = [];
    parameters = [];
    body;
    equalsGreaterThanToken;

    constructor(parent, pos, end) {
        super(parent, pos, end);
        this.applyClosure('');
    }

    addParameter(parameter) {
        this.parameters.push(parameter);
        this.typeParameters.push(parameter.type);
        this.closure.var(parameter.name, parameter);
    }

    forEachChild(cb) {
        this.parameters.forEach(node => cb(node));
        cb(this.body);
    }
}

class ConditionalExpression extends Expression {
    condition;
    questionToken;
    whenTrue;
    colonToken;
    whenFalse;

    constructor(parent, pos, end) {
        super(parent, pos, end);
    }

    forEachChild(cb) {
        cb(this.condition);
        cb(this.whenTrue);
        cb(this.whenFalse);
    }
}

class PrefixUnaryExpression extends Expression {
    operator;
    operand;

    constructor(parent, pos, end) {
        super(parent, pos, end);
    }

    forEachChild(cb) {
        cb(this.operator);
        cb(this.operand);
    }

    getText() {
        const compileUtils = this.module.project.compileUtils;
        const printer = new Printer(compileUtils);

        printer.write(this.operator);
        printer.code(this.operand.getText());

        return printer.getText();
    }
}

class PostfixUnaryExpression extends Expression {
    operator;
    operand;

    constructor(parent, pos, end) {
        super(parent, pos, end);
    }

    forEachChild(cb) {
        cb(this.operator);
        cb(this.operand);
    }
}

/**
 * expression(...arguments)
 */
class CallExpression extends Expression {
    expression;
    typeArguments;
    arguments = [];

    constructor(parent, pos, end) {
        super(parent, pos, end);
    }

    forEachChild(cb) {
        cb(this.expression);
        this.parameters.forEach(node => cb(node));
    }

    getText() {
        const compileUtils = this.module.project.compileUtils;
        const printer = new Printer(compileUtils);

        printer.write(this.expression.getText());

        printer.writeArguments(this.arguments);

        return printer.getText();
    }
}

/**
 * expression.name
 */
class PropertyAccessExpression extends Expression {
    expression;
    questionDotToken;
    name;

    constructor(parent, pos, end) {
        super(parent, pos, end);
    }

    forEachChild(cb) {
        cb(this.expression);
    }

    getText() {
        const compileUtils = this.module.project.compileUtils;
        const printer = new Printer(compileUtils);

        printer.code(this.expression.getText());
        printer.code('.');
        printer.code(this.name);

        return printer.getText();
    }
}

/**
 * array[key]
 */
class ElementAccessExpression extends Expression {
    expression;
    questionDotToken;
    argumentExpression;

    constructor(parent, pos, end) {
        super(parent, pos, end);
    }

    forEachChild(cb) {
        cb(this.expression);
        cb(this.argumentExpression);
    }
}

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

/**
 * a: 2
 */
class PropertyAssignment extends ASTNode {
    parent;
    name;
    initializer;

    constructor(parent, pos, end) {
        super(parent, pos, end);
    }

    forEachChild(cb) {
        cb(this.initializer);
    }
}


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

/// true
class TrueKeyword extends Literal {

    constructor(parent, pos, end) {
        super(parent, BooleanType, 'true', pos, end);
    }
}

/// false
class FalseKeyword extends Literal {

    constructor(parent, pos, end) {
        super(parent, BooleanType, 'false', pos, end);
    }
}

/// this.a
class ThisKeyword extends Literal {
    constructor(parent, pos, end) {
        const compileUtils = parent.module.project.compileUtils;
        const classNode = compileUtils.getClassFromNode(parent);
        super(parent, classNode.type, 'this', pos, end);
    }
}

/// a = 1;
class NumericLiteral extends Literal {
    constructor(parent, text, pos, end) {
        let type = IntType;
        if (text.indexOf('.') >= 0) {
            type = DoubleType;
        }
        super(parent, type, text, pos, end);
    }
}

/// a = 1n;
class BigIntLiteral extends Literal {
    constructor(parent, text, pos, end) {
        super(parent, IntType, text, pos, end);
    }
}

/// a = 'string';
class StringLiteral extends Literal {
    constructor(parent, text, pos, end) {
        super(parent, StringType, `"${text.replace(/\n/, '\\n')}"`, pos, end);
    }
}

/// /^\d{11}$/
class RegularExpressionLiteral extends Literal {
    constructor(parent, text, pos, end) {
        super(parent, PatternType, `Pattern.compile("${text}")`, pos, end);
    }
}

module.exports = {
    Closure,
    ASTNode,
    Project,
    JavaModule,
    Identifier,
    ImportDeclaration,
    Declaration,
    MemberDeclaration,
    ClassDeclaration,
    PropertyDeclaration,
    ConstructorDeclaration,
    MethodDeclaration,
    FunctionDeclaration,
    ParameterDeclaration,
    VariableDeclaration,
    ClassStaticBlockDeclaration,
    VariableDeclarationList,
    Block,
    Statement,
    ExpressionStatement,
    VariableStatement,
    NewExpression,
    IfStatement,
    IterationStatement,
    DoStatement,
    WhileStatement,
    ForStatement,
    ForInStatement,
    ForOfStatement,
    BreakStatement,
    ContinueStatement,
    ReturnStatement,
    SwitchStatement,
    CaseBlock,
    CaseClause,
    DefaultClause,
    ThrowStatement,
    TryStatement,
    CatchClause,
    Expression,
    ClassExpression,
    BinaryExpression,
    ParenthesizedExpression,
    LambdaFunction,
    ConditionalExpression,
    PrefixUnaryExpression,
    PostfixUnaryExpression,
    CallExpression,
    PropertyAccessExpression,
    ElementAccessExpression,
    ObjectLiteralExpression,
    PropertyAssignment,
    Literal,
    TrueKeyword,
    FalseKeyword,
    ThisKeyword,
    NumericLiteral,
    BigIntLiteral,
    StringLiteral,
    RegularExpressionLiteral,
    ArrayLiteralExpression,
    isDeclaration,
    isFunction,
    Type,
    NormalType,
    ArrayType,
    VoidType,
    BooleanType,
    IntType,
    DoubleType,
    StringType,
    PatternType,
}
