class Closure {
    module;

    parent;

    namespace;

    _variables = {};

    constructor(parent, namespace = '') {
        this.parent = parent;
        this.namespace = namespace;
    }

    get(name) {
        const compileUtils = this.module.project.compileUtils;
        return compileUtils.getVariable(this, name);
    }

    has(name) {
        return this._variables.hasOwnProperty(name);
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
        return this._variables[name];
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
        return '';
    }

    forEachChild(cb) {

    }

    applyClosure(namespace) {
        const compileUtils = this.module.project.compileUtils;
        this.closure = new Closure(compileUtils.getClosureFromNode(this), namespace);
        this.closure.module = this.module;
    }

}

class Project {
    moduleMap = {};

    compileUtils;
}

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
        this.applyClosure(name);
        this.closure.var('this', this);
        this.name = name;
        this.explicitType = name;
    }

    addMember(member) {
        this.members.push(member);
        this.closure.var(member.name, member);
    }

    forEachChild(cb) {
        cb(this.staticBlock);
        this.members.forEach(node => cb(node));
    }
}

class MemberDeclaration extends Declaration {
    accessor;// 'public' | 'private' | 'protected'
    isStatic;

    constructor(parent, name, pos, end) {
        super(parent, name, pos, end);
    }
}

class JavaModule extends ASTNode {
    project;
    imports = [];
    packageName;

    get fullName() {
        return this.defaultClass.fullName;
    }

    set fullName(className) {
        this.defaultClass.fullName = className;
    }

    isResolved = false;
    fileName;

    get name() {
        return this.defaultClass.name;
    }

    set name(name) {
        this.defaultClass.name = name;
    }

    defaultClass;

    nestedClasses = [];

    constructor(project, fileName, packageName, name, pos, end) {
        super(null, pos, end);
        this.fileName = fileName;
        this.packageName = packageName;
        this.project = project;
        this.module = this;

        this.defaultClass = new ClassDeclaration(this, name);
        this.defaultClass.fullName = packageName + '.' + name;
        this.defaultClass.accessor = 'public';
        this.applyClosure('');
        this.closure.var(name, this.defaultClass);
    }

    addNestedClass(nestedClass) {
        this.nestedClasses.push(nestedClass);
        this.closure.var(nestedClass.name, nestedClass);
    }

    forEachChild(cb) {
        cb(this.defaultClass);
        this.members.forEach(node => cb(node));
    }

}

class Identifier extends ASTNode {
    implicitType;
    text;

    declaration;

    constructor(parent, pos, end) {
        super(parent, pos, end);
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
    initializer;

    constructor(parent, name, pos, end) {
        super(parent, pos, end);
        this.name = name;
        this.fullName = parent.fullName + '.' + name;
    }


    forEachChild(cb) {
        cb(this.initializer);
    }
}

function isFunction(node) {
    return node.hasOwnProperty('explicitReturnType')
        && node.hasOwnProperty('implicitReturnType')
        && node.hasOwnProperty('parameters')
        && node.hasOwnProperty('typeParameters')
        && node.hasOwnProperty('body')
        && node.hasOwnProperty('addParameter');

}

class ConstructorDeclaration extends MemberDeclaration {
    explicitReturnType;
    implicitReturnType;
    typeParameters = [];
    parameters = [];
    body;

    constructor(parent, pos, end) {
        super(parent, pos, end);
        this.name = parent.name;
        this.applyClosure('');
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

class MethodDeclaration extends MemberDeclaration {
    explicitReturnType;
    implicitReturnType;
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
}

class VariableDeclaration extends Declaration {
    initializer;

    constructor(parent, name, pos, end) {
        super(parent, pos, end);
        this.name = name;
        this.fullName = parent.fullName + '.' + name;
    }

    forEachChild(cb) {
        cb(this.initializer);
    }
}

class ClassStaticBlockDeclaration extends Declaration {
    parent;
    body;

    constructor(parent, pos, end) {
        super(parent, pos, end);
    }

    forEachChild(cb) {
        cb(this.body);
    }
}

class VariableDeclarationList extends ASTNode {

    declarations;

    constructor(parent, pos, end) {
        super(parent, pos, end);
    }

    forEachChild(cb) {
        this.declarations.forEach(node => cb(node));
    }
}

//==============//
//   Closure   //
//=============//
class Block extends ASTNode {
    implicitReturnType;
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

class VariableStatement extends Statement {

    declarationList;

    constructor(parent, pos, end) {
        super(parent, pos, end);
    }

    forEachChild(cb) {
        this.declarationList.forEach(node => cb(node));
    }
}

class NewExpression {

}

class IfStatement extends Statement {
    expression;
    thenStatement;
    elseStatement;

    constructor(parent, pos, end) {
        super(parent, pos, end);
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
    catchClause;
    finallyBlock;

    constructor(parent, pos, end) {
        super(parent, pos, end);
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
    constructor(parent, name) {
        super(parent, name);
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
    implicitReturnType;
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
        this.closure.new(parameter.name, parameter);
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
    questionDotToken;
    typeArguments;
    arguments;

    constructor(parent, pos, end) {
        super(parent, pos, end);
    }

    forEachChild(cb) {
        cb(this.expression);
        this.parameters.forEach(node => cb(node));
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
    }


    getText() {
        return this.text;
    }
}

/// true
class TrueKeyword extends Literal {

    constructor(parent, pos, end) {
        super(parent, 'boolean', 'true', pos, end);
    }
}

/// false
class FalseKeyword extends Literal {

    constructor(parent, pos, end) {
        super(parent, 'boolean', 'false', pos, end);
    }
}

/// this.a
class ThisKeyword extends Literal {
    constructor(parent, pos, end) {
        const classNode = getClassFromNode(parent);
        super(parent, classNode.type, 'this', pos, end);
    }
}

/// a = 1;
class NumericLiteral extends Literal {
    constructor(parent, text, pos, end) {
        let type = 'int';
        if (text.indexOf('.') >= 0) {
            type = 'double';
        }
        super(parent, type, text, pos, end);
    }
}

/// a = 1n;
class BigIntLiteral extends Literal {
    constructor(parent, text, pos, end) {
        super(parent, 'int', text, pos, end);
    }
}

/// a = 'string';
class StringLiteral extends Literal {
    constructor(parent, text, pos, end) {
        super(parent, 'String', `"${text}"`, pos, end);
    }
}

/// /^\d{11}$/
class RegularExpressionLiteral extends Literal {
    constructor(parent, text, pos, end) {
        super(parent, 'Pattern', `Pattern.compile("${text}")`, pos, end);
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
    isDeclaration,
    isFunction,
}
