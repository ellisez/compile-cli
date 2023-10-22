const ts = require("typescript");
const path = require("node:path");
const process = require("node:process");
const { readConfig, versionObject } = require('../config.js');
const EventCenter = require("./event.js");
const { entryFile } = require("../pkg.js");
const log = require('../log.js');
const {
    toCamel,
    toFileName,
    toPackageName,
    toClassName,
    toClassFullName,
} = require("./utils");
const {
    Closure,
    ASTNode,
    Project,
    JavaModule,
    Identifier,
    ImportDeclaration,
    Declaration,
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
    TrueKeyword,
    FalseKeyword,
    ThisKeyword,
    NumericLiteral,
    StringLiteral,
    RegularExpressionLiteral,
    isFunction,
} = require("./ast.js");

const config = readConfig();
const cwd = process.cwd();

const canUseVarKeyword = versionObject('java')[0] >= 10;

class JavaParser {
    tsOptions;
    tsProgram;
    #TSKindMap = {};
    project;
    eventCenter = new EventCenter();

    compileUtils;

    constructor(tsOptions) {
        this.tsOptions = tsOptions;
    }

    parse() {
        for (let key in ts.SyntaxKind) {
            const value = ts.SyntaxKind[key];
            if (!this.#TSKindMap[value]) {
                this.#TSKindMap[value] = key;
            }
        }

        this.TSProgram();
        const sourceFiles = this.tsProgram.getSourceFiles();
        for (const sourceFile of sourceFiles) {
            this.TSSourceFile(sourceFile);
        }
    }

    TSProgram() {
        if (!this.tsProgram) {
            const compilerOptions = { ...this.tsOptions.compilerOptions };
            let moduleResolution = compilerOptions.moduleResolution;
            if (typeof moduleResolution === 'string') {
                moduleResolution = ts.ModuleResolutionKind[moduleResolution];
                if (!moduleResolution) {
                    throw new Error(`"${moduleResolution}" invalid for compilerOptions.moduleResolution.try to use NodeNext.`);
                }
                compilerOptions.moduleResolution = moduleResolution;
            }

            this.tsProgram = ts.createProgram([entryFile], compilerOptions);
            this.project = new Project();
            this.compileUtils = new CompileUtils(this.tsProgram);
            this.project.compileUtils = this.compileUtils;
            //
            const fullName = `${config.java.package}.FunctionInterface`;
            const fileName = toFileName(fullName);
            const moduleMap = this.project.moduleMap;
            let module = moduleMap[fullName];
            if (!module) {
                module = new JavaModule(this.project, fileName, config.java.package, 'FunctionInterface');
                moduleMap[fullName] = module;
            }
        }
    }

    TSSourceFile(sourceFile) {
        const { fileName } = sourceFile;
        const pathObject = path.parse(fileName);

        const pos = sourceFile.pos;
        const end = sourceFile.end;

        const packageName = toPackageName(fileName);
        const name = toClassName(fileName);

        // ast
        const javaModule = new JavaModule(this.project, fileName, packageName, name, pos, end);
        this.project.moduleMap[javaModule.fullName] = javaModule;

        // child
        for (let statement of sourceFile.statements) {
            this.visitNode(statement, javaModule, javaModule.closure);
        }
    }

    visitNode(tsNode, javaNode, closure) {
        if (!tsNode) return;
        const kind = tsNode.kind;
        const nodeName = this.#TSKindMap[kind];
        const visitor = this['TS' + nodeName];
        if (!visitor) {
            let parentName = 'root'
            const parentNode = tsNode.parent;
            if (parentNode) {
                parentName = this.#TSKindMap[parentNode.kind];
            }
            log.warn(`unsupported ${nodeName} parent ${parentName} in ${javaNode.module.fileName}.`);
            return;
        }
        return visitor.call(this, tsNode, javaNode, closure);
    }

    /// a();
    /// b = a;
    /// a = 1;
    TSIdentifier(tsNode, javaNode, closure) {
        const text = tsNode.escapedText;

        const identifier = new Identifier(javaNode, tsNode.pos, tsNode.end);
        identifier.implicitType = this.compileUtils.parseType(tsNode);
        const declaration = closure.get(text);
        if (!declaration) {
            let parentName = 'root'
            const parentNode = tsNode.parent;
            if (parentNode) {
                parentName = this.#TSKindMap[parentNode.kind];
            }
            throw new Error(`unknown identifier "${text}" parent ${parentName} in ${javaNode.module.fileName}.`);
        }
        identifier.declaration = declaration;
        declaration.refs.push(identifier);
        return identifier;
    }

    /// a.b
    TSPropertyAccessExpression(tsNode, javaNode, closure) {
        const name = tsNode.name.escapedText;
        const expression = tsNode.expression;

        const propertyAccessExpression = new PropertyAccessExpression(javaNode, tsNode.pos, tsNode.end);
        propertyAccessExpression.name = name;
        propertyAccessExpression.expression = this.visitNode(expression, propertyAccessExpression, closure);
        return propertyAccessExpression;
    }

    /// this.a
    TSThisKeyword(tsNode, javaNode, closure) {

    }

    /// import a from 'b'
    TSImportDeclaration(tsNode, javaNode, closure) {
        const importClause = tsNode.importClause;
        const moduleSpecifier = tsNode.moduleSpecifier.text;

        const module = javaNode.module;
        const fileDir = path.dirname(module.fileName);

        let modulePath = path.resolve(fileDir, moduleSpecifier);
        const modulePackage = toClassFullName(modulePath);

        let importDeclaration = module.imports[modulePackage];
        if (!importDeclaration) {
            importDeclaration = new ImportDeclaration(javaNode, tsNode.pos, tsNode.end);
            importDeclaration.modulePackage = modulePackage;
            module.imports[modulePackage] = importDeclaration;
        }

        const moduleNamed = importClause.name.escapedText;
        importDeclaration.moduleNamedBindings.add(moduleNamed);

        const namedBindings = importClause.namedBindings;
        if (namedBindings) {
            for (let element of namedBindings.elements) {
                const propertyBinding = element.name.escapedText;
                let propertyName = element.propertyName.escapedText;
                if (!propertyName) {
                    propertyName = propertyBinding;
                }
                importDeclaration.propertyNamedBindings[propertyName] = propertyBinding;
            }
        }
    }

    /// export default a = 1;
    TSExportAssignment(tsNode, javaNode, closure) {
        const expression = tsNode.expression;

        const module = javaNode.module;
        const defaultClass = module.defaultClass;
        const name = 'exportDefault';

        const propertyDeclaration = new PropertyDeclaration(defaultClass, name);
        propertyDeclaration.accessor = 'public';
        propertyDeclaration.isStatic = true;
        propertyDeclaration.isFinal = true;

        propertyDeclaration.initializer = this.visitNode(expression, defaultClass, defaultClass.closure);
    }

    /// class a {}
    TSClassDeclaration(tsNode, javaNode, closure) {
        const name = tsNode.name.escapedText;

        const pos = tsNode.pos;
        const end = tsNode.end;

        let classDeclaration = null;
        const { isExport, isDefault, accessor, isStatic, isFinal } = this.compileUtils.parseModifiers(tsNode);
        if (isExport) {
            const module = javaNode.module;
            if (isDefault) {
                classDeclaration = module.defaultClass;
                classDeclaration.pos = pos;
                classDeclaration.end = end;
            } else {
                classDeclaration = new ClassDeclaration(javaNode, name, pos, end);
                module.addNestedClass(classDeclaration);
            }
        } else {
            classDeclaration = new ClassDeclaration(javaNode, name, pos, end);
            javaNode.newVariable(name, classDeclaration);

            if (javaNode instanceof JavaModule) {
                javaNode.addNestedClass(classDeclaration);
            } else if (javaNode instanceof Block) {
                javaNode.var(classDeclaration);
            }
        }

        classDeclaration.accessor = accessor === undefined ? 'public' : accessor;
        classDeclaration.isStatic = isStatic === undefined ? false : isStatic;
        classDeclaration.isFinal = isFinal === undefined ? false : isFinal;

        const members = tsNode.members;
        for (let member of members) {
            this.visitNode(member, classDeclaration, classDeclaration.closure);
        }

        return classDeclaration;
    }

    /// 1 + 2;
    TSBinaryExpression(tsNode, javaNode, closure) {
        const left = tsNode.left;
        const right = tsNode.right;
        const operatorToken = tsNode.operatorToken;

        const binaryExpression = new BinaryExpression(javaNode, tsNode.pos, tsNode.end);
        binaryExpression.left = this.visitNode(left, binaryExpression, closure);
        binaryExpression.right = this.visitNode(right, binaryExpression, closure);
        binaryExpression.operator = this.compileUtils.parseOperator(operatorToken);

        return binaryExpression;
    }

    /// 1 + (2 + 3);
    TSParenthesizedExpression(tsNode, javaNode, closure) {
        const expression = tsNode.expression;

        const parenthesizedExpression = new ParenthesizedExpression(javaNode, tsNode.pos, tsNode.end);
        parenthesizedExpression.expression = this.visitNode(expression, parenthesizedExpression, closure);
        return parenthesizedExpression;
    }

    /// var a;
    /// let b;
    /// const c;
    TSVariableStatement(tsNode, javaNode, closure) {
        const declarationList = tsNode.declarationList;

        let isFinal = false;
        switch (declarationList.flags) {
            case ts.NodeFlags.Const:
                isFinal = true;
                break;
        }

        for (let declaration of declarationList.declarations) {
            const name = declaration.name.escapedText;

            const variableDeclaration = new VariableDeclaration(javaNode, name, declaration.pos, declaration.end);
            closure.var(name, variableDeclaration);

            variableDeclaration.isFinal = isFinal;

            const initializer = declaration.initializer;
            variableDeclaration.initializer = this.visitNode(initializer, variableDeclaration, closure);
        }
    }

    /// function a() {}
    TSFunctionDeclaration(tsNode, javaNode, closure) {
        debugger;
    }

    /// for(let i=0; i< 3; i++) {}
    TSForStatement(tsNode, javaNode, closure) {
        debugger;
    }

    /// for(let key in object) {}
    TSForInStatement(tsNode, javaNode, closure) {
        debugger;
    }

    /// for(let item of array) {}
    TSForOfStatement(tsNode, javaNode, closure) {
        debugger;
    }

    /// if (a == 1) {} else if (a == 2) {} else {}
    TSIfStatement(tsNode, javaNode, closure) {
        debugger;
    }

    /// switch(a) {}
    TSSwitchStatement(tsNode, javaNode, closure) {
        const expression = tsNode.expression;
        const caseBlock = tsNode.caseBlock;
        const clauses = caseBlock.clauses;

        const switchStatement = new SwitchStatement(javaNode, tsNode.pos, tsNode.end);
        const javaCaseBlock = new CaseBlock(switchStatement, caseBlock.pos, caseBlock.end);
        switchStatement.caseBlock = javaCaseBlock;
        for (let clause of clauses) {
            const javaClause = this.visitNode(clause, javaCaseBlock, closure);
            javaCaseBlock.clauses.push(javaClause);
        }

        return switchStatement;
    }

    /// switch(a) { case 1: }
    TSCaseClause(tsNode, javaNode, closure) {
        const expression = tsNode.expression;
        const statements = tsNode.statements;

        const caseClause = new CaseClause(javaNode, tsNode.pos, tsNode.end);
        caseClause.expression = this.visitNode(expression, caseClause, closure);
        for (let statement of statements) {
            const javaStatement = this.visitNode(statement, caseClause, closure);
            caseClause.statements.push(javaStatement);
        }

        return caseClause;
    }

    /// switch(a) { default: }
    TSDefaultClause(tsNode, javaNode, closure) {
        const statements = tsNode.statements;

        const defaultClause = new DefaultClause(javaNode, tsNode.pos, tsNode.end);
        for (let statement of statements) {
            const javaStatement = this.visitNode(statement, defaultClause, closure);
            defaultClause.statements.push(javaStatement);
        }

        return defaultClause;
    }

    /// return a;
    TSReturnStatement(tsNode, javaNode, closure) {
        const expression = tsNode.expression;
        const pos = tsNode.pos;
        const end = tsNode.end;

        const returnStatement = new ReturnStatement(javaNode, pos, end);
        const javaExpression = this.visitNode(expression, returnStatement, closure);
        returnStatement.expression = javaExpression;

        const block = this.compileUtils.getBlockFromNode(javaNode);
        block.implicitReturnType = javaExpression.type;

        return returnStatement;
    }

    /// break;
    TSBreakStatement(tsNode, javaNode, closure) {
        return new BreakStatement(javaNode, tsNode.pos, tsNode.end);
    }

    /// continue;
    TSContinueStatement(tsNode, javaNode, closure) {
        return new ContinueStatement(javaNode, tsNode.pos, tsNode.end);
    }

    /// a=1+2;
    /// a();
    /// new A();
    /// ++i;
    /// i--;
    /// a.b;
    TSExpressionStatement(tsNode, javaNode, closure) {
        return this.visitNode(tsNode, javaNode, closure);
    }

    /// class A { constructor() {} }
    TSConstructor(tsNode, javaNode, closure) {
        const parameters = tsNode.parameters;
        const body = tsNode.body;

        const pos = tsNode.pos;
        const end = tsNode.end;

        const constructorDeclaration = new ConstructorDeclaration(javaNode, pos, end);

        const { accessor, isStatic, isFinal } = this.compileUtils.parseModifiers(tsNode);

        constructorDeclaration.accessor = accessor === undefined ? 'public' : accessor;
        constructorDeclaration.isStatic = isStatic === undefined ? false : isStatic;
        constructorDeclaration.isFinal = isFinal === undefined ? false : isFinal;

        for (let parameter of parameters) {
            const javaParameter = this.TSParameter(parameter, constructorDeclaration, constructorDeclaration.closure);
            constructorDeclaration.addParameter(javaParameter);
        }

        constructorDeclaration.body = this.TSBlock(body, constructorDeclaration, constructorDeclaration.closure);
        constructorDeclaration.implicitReturnType = body.implicitReturnType;
    }

    /// class A { private int b = 1; }
    TSPropertyDeclaration(tsNode, javaNode, closure) {
        const name = tsNode.name.escapedText;
        const type = tsNode.type;
        const initializer = tsNode.initializer;

        const pos = tsNode.pos;
        const end = tsNode.end;

        const propertyDeclaration = new PropertyDeclaration(javaNode, name, pos, end);

        const { accessor, isStatic, isFinal } = this.compileUtils.parseModifiers(tsNode);

        propertyDeclaration.accessor = accessor === undefined ? 'public' : accessor;
        propertyDeclaration.isStatic = isStatic === undefined ? false : isStatic;
        propertyDeclaration.isFinal = isFinal === undefined ? false : isFinal;

        propertyDeclaration.explicitType = this.compileUtils.parseType(type);

        const javaInitializer = this.visitNode(initializer, propertyDeclaration, closure);
        if (javaInitializer) {
            propertyDeclaration.initializer = javaInitializer;
            if (javaInitializer.type) {
                propertyDeclaration.implicitType = javaInitializer.type;
            }
        }
    }

    /// class A { public int b(double c) {} }
    TSMethodDeclaration(tsNode, javaNode, closure) {
        const name = tsNode.name.escapedText;
        const type = tsNode.type;
        const parameters = tsNode.parameters;
        const body = tsNode.body;

        const pos = tsNode.pos;
        const end = tsNode.end;

        const methodDeclaration = new MethodDeclaration(javaNode, name, pos, end);

        const { accessor, isStatic, isFinal } = this.compileUtils.parseModifiers(tsNode);

        methodDeclaration.accessor = accessor === undefined ? 'public' : accessor;
        methodDeclaration.isStatic = isStatic === undefined ? false : isStatic;
        methodDeclaration.isFinal = isFinal === undefined ? false : isFinal;

        methodDeclaration.explicitReturnType = this.compileUtils.parseType(type);

        for (let parameter of parameters) {
            const javaParameter = this.TSParameter(parameter, methodDeclaration, methodDeclaration.closure);
            methodDeclaration.addParameter(javaParameter);
        }

        const javaBlock = this.TSBlock(body, methodDeclaration, methodDeclaration.closure);
        methodDeclaration.body = javaBlock;
        methodDeclaration.implicitReturnType = javaBlock.implicitReturnType;
        methodDeclaration.implicitType = this.compileUtils.getFunctionType(methodDeclaration);

    }

    /// function fun() {}
    /// class A { fun() {} }
    TSBlock(tsNode, javaNode, closure) {
        const pos = tsNode.pos;
        const end = tsNode.end;

        const block = new Block(javaNode, pos, end);
        const statements = tsNode.statements;
        for (let statement of statements) {
            const javaStatement = this.visitNode(statement, block, closure);
            block.statements.push(javaStatement);
        }
        return block;
    }

    /// function a(p=2) {}
    /// class A { fun(p=2) {} }
    TSParameter(tsNode, javaNode, closure) {
        const name = tsNode.name;
        const type = tsNode.type;
        const initializer = tsNode.initializer;

        const pos = tsNode.pos;
        const end = tsNode.end;

        const parameterDeclaration = new ParameterDeclaration(javaNode, name, pos, end);

        parameterDeclaration.explicitType = this.parseType(type);

        const javaInitializer = this.visitNode(initializer, parameterDeclaration, closure);
        parameterDeclaration.initializer = javaInitializer;

        return parameterDeclaration;
    }

    /// true
    TSTrueKeyword(tsNode, javaNode, closure) {
        return new TrueKeyword(javaNode, tsNode.pos, tsNode.end);
    }

    /// false
    TSFalseKeyword(tsNode, javaNode, closure) {
        return new FalseKeyword(javaNode, tsNode.pos, tsNode.end);
    }

    /// a = 1;
    TSNumericLiteral(tsNode, javaNode, closure) {
        return new NumericLiteral(javaNode, tsNode.text, tsNode.pos, tsNode.end);
    }

    /// a = 1n;
    TSBigIntLiteral(tsNode, javaNode, closure) {
        return new NumericLiteral(javaNode, tsNode.text, tsNode.pos, tsNode.end);
    }

    /// a = 'string';
    TSStringLiteral(tsNode, javaNode, closure) {
        return new StringLiteral(javaNode, tsNode.text, tsNode.pos, tsNode.end);
    }

    /// /^\d{11}$/
    TSRegularExpressionLiteral(tsNode, javaNode, closure) {
        return new RegularExpressionLiteral(javaNode, tsNode.text, tsNode.pos, tsNode.end);
    }

}

class CompileUtils {
    tsProgram;

    constructor(tsProgram) {
        this.tsProgram = tsProgram;
    }

    #functionMemberMap = {};

    parseModifiers(tsNode) {
        const modifiers = tsNode.modifiers;
        if (!modifiers) return {};
        const result = {};
        result.isExport = false;
        result.isDefault = false;
        for (let modifier of modifiers) {
            switch (modifier.kind) {
                case ts.SyntaxKind.ExportKeyword:
                    result.accessor = 'public';
                    result.isExport = true;
                    break;
                case ts.SyntaxKind.DefaultKeyword:
                    result.isDefault = true;
                    break;
                case ts.SyntaxKind.PublicKeyword:
                    result.accessor = 'public';
                    break;
                case ts.SyntaxKind.PrivateKeyword:
                    result.accessor = 'private';
                    break;
                case ts.SyntaxKind.ProtectedKeyword:
                    result.accessor = 'protected';
                    break;
                case ts.SyntaxKind.StaticKeyword:
                    result.isStatic = true;
                case ts.SyntaxKind.ConstKeyword:
                    result.isFinal = true;
            }
        }

        return result;
    }

    parseType(tsNode) {
        if (!tsNode) return;

        const typeChecker = this.tsProgram.getTypeChecker();
        const type = typeChecker.getTypeAtLocation(tsNode);
        const typeToString = typeChecker.typeToString(type);

        return this.javaType(typeToString);
    }

    parseOperator(tsNode) {
        if (!tsNode) return;
        return tsNode.getText();
    }

    javaType(tsType) {
        switch (tsType) {
            case 'number':
                return 'double';
            case 'bigint':
                return 'int';
            case 'string':
                return 'String';
            default:
                return tsType;
        }
    }

    getFunctionType(javaNode) {
        if (!javaNode) return 'void';

        if (isFunction(javaNode)) {
            let ClassName = 'Function';
            const typeParameters = javaNode.typeParameters;
            const parameters = javaNode.parameters;
            for (let typeParameter of typeParameters) {
                if (!typeParameter) continue;
                ClassName += toCamel(typeParameter);
            }
            ClassName += 'Return' + toCamel(javaNode.returnType);

            let classMember = ClassMemberMap[ClassName];
            if (!classMember) {
                classMember = new ClassDeclaration(module, ClassName);
                const methodMember = new MethodDeclaration(classMember, 'call');
                methodMember.typeParameters = [...typeParameters];
                methodMember.parameters = [...parameters];
                methodMember.explicitReturnType = ClassName;
                classMember.members.push(methodMember);
                ClassMemberMap[ClassName] = classMember;
            }
            return ClassName;
        }
        return 'void';
    }

    useFunctionInterface(javaNode) {
        const ClassName = this.getFunctionType(javaNode);
        const fullName = `${config.java.package}.FunctionInterface`;
        const module = project.moduleMap[fullName];
        const classMember = module.members.find(classNode => classNode.name === ClassName);
        if (!classMember) {
            const ClassMember = ClassMemberMap[ClassName];
            module.members.push(ClassMember);
        }
    }

    getClassFromNode(javaNode) {
        if (!javaNode) return;
        if (javaNode instanceof ClassDeclaration) {
            return javaNode;
        }
        return this.getClassFromNode(javaNode.parent);
    }

    getClosureFromNode(node) {
        if (node.closure) return node.closure;
        if (node.parent) return this.getClosureFromNode(node.parent);
        return undefined;
    }

    getVariable(closure, name) {
        if (closure instanceof ASTNode) {
            closure = this.getClosureFromNode(closure);
        }
        if (closure.has(name)) {
            return closure._variables[name];
        }
        if (!closure.isTop()) {
            const parent = closure.parent;
            return this.getVariable(parent, name);
        }
    }

    setVariable(closure, name, declaration) {
        if (closure instanceof ASTNode) {
            closure = this.getClosureFromNode(closure);
        }
        if (closure.has(name)) {
            closure._variables[name] = declaration;
        }
        if (!closure.isTop()) {
            const parent = closure.parent;
            this.setVariable(parent, name, declaration);
        }
    }

    newVariable(closure, name, declaration) {
        if (!closure) return;
        if (closure instanceof ASTNode) {
            closure = this.getClosureFromNode(closure);
        }
        closure._variables[name] = declaration;
    }

    getBlockFromNode(javaNode) {
        if (!javaNode) return;
        if (javaNode instanceof Block) {
            return javaNode;
        }
        return this.getBlockFromNode(javaNode.parent);
    }
}

module.exports = JavaParser;
