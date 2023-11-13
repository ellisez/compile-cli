const ts = require("typescript");
const path = require("node:path");
const { readConfig, versionObject } = require('../config');
const log = require('../log');
const fs = require('node:fs');
const {
    toFileName, toPackageName, toClassName, toClassInfo, toJavaFile,
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
    InterfaceDeclaration,
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
    ArrayLiteralExpression,
    isFunction,
    NewExpression,
    BigIntLiteral,
    QualifiedName,
    TypeReference,
} = require("./ast");
const {
    Type,
    FunctionType,
    ArrayType,
    ParameterType, ObjectType,
} = require("./type");
const CompileUtils = require('./compileUtils');
const TSUtils = require("../tsUtils");
const global = require("./global");

const config = readConfig();

const canUseVarKeyword = versionObject('java')[0] >= 10;

let library;

function loadLibrary() {
    library = require('./library');
    library.loadLibrary();
}

class JavaBundle {
    #project;
    #basePackage;

    #sourceMap = new Map();

    constructor(project, basePackage) {
        this.#project = project
        this.#basePackage = basePackage;
    }

    getProject() {
        return this.#project;
    }

    generateBundle() {
        this.#project.moduleMap.forEach((module, fullName) => {
            this.#sourceMap.set(fullName, module.getText());
        });
    }

    writeBundle() {
        this.#sourceMap.forEach((source, modulePackage) => {
            const fileName = toJavaFile(modulePackage, this.#basePackage);
            fs.writeFileSync(fileName, source);
        })

    }
}

const tsKindMap = new Map();
for (let key in ts.SyntaxKind) {
    const value = ts.SyntaxKind[key];
    if (!tsKindMap.has(value)) {
        tsKindMap.set(value, key);
    }
}


class JavaParser {
    rootDir;
    basePackage;
    entryFiles = [];
    tsOptions;
    tsProgram;
    project;

    compilerHost;
    compileUtils;

    tsUtils;

    entityResolver = {
        TSPropertyAccessExpression(tsNode, javaNode, closure) {
            const name = tsNode.name;
            const expression = tsNode.expression;

            if (expression && name && expression.escapedText === 'console' && (
                name.escapedText === 'log' || name.escapedText === 'error')) {
                const systemAccess = new PropertyAccessExpression(javaNode, tsNode.pos, tsNode.end);

                const paramType1 = getType('String');
                const param1 = new ParameterDeclaration(systemAccess, 'param1');
                param1.inferType = paramType1;
                systemAccess.inferType = new FunctionType([paramType1], getType('void'));

                systemAccess.name = 'println';

                const outAccess = new PropertyAccessExpression(systemAccess, expression.pos, expression.end);
                systemAccess.expression = outAccess;

                outAccess.name = 'out';

                const systemIdentifier = new Identifier(outAccess, 'System', name.pos, name.end);
                systemIdentifier.inferType = 'System';

                outAccess.expression = systemIdentifier;

                return systemAccess;
            }
        },
        TSIdentifier(tsNode, javaNode, closure) {
            if (javaNode.parent instanceof PropertyAccessExpression) return;
            const text = tsNode.escapedText;
            const module = javaNode.module;

            let identifier;
            switch (text) {
                case 'Set':
                    identifier = new Identifier(javaNode, 'Set', tsNode.pos, tsNode.end);
                    identifier.inferType = 'Set';
                    module.imports.add('java.util.Set');
                    return identifier;
                case 'Map':
                    identifier = new Identifier(javaNode, 'HashMap', tsNode.pos, tsNode.end);
                    identifier.inferType = 'HashMap';
                    module.imports.add('java.util.HashMap');
                    return identifier;
                case 'Array':
                    identifier = new Identifier(javaNode, 'ArrayList', tsNode.pos, tsNode.end);
                    identifier.inferType = 'ArrayList';
                    module.imports.add('java.util.ArrayList');
                    return identifier;
            }
        },
        TSArrayLiteralExpression(tsNode, javaNode, closure) {
            const elements = tsNode.elements;

            const newExpression = new NewExpression(javaNode, tsNode.pos, tsNode.end);
            const expression = new Identifier(newExpression, 'ArrayList', elements.pos, elements.end);
            expression.inferType = 'ArrayList';

            newExpression.expression = expression;
            for (let element of elements) {
                const elementNode = this.visitNode(element, newExpression, closure);
                newExpression.arguments.push(elementNode);
            }
            return newExpression;
        },
    }

    constructor(tsOptions) {
        this.tsOptions = tsOptions;
        const compilerOptions = tsOptions.compilerOptions;
        const rootDir = compilerOptions.rootDir;
        if (rootDir) {
            this.rootDir = path.resolve(rootDir);//.replace(/\\/g, '/');
        } else {
            this.rootDir = process.cwd();//.replace(/\\/g, '/');
        }
        this.basePackage = compilerOptions.basePackage ?? config.java.package;
    }

    parse(entryFiles) {
        loadLibrary();

        this.entryFiles = entryFiles;

        this.TSProgram();
        const sourceFiles = this.tsProgram.getSourceFiles();
        for (const sourceFile of sourceFiles) {
            this.TSSourceFile(sourceFile);
        }
        return new JavaBundle(this.project, this.basePackage);
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

            this.compilerHost = ts.createCompilerHost(compilerOptions, true);

            this.tsProgram = ts.createProgram(this.entryFiles, compilerOptions, this.compilerHost);
            this.project = new Project();
            this.compileUtils = new CompileUtils(this.tsProgram);
            this.tsUtils = new TSUtils(this.tsProgram);
            this.project.compileUtils = this.compileUtils;
            //
            const fullName = `${config.java.package}.FunctionInterface`;
            const fileName = toFileName(fullName, this.basePackage, this.rootDir);
            const moduleMap = this.project.moduleMap;
            let module = moduleMap.get(fullName);
            if (!module) {
                module = new JavaModule(this.project, fileName, config.java.package, 'FunctionInterface');
                moduleMap.set(fullName, module);
            }
        }
    }

    TSSourceFile(sourceFile) {
        const { fileName } = sourceFile;

        const pos = sourceFile.pos;
        const end = sourceFile.end;

        const packageName = toPackageName(fileName, this.basePackage, this.rootDir);
        const name = toClassName(fileName);

        // ast
        const javaModule = new JavaModule(this.project, fileName, packageName, name, pos, end);
        this.project.moduleMap.set(javaModule.fullName, javaModule);

        // child
        for (let statement of sourceFile.statements) {
            const javaStatement = this.visitNode(statement, javaModule, javaModule.closure);
            if (javaStatement) {
                if (javaStatement instanceof Declaration || javaStatement instanceof VariableStatement) {
                } else {
                    javaModule.staticBlock.body.statements.push(javaStatement);
                }
            }
        }
        javaModule.isResolved = true;
    }

    visitNode(tsNode, javaNode, closure) {
        if (!tsNode) return;
        const kind = tsNode.kind;
        const nodeName = tsKindMap.get(kind);
        const visitor = this['TS' + nodeName];
        if (!visitor) {
            let parentName = 'root'
            const parentNode = tsNode.parent;
            if (parentNode) {
                parentName = tsKindMap.get(parentNode.kind);
            }
            log.warn(`unsupported ${nodeName} parent ${parentName} in ${javaNode.module.fileName}.`);
            return;
        }
        return visitor.call(this, tsNode, javaNode, closure);
    }

    createPropertyDeclaration({
                                  accessor, isStatic, isFinal,
                                  type, name, initializer,
                                  javaNode, pos, end, closure
                              }) {

        const propertyDeclaration = new PropertyDeclaration(javaNode, name, pos, end);

        propertyDeclaration.accessor = accessor === undefined ? 'public' : accessor;
        propertyDeclaration.isStatic = isStatic === undefined ? false : isStatic;
        propertyDeclaration.isFinal = isFinal === undefined ? false : isFinal;

        propertyDeclaration.inferType = this.TSType(type, propertyDeclaration, closure);

        const javaInitializer = this.visitNode(initializer, propertyDeclaration, closure);
        if (javaInitializer) {
            propertyDeclaration.initializer = javaInitializer;
            if (javaInitializer.type) {
                const initializerType = javaInitializer.type;
                propertyDeclaration.inferType = initializerType;
                if (initializerType.isFunction) {
                    this.compileUtils.loadFunctionType(initializerType, javaNode.module);
                }
            }
        }
        return propertyDeclaration;
    }

    createVariableDeclaration({
                                  isFinal,
                                  type, name, initializer,
                                  javaNode, pos, end, closure
                              }) {
        const variableDeclaration = new VariableDeclaration(javaNode, name, pos, end);

        variableDeclaration.isFinal = isFinal;
        variableDeclaration.inferType = this.TSType(type, variableDeclaration, closure);

        variableDeclaration.initializer = this.visitNode(initializer, variableDeclaration, closure);
        closure.var(name, variableDeclaration);

        return variableDeclaration;
    }

    createMethodDeclaration({
                                accessor, isStatic, isFinal,
                                type, name, parameters, body,
                                javaNode, pos, end
                            }) {
        const methodDeclaration = new MethodDeclaration(javaNode, name, pos, end);

        methodDeclaration.accessor = accessor === undefined ? 'public' : accessor;
        methodDeclaration.isStatic = isStatic === undefined ? false : isStatic;
        methodDeclaration.isFinal = isFinal === undefined ? false : isFinal;

        methodDeclaration.initialReturnType = this.TSType(type, methodDeclaration, methodDeclaration.closure);

        for (let parameter of parameters) {
            const javaParameter = this.TSParameter(parameter, methodDeclaration, methodDeclaration.closure);
            methodDeclaration.addParameter(javaParameter);
        }

        if (body) {
            const javaBlock = this.TSBlock(body, methodDeclaration, methodDeclaration.closure);
            methodDeclaration.body = javaBlock;
            methodDeclaration.inferReturnType = javaBlock.inferReturnType;
        }

        return methodDeclaration;
    }

    createLambdaFunction({
                             type, parameters, body,
                             javaNode, pos, end
                         }) {
        const lambdaFunction = new LambdaFunction(javaNode, pos, end);

        lambdaFunction.initialReturnType = this.TSType(type, lambdaFunction, lambdaFunction.closure);

        for (let parameter of parameters) {
            const javaParameter = this.TSParameter(parameter, lambdaFunction, lambdaFunction.closure);
            lambdaFunction.addArgument(javaParameter);
        }

        const javaBlock = this.TSBlock(body, lambdaFunction, lambdaFunction.closure);
        lambdaFunction.body = javaBlock;
        lambdaFunction.inferReturnType = javaBlock.inferReturnType;

        return lambdaFunction;
    }

    parseStatements(tsNode, block, closure) {
        const statements = tsNode.statements;
        for (let statement of statements) {
            const javaStatement = this.visitNode(statement, block, closure);
            if (javaStatement) {
                block.statements.push(javaStatement);
            }
        }
    }

    /// a: Array<number>
    TSType(tsNode, javaNode, closure) {
        if (!tsNode) return;

        let typeText = '';
        switch (tsNode.kind) {
            case ts.SyntaxKind.Identifier:
                typeText = tsNode.escapedText;
                break;
            case ts.SyntaxKind.ArrayType:// string[]
                const elementType = this.TSType(tsNode.elementType, javaNode, closure);
                return new ArrayType(elementType);
            case ts.SyntaxKind.QualifiedName:// xxx.yyy
                const qualifiedName = new QualifiedName(javaNode, ts.pos, ts.end);
                const left = this.TSType(tsNode.left, qualifiedName, closure);
                qualifiedName.left = left;
                qualifiedName.right = this.membersType(tsNode.right, qualifiedName, left.members);
                return qualifiedName;
            case ts.SyntaxKind.TypeReference:// Array<string>
                const typeReference = new TypeReference(javaNode, tsNode.pos, tsNode.end);
                const typeName = this.TSType(tsNode.typeName, javaNode, closure);
                typeReference.typeName = typeName;

                const typeArguments = tsNode.typeArguments;
                if (typeArguments) {
                    for (let typeArgument of typeArguments) {
                        const argumentType = this.TSType(typeArgument, javaNode, closure);
                        typeReference.addArgument(argumentType);
                    }
                }
                return typeReference;
            case ts.SyntaxKind.ConditionalType:
                throw new TypeError('unsupported ConditionType');
            default:
                typeText = this.keywordType(tsNode.kind);
                if (!typeText) {
                    throw new Error(tsKindMap.get(tsNode.kind));
                }
        }

        ///
        const declaration = closure.get(typeText);
        if (declaration) {
            return declaration.type;
        }

        const type = global.get(typeText);
        if (!type) {
            log.warn(`unknown type ${typeText}`);
            return ObjectType;
        }
        return type;
    }

    keywordType(keyword) {
        switch (keyword) {
            case ts.SyntaxKind.AnyKeyword:
                return 'any';
            case ts.SyntaxKind.BigIntKeyword:
                return 'int';
            case ts.SyntaxKind.BooleanKeyword:
                return 'boolean';
            case ts.SyntaxKind.IntrinsicKeyword:
                return 'intrinsic';
            case ts.SyntaxKind.NeverKeyword:
                return 'never';
            case ts.SyntaxKind.NumberKeyword:
                return 'number';
            case ts.SyntaxKind.ObjectKeyword:
                return 'Object';
            case ts.SyntaxKind.StringKeyword:
                return 'string';
            case ts.SyntaxKind.SymbolKeyword:
                return 'symbol';
            case ts.SyntaxKind.UndefinedKeyword:
                return 'undefined';
            case ts.SyntaxKind.UnknownKeyword:
                return 'unknown';
            case ts.SyntaxKind.VoidKeyword:
                return 'void';
            case ts.SyntaxKind.UnionType:
                return 'UnionType';
        }
    }

    membersType(tsNode, javaNode, members) {
        if (!tsNode) return;

        let typeText = '';
        switch (tsNode.kind) {
            case ts.SyntaxKind.Identifier:
                typeText = tsNode.escapedText;
                break;
            case ts.SyntaxKind.ArrayType:// string[]
                const elementType = this.membersType(tsNode.elementType, javaNode, members);
                return new ArrayType(elementType);
            case ts.SyntaxKind.QualifiedName:// xxx.yyy
                const qualifiedName = new QualifiedName(javaNode, ts.pos, ts.end);
                const left = this.membersType(tsNode.left, qualifiedName, members);
                qualifiedName.left = left;
                qualifiedName.right = this.membersType(tsNode.right, qualifiedName, left.members);
                return qualifiedName;
            case ts.SyntaxKind.TypeReference:// Array<string>
                const typeReference = new TypeReference(javaNode, tsNode.pos, tsNode.end);
                const typeName = this.membersType(tsNode.typeName, javaNode, members);
                typeReference.typeName = typeName;

                const typeArguments = tsNode.typeArguments;
                if (typeArguments) {
                    for (let typeArgument of typeArguments) {
                        const argumentType = this.membersType(typeArgument, javaNode, members);
                        typeReference.addArgument(argumentType);
                    }
                }
                return typeReference;
            default:
                typeText = this.keywordType(tsNode.kind);
                if (!typeText) {
                    throw new Error(tsKindMap.get(tsNode.kind));
                }
        }

        ///
        let type = members.get(typeText);
        if (type) {
            return type;
        }

        type = global.get(typeText);
        if (!type) {
            log.warn(`unknown type ${typeText}`);
            return ObjectType;
        }
        return type;
    }


    ///a();
    ///b = a;
    ///a = 1;
    TSIdentifier(tsNode, javaNode, closure) {
        const tryEntity = this.entityResolver['TSIdentifier'];
        if (tryEntity) {
            const entity = tryEntity.call(this, tsNode, javaNode, closure);
            if (entity) return entity;
        }

        const text = tsNode.escapedText;

        const identifier = new Identifier(javaNode, text, tsNode.pos, tsNode.end);
        let declaration = closure.get(text);
        if (declaration) {
            identifier.inferType = declaration.type;
            identifier.declaration = declaration;
            declaration.refs.add(identifier);
            return identifier;
        }

        const module = javaNode.module;
        declaration = module.namedBindings.get(text);
        if (declaration) {
            identifier.text = declaration.exportName;
            identifier.inferType = declaration.type;
            identifier.declaration = declaration;
            declaration.refs.add(identifier);
            return identifier;
        }

        const libType = library.typeMapper.get(text);
        if (libType) {
            if (libType.moduleFullName) {
                module.imports.add(libType.moduleFullName);
            }
            identifier.inferType = libType;
            // identifier.declaration = libraryModule;
            return identifier;
        }

        let parentName = 'root'
        const parentNode = tsNode.parent;
        if (parentNode) {
            parentName = tsKindMap.get(parentNode.kind);
        }
        throw new ReferenceError(`${text} is not defined. parent ${parentName}, file ${module.fileName}.`);
    }

    /// a.b
    /// a.b()
    TSPropertyAccessExpression(tsNode, javaNode, closure) {
        const tryEntity = this.entityResolver['TSPropertyAccessExpression'];
        if (tryEntity) {
            const entity = tryEntity.call(this, tsNode, javaNode, closure);
            if (entity) return entity;
        }

        const name = tsNode.name;
        const expression = tsNode.expression;

        const propertyAccessExpression = new PropertyAccessExpression(javaNode, tsNode.pos, tsNode.end);
        propertyAccessExpression.name = new Identifier(propertyAccessExpression, name.escapedText, name.pos, name.end);
        propertyAccessExpression.expression = this.visitNode(expression, propertyAccessExpression, closure);

        return propertyAccessExpression;
    }

    ///let arr = [1,2,3];
    TSArrayLiteralExpression(tsNode, javaNode, closure) {
        const tryEntity = this.entityResolver['TSArrayLiteralExpression'];
        if (tryEntity) {
            const entity = tryEntity.call(this, tsNode, javaNode, closure);
            if (entity) return entity;
        }

        const arrayLiteralExpression = new ArrayLiteralExpression(javaNode, tsNode.pos, tsNode.end);
        const elements = tsNode.elements;
        for (let element of elements) {
            const javaElement = this.visitNode(element, arrayLiteralExpression, closure);
            arrayLiteralExpression.addElement(javaElement);
        }

    }

    ///this.a
    TSThisKeyword(tsNode, javaNode, closure) {
        return new ThisKeyword(javaNode, tsNode.pos, tsNode.end);
    }

    ///import a from 'b'
    TSImportDeclaration(tsNode, javaNode, closure) {
        const importClause = tsNode.importClause;
        const moduleSpecifier = tsNode.moduleSpecifier.text;

        const currentModule = javaNode.module;

        const fileDir = path.dirname(currentModule.fileName);

        let modulePath = path.resolve(fileDir, moduleSpecifier);
        const { packageName, fullName } = toClassInfo(modulePath, this.basePackage, this.rootDir);
        const modulePackage = fullName;

        if (packageName !== currentModule.packageName) {
            currentModule.imports.add(modulePackage);
        }

        const module = this.project.moduleMap.get(modulePackage);
        if (!module) return;

        if (!importClause) return;

        const moduleClosure = module.closure;
        if (importClause.name) {
            const moduleNamed = importClause.name.escapedText;
            module.exportName = module.name;
            currentModule.namedBindings.set(moduleNamed, module);
        }

        const namedBindings = importClause.namedBindings;
        if (namedBindings) {
            for (let element of namedBindings.elements) {
                const propertyBinding = element.name.escapedText;

                let propertyName = propertyBinding;
                if (element.propertyName) {
                    propertyName = element.propertyName.escapedText;

                    if (propertyName === 'default') {
                        let declaration = moduleClosure.local('exportDefault');
                        if (declaration) {
                            declaration.exportName = module.name + '.' + declaration.name;
                        } else {
                            declaration = module;
                            declaration.exportName = module.name;
                        }
                        currentModule.namedBindings.set(propertyBinding, declaration);
                        return;
                    }

                }
                const declaration = moduleClosure.local(propertyName);
                if (declaration) {
                    declaration.exportName = module.name + '.' + declaration.name
                    currentModule.namedBindings.set(propertyBinding, declaration);
                }
            }
        }
    }

    ///export default a = 1;
    TSExportAssignment(tsNode, javaNode, closure) {
        const expression = tsNode.expression;

        const module = javaNode.module;
        const name = 'exportDefault';

        const propertyDeclaration = new PropertyDeclaration(module, name);
        propertyDeclaration.accessor = 'public';
        propertyDeclaration.isStatic = true;
        propertyDeclaration.isFinal = true;

        propertyDeclaration.initializer = this.visitNode(expression, defaultClass, defaultClass.closure);

        return propertyDeclaration;
    }

    /// class a {}
    TSClassDeclaration(tsNode, javaNode, closure) {
        const name = tsNode.name.escapedText;

        const pos = tsNode.pos;
        const end = tsNode.end;

        let classDeclaration;
        let { isDeclare, isExport, isDefault, accessor, isStatic, isFinal } = this.tsUtils.parseModifiers(tsNode);

        const build = () => {
            classDeclaration.accessor = accessor === undefined ? 'public' : accessor;
            classDeclaration.isStatic = isStatic === undefined ? false : isStatic;
            classDeclaration.isFinal = isFinal === undefined ? false : isFinal;

            const members = tsNode.members;
            for (let member of members) {
                const memberNode = this.visitNode(member, classDeclaration, classDeclaration.closure);
                if (memberNode) {
                    classDeclaration.addMember(memberNode);
                }
            }
        };
        if (isExport) {
            const module = javaNode.module;
            if (isDefault) {
                isStatic = false;
                classDeclaration = module;
                classDeclaration.pos = pos;
                classDeclaration.end = end;
            } else {
                classDeclaration = new ClassDeclaration(javaNode, name, pos, end);
                module.addMember(classDeclaration);
            }
            build();
        } else {
            classDeclaration = new ClassDeclaration(javaNode, name, pos, end);
            closure.var(name, classDeclaration);

            if (javaNode instanceof JavaModule) {
                javaNode.addMember(classDeclaration);
            } else if (javaNode instanceof Block) {
                closure.var(name, classDeclaration);
            }
            build();

            return classDeclaration;
        }
    }

    TSClassStaticBlockDeclaration(tsNode, javaNode, closure) {
        const body = tsNode.body;

        const classStaticBlockDeclaration = new ClassStaticBlockDeclaration(javaNode, tsNode.pos, tsNode.end);
        const javaBody = classStaticBlockDeclaration.body;
        this.parseStatements(body, javaBody, classStaticBlockDeclaration.closure);

        return classStaticBlockDeclaration;
    }

    /// 1 + 2;
    TSBinaryExpression(tsNode, javaNode, closure) {
        const left = tsNode.left;
        const right = tsNode.right;
        const operatorToken = tsNode.operatorToken;

        const binaryExpression = new BinaryExpression(javaNode, tsNode.pos, tsNode.end);
        binaryExpression.left = this.visitNode(left, binaryExpression, closure);
        binaryExpression.right = this.visitNode(right, binaryExpression, closure);
        binaryExpression.operator = this.tsUtils.parseOperator(operatorToken);

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

        let { isDeclare, isExport, isDefault, accessor, isStatic } = this.tsUtils.parseModifiers(tsNode);

        const variableStatement = new VariableStatement(javaNode, tsNode.pos, tsNode.end);
        variableStatement.isDeclare = isDeclare;
        variableStatement.accessor = accessor;
        variableStatement.isStatic = isStatic;
        variableStatement.declarationList = this.TSVariableDeclarationList(declarationList, variableStatement, closure);

        return variableStatement;
    }

    /// let a=1, b=2;
    TSVariableDeclarationList(tsNode, javaNode, closure) {
        const declarationList = tsNode;
        const parentNode = javaNode.parent;

        const accessor = javaNode.accessor;
        const isStatic = javaNode.isStatic;

        let isFinal = false;
        switch (declarationList.flags) {
            case ts.NodeFlags.Const:
                isFinal = true;
                break;
        }

        if (parentNode.isDeclare) {
            for (let declaration of declarationList.declarations) {
                const name = declaration.name.escapedText;
                const initializer = declaration.initializer;
                const type = declaration.type;

                const variableDeclaration = this.createVariableDeclaration({
                    isFinal, type, name, initializer,
                    javaNode: variableDeclarationList, pos: declaration.pos, end: declaration.end, closure
                });
                global.set(name, variableDeclaration);
            }
        } else if (parentNode instanceof JavaModule) {
            for (let declaration of declarationList.declarations) {
                const name = declaration.name.escapedText;
                const initializer = declaration.initializer;
                const type = declaration.type;

                const propertyDeclaration = this.createPropertyDeclaration({
                    accessor, isStatic, isFinal, type, name, initializer,
                    javaNode: parentNode, pos: declaration.pos, end: declaration.end, closure
                });

                const javaInitializer = this.visitNode(initializer, propertyDeclaration, closure);
                if (javaInitializer instanceof Identifier &&
                    javaInitializer.type && javaInitializer.type.isFunction) {
                    javaInitializer.text = javaInitializer.text.replace(/\.([^\.]+)$/, '::$1');
                }
                propertyDeclaration.initializer = javaInitializer;
                parentNode.addMember(propertyDeclaration);
            }
        } else {
            const variableDeclarationList = new VariableDeclarationList(javaNode, javaNode.pos, javaNode.end);
            for (let declaration of declarationList.declarations) {
                const name = declaration.name.escapedText;
                const initializer = declaration.initializer;
                const type = declaration.type;

                const variableDeclaration = this.createVariableDeclaration({
                    isFinal, type, name, initializer,
                    javaNode: variableDeclarationList, pos: declaration.pos, end: declaration.end, closure
                });
                variableDeclarationList.declarations.push(variableDeclaration);
            }
            return variableDeclarationList;
        }
    }

    ///new A();
    TSNewExpression(tsNode, javaNode, closure) {
        const expression = tsNode.expression;
        const argumentNodes = tsNode.arguments;

        const newExpression = new NewExpression(javaNode, tsNode.pos, tsNode.end);
        newExpression.expression = this.visitNode(expression, newExpression, closure);

        for (let argumentNode of argumentNodes) {
            newExpression.addArgument(this.visitNode(argumentNode, newExpression, closure));
        }

        return newExpression;
    }

    ///a(1, 2);
    TSCallExpression(tsNode, javaNode, closure) {
        const expression = tsNode.expression;
        const argumentNodes = tsNode.arguments;

        const callExpression = new CallExpression(javaNode, tsNode.pos, tsNode.end);
        const javaExpression = this.visitNode(expression, callExpression, closure);
        if (javaExpression instanceof Identifier &&
            javaExpression.type && javaExpression.type.isFunction &&
            (javaExpression.declaration instanceof VariableDeclaration ||
                javaExpression.declaration instanceof PropertyDeclaration)) {
            javaExpression.text += '.call';
        }
        callExpression.expression = javaExpression;
        for (let argumentNode of argumentNodes) {
            const javaArgument = this.visitNode(argumentNode, callExpression, closure);
            callExpression.addArgument(javaArgument);
        }
        return callExpression;
    }

    ///try {} catch(e) {} finally {}
    TSTryStatement(tsNode, javaNode, closure) {
        const tryBlock = tsNode.tryBlock;
        const catchClause = tsNode.catchClause;
        const finallyBlock = tsNode.finallyBlock;

        const tryStatement = new TryStatement(javaNode, tsNode.pos, tsNode.end);
        tryStatement.tryBlock = this.TSBlock(tryBlock, tryStatement, tryStatement.tryClosure);
        tryStatement.catchClause = this.visitNode(catchClause, tryStatement, tryStatement.catchClosure);
        tryStatement.finallyBlock = this.TSBlock(finallyBlock, tryStatement, tryStatement.finallyClosure);

        return tryStatement;
    }

    ///catch(e) {}
    TSCatchClause(tsNode, javaNode, closure) {
        const variableDeclaration = tsNode.variableDeclaration;
        const variableName = variableDeclaration.name;
        const name = new Identifier(javaNode, variableName.escapedText, variableName.pos, variableName.end);
        const block = tsNode.block;

        const catchClause = new CatchClause(javaNode, tsNode.pos, tsNode.end);
        const declaration = new VariableDeclaration(catchClause, name, variableName.pos, variableName.end);
        declaration.name = name;
        closure.var(name, declaration);
        catchClause.variableDeclaration = declaration;
        catchClause.block = this.visitNode(block, catchClause, closure);

        return catchClause;
    }

    ///function a() {}
    TSFunctionDeclaration(tsNode, javaNode, closure) {
        const name = tsNode.name ? tsNode.name.escapedText : '';
        const type = tsNode.type;
        const parameters = tsNode.parameters;
        const body = tsNode.body;

        const pos = tsNode.pos;
        const end = tsNode.end;

        let { isExport, isDefault, accessor, isStatic, isFinal } = this.tsUtils.parseModifiers(tsNode);

        if (isExport) {
            const module = javaNode.module;
            if (name) {
                if (isDefault) {
                    const methodDeclaration = this.createMethodDeclaration({
                        accessor: 'private', isStatic, isFinal, type, name, parameters, body, javaNode, pos, end,
                    });
                    module.addMember(methodDeclaration);

                    const propertyDeclaration = this.createPropertyDeclaration({
                        accessor, isStatic, isFinal, type: methodDeclaration.type, name: 'exportDefault',
                        javaNode: module, pos, end, closure
                    });
                    const identifier = new Identifier(propertyDeclaration, name);
                    identifier.inferType = methodDeclaration.type;
                    identifier.declaration = methodDeclaration;

                    propertyDeclaration.initializer = identifier;
                    module.addMember(propertyDeclaration);
                } else {
                    const methodDeclaration = this.createMethodDeclaration({
                        accessor, isStatic, isFinal, type, name, parameters, body, javaNode: module, pos, end,
                    });
                    module.addMember(methodDeclaration);
                }
            } else {
                const methodDeclaration = this.createMethodDeclaration({
                    accessor,
                    isStatic,
                    isFinal,
                    type,
                    name: 'exportDefault',
                    parameters,
                    body,
                    javaNode: classDeclaration,
                    pos,
                    end,
                });
                classDeclaration.addMember(methodDeclaration);
            }
        } else {
            if (javaNode instanceof JavaModule) {
                const methodDeclaration = this.createMethodDeclaration({
                    accessor, isStatic, isFinal, type, name, parameters, body, javaNode, pos, end,
                });
                javaNode.addMember(methodDeclaration);
            } else {
                if (name) {
                    const propertyDeclaration = this.createPropertyDeclaration({
                        accessor, isStatic, isFinal, type, name,
                        javaNode, pos, end, closure
                    });

                    const initializer = this.createLambdaFunction({
                        type, parameters, body, javaNode: propertyDeclaration, name, pos, end
                    });
                    propertyDeclaration.initializer = initializer;
                    propertyDeclaration.inferType = initializer.type;
                    return propertyDeclaration;
                } else {
                    return this.createLambdaFunction({
                        type, parameters, body, javaNode, pos, end,
                    })
                }
            }
        }
    }

    ///++i
    TSPrefixUnaryExpression(tsNode, javaNode, closure) {
        const operand = tsNode.operand;
        const operator = tsNode.operator;

        const prefixUnaryExpression = new PrefixUnaryExpression(javaNode, tsNode.pos, tsNode.end);
        prefixUnaryExpression.operand = this.visitNode(operand, prefixUnaryExpression, closure);
        const compileUtils = this.project.compileUtils;
        prefixUnaryExpression.operator = compileUtils.parseToken(operator);
        return prefixUnaryExpression;
    }

    ///i++
    TSPostfixUnaryExpression(tsNode, javaNode, closure) {
        const operand = tsNode.operand;
        const operator = tsNode.operator;

        const postfixUnaryExpression = new PostfixUnaryExpression(javaNode, tsNode.pos, tsNode.end);
        postfixUnaryExpression.operand = this.visitNode(operand, postfixUnaryExpression, closure);
        const compileUtils = this.project.compileUtils;
        postfixUnaryExpression.operator = compileUtils.parseToken(operator);
        return postfixUnaryExpression;
    }

    ///for(let i=0; i< 3; i++) {}
    TSForStatement(tsNode, javaNode, closure) {
        const initializer = tsNode.initializer;
        const condition = tsNode.condition;
        const incrementor = tsNode.incrementor;
        const statement = tsNode.statement;

        const forStatement = new ForStatement(javaNode, tsNode.pos, tsNode.end);
        const javaInitializer = this.visitNode(initializer, forStatement, forStatement.closure);
        if (javaInitializer) {
            if (javaInitializer instanceof VariableStatement &&
                javaInitializer.declarationList.declarations.length > 1) {
                throw new Error(`'${initializer.getText()}' is not allowed in a compound declaration`);
            } else {
                forStatement.initializer = javaInitializer;
            }
        }

        forStatement.condition = this.visitNode(condition, forStatement, forStatement.closure);

        forStatement.incrementor = this.visitNode(incrementor, forStatement, forStatement.closure);

        forStatement.statement = this.TSBlock(statement, forStatement, forStatement.closure);

        return forStatement;
    }

    ///for(let key in object) {}
    TSForInStatement(tsNode, javaNode, closure) {
        const initializer = tsNode.initializer;
        const expression = tsNode.expression;
        const statement = tsNode.statement;


        const forInStatement = new ForInStatement(javaNode, tsNode.pos, tsNode.end);
        const javaInitializer = this.visitNode(initializer, forInStatement, forInStatement.closure);
        if (javaInitializer) {
            if (javaInitializer instanceof VariableStatement &&
                javaInitializer.declarationList.declarations.length > 1) {
                throw new Error(`'${initializer.getText()}' is not allowed in a compound declaration`);
            } else {
                forInStatement.initializer = javaInitializer;
            }
        }

        forInStatement.expression = this.visitNode(expression, forInStatement, forInStatement.closure);

        forInStatement.statement = this.TSBlock(statement, forInStatement, forInStatement.closure);

        return forInStatement;
    }

    ///for(let item of array) {}
    TSForOfStatement(tsNode, javaNode, closure) {
        const initializer = tsNode.initializer;
        const expression = tsNode.expression;
        const statement = tsNode.statement;


        const forOfStatement = new ForOfStatement(javaNode, tsNode.pos, tsNode.end);
        const javaInitializer = this.visitNode(initializer, forOfStatement, forOfStatement.closure);
        if (javaInitializer) {
            if (javaInitializer instanceof VariableStatement &&
                javaInitializer.declarationList.declarations.length > 1) {
                throw new Error(`'${initializer.getText()}' is not allowed in a compound declaration`);
            }
            forOfStatement.initializer = javaInitializer;
        }

        forOfStatement.expression = this.visitNode(expression, forOfStatement, forOfStatement.closure);

        forOfStatement.statement = this.TSBlock(statement, forOfStatement, forOfStatement.closure);

        return forOfStatement;
    }

    ///if (a == 1) {} else if (a == 2) {} else {}
    TSIfStatement(tsNode, javaNode, closure) {
        const expression = tsNode.expression;
        const thenStatement = tsNode.thenStatement;
        const elseStatement = tsNode.elseStatement;

        const ifStatement = new IfStatement(javaNode, tsNode.pos, tsNode.end);
        ifStatement.expression = this.visitNode(expression, ifStatement, closure);

        ifStatement.thenStatement = this.visitNode(thenStatement, ifStatement, ifStatement.thenClosure);

        if (elseStatement instanceof IfStatement) {
            ifStatement.elseStatement = this.visitNode(elseStatement, ifStatement, closure);
        } else {
            ifStatement.elseStatement = this.visitNode(elseStatement, ifStatement, ifStatement.elseClosure);
        }
        return ifStatement;
    }

    ///switch(a) {}
    TSSwitchStatement(tsNode, javaNode, closure) {
        const expression = tsNode.expression;
        const caseBlock = tsNode.caseBlock;
        const clauses = caseBlock.clauses;

        const switchStatement = new SwitchStatement(javaNode, tsNode.pos, tsNode.end);
        const javaCaseBlock = new CaseBlock(switchStatement, caseBlock.pos, caseBlock.end);
        switchStatement.caseBlock = javaCaseBlock;
        for (let clause of clauses) {
            const javaClause = this.visitNode(clause, javaCaseBlock, closure);
            if (javaClause) {
                javaCaseBlock.clauses.push(javaClause);
            }
        }

        return switchStatement;
    }

    ///switch(a) { case 1: }
    TSCaseClause(tsNode, javaNode, closure) {
        const expression = tsNode.expression;

        const caseClause = new CaseClause(javaNode, tsNode.pos, tsNode.end);
        caseClause.expression = this.visitNode(expression, caseClause, closure);
        this.parseStatements(tsNode, caseClause, caseClause.closure);

        return caseClause;
    }

    ///throw error;
    TSThrowStatement(tsNode, javaNode, closure) {
        const expression = tsNode.expression;

        const throwStatement = new ThrowStatement(javaNode, tsNode.pos, tsNode.end);
        throwStatement.expression = this.visitNode(expression, throwStatement, closure);

        return throwStatement;

    }

    ///switch(a) { default: }
    TSDefaultClause(tsNode, javaNode, closure) {

        const defaultClause = new DefaultClause(javaNode, tsNode.pos, tsNode.end);
        this.parseStatements(tsNode, defaultClause, defaultClause.closure);

        return defaultClause;
    }

    ///return a;
    TSReturnStatement(tsNode, javaNode, closure) {
        const expression = tsNode.expression;
        const pos = tsNode.pos;
        const end = tsNode.end;

        const returnStatement = new ReturnStatement(javaNode, pos, end);
        if (expression) {
            const javaExpression = this.visitNode(expression, returnStatement, closure);
            returnStatement.expression = javaExpression;

            const block = this.compileUtils.getBlockFromNode(javaNode);
            block.inferReturnType = javaExpression.type;
        }
        return returnStatement;
    }

    ///break;
    TSBreakStatement(tsNode, javaNode, closure) {
        return new BreakStatement(javaNode, tsNode.pos, tsNode.end);
    }

    ///continue;
    TSContinueStatement(tsNode, javaNode, closure) {
        return new ContinueStatement(javaNode, tsNode.pos, tsNode.end);
    }

    ///a=1+2;
    ///a();
    ///new A();
    ///++i;
    ///i--;
    ///a.b;
    TSExpressionStatement(tsNode, javaNode, closure) {
        return this.visitNode(tsNode.expression, javaNode, closure);
    }

    ///class A { constructor() {} }
    TSConstructor(tsNode, javaNode, closure) {
        const parameters = tsNode.parameters;
        const body = tsNode.body;

        const pos = tsNode.pos;
        const end = tsNode.end;

        const constructorDeclaration = new ConstructorDeclaration(javaNode, pos, end);
        javaNode.addMember(constructorDeclaration);

        const { accessor, isStatic, isFinal } = this.tsUtils.parseModifiers(tsNode);

        constructorDeclaration.accessor = accessor === undefined ? 'public' : accessor;
        constructorDeclaration.isStatic = isStatic === undefined ? false : isStatic;
        constructorDeclaration.isFinal = isFinal === undefined ? false : isFinal;

        for (let parameter of parameters) {
            const javaParameter = this.TSParameter(parameter, constructorDeclaration, constructorDeclaration.closure);
            constructorDeclaration.addParameter(javaParameter);
        }

        constructorDeclaration.body = this.TSBlock(body, constructorDeclaration, constructorDeclaration.closure);
        // constructorDeclaration.inferReturnType = body.inferReturnType;
    }

    ///class A { private int b = 1; }
    TSPropertyDeclaration(tsNode, javaNode, closure) {
        const name = tsNode.name.escapedText;
        const type = tsNode.type;
        const initializer = tsNode.initializer;

        const pos = tsNode.pos;
        const end = tsNode.end;

        const { accessor, isStatic, isFinal } = this.tsUtils.parseModifiers(tsNode);

        return this.createPropertyDeclaration({
            accessor, isStatic, isFinal, type, name, initializer, javaNode, pos, end, closure
        })
    }

    ///class A { public int b(double c) {} }
    TSMethodDeclaration(tsNode, javaNode, closure) {
        const name = tsNode.name.escapedText;
        const type = tsNode.type;
        const parameters = tsNode.parameters;
        const body = tsNode.body;

        const pos = tsNode.pos;
        const end = tsNode.end;

        const { accessor, isStatic, isFinal } = this.tsUtils.parseModifiers(tsNode);

        return this.createMethodDeclaration({
            accessor, isStatic, isFinal, type, name, parameters, body, javaNode, pos, end
        });
    }

    ///function fun() {}
    ///class A { fun() {} }
    TSBlock(tsNode, javaNode, closure) {
        if (!tsNode) return;
        const pos = tsNode.pos;
        const end = tsNode.end;

        const block = new Block(javaNode, pos, end);
        this.parseStatements(tsNode, block, closure);

        return block;
    }

    ///function a(p=2) {}
    ///class A { fun(p=2) {} }
    TSParameter(tsNode, javaNode, closure) {
        const name = tsNode.name;
        const paramName = name.escapedText;
        const type = tsNode.type;
        const initializer = tsNode.initializer;
        const dotDotDotToken = tsNode.dotDotDotToken;

        const pos = tsNode.pos;
        const end = tsNode.end;

        const parameterDeclaration = new ParameterDeclaration(javaNode, paramName, pos, end);

        const paramType = this.TSType(type, parameterDeclaration, closure);
        if (dotDotDotToken) {
            paramType.isDotDotDot = true;
        }
        parameterDeclaration.inferType = paramType;

        parameterDeclaration.initializer = this.visitNode(initializer, parameterDeclaration, closure);

        return parameterDeclaration;
    }

    ///true
    TSTrueKeyword(tsNode, javaNode, closure) {
        return new TrueKeyword(javaNode, tsNode.pos, tsNode.end);
    }

    ///false
    TSFalseKeyword(tsNode, javaNode, closure) {
        return new FalseKeyword(javaNode, tsNode.pos, tsNode.end);
    }

    ///a = 1;
    TSNumericLiteral(tsNode, javaNode, closure) {
        return new NumericLiteral(javaNode, tsNode.text, tsNode.pos, tsNode.end);
    }

    ///a = 1n;
    TSBigIntLiteral(tsNode, javaNode, closure) {
        return new BigIntLiteral(javaNode, tsNode.text, tsNode.pos, tsNode.end);
    }

    ///a = 'string';
    TSStringLiteral(tsNode, javaNode, closure) {
        return new StringLiteral(javaNode, tsNode.text, tsNode.pos, tsNode.end);
    }

    ////^\d{11}$/
    TSRegularExpressionLiteral(tsNode, javaNode, closure) {
        return new RegularExpressionLiteral(javaNode, tsNode.text, tsNode.pos, tsNode.end);
    }

    /// declare module '/xxx/yyy'
    /// declare namespace zzz
    TSModuleDeclaration(tsNode, javaNode, closure) {
        const name = tsNode.name;
        const body = tsNode.body;

        const { isDeclare } = this.tsUtils.parseModifiers(tsNode);

        if (isDeclare) {
            let text;
            if (name.kind === ts.SyntaxKind.Identifier) {
                text = name.escapedText;
            } else if (name.kind === ts.SyntaxKind.StringLiteral) {
                text = name.text;
            }

            const filename = javaNode.module.fileName;

            const javaModule = new JavaModule(this.project, filename, null, text, tsNode.pos, tsNode.end);

            for (let statement of body.statements) {
                this.visitNode(statement, javaModule, javaModule.closure);
            }
            global.set(text, javaModule);
        }
    }

    /// interface xxx {}
    TSInterfaceDeclaration(tsNode, javaNode, closure) {
        const name = tsNode.name;

        const text = name.escapedText;

        const filename = javaNode.module.fileName;

        const classDeclaration = new ClassDeclaration(javaNode, text, tsNode.pos, tsNode.end);

        for (let member of tsNode.members) {
            const javaMember = this.visitNode(member, classDeclaration, classDeclaration.closure);
            classDeclaration.addMember(javaMember);
        }

        if (filename.endsWith('.d.ts') && javaNode instanceof JavaModule) {
            global.set(text, classDeclaration);
            return;
        }
        return classDeclaration;
    }

    /// interface xxx { ['methodSignature']() {} }
    TSMethodSignature(tsNode, javaNode, closure) {
        const name = tsNode.name;
        const type = tsNode.type;
        const parameters = tsNode.parameters;
        const body = tsNode.body;

        const pos = tsNode.pos;
        const end = tsNode.end;

        const { accessor, isStatic, isFinal } = this.tsUtils.parseModifiers(tsNode);

        let text;
        if (name.kind === ts.SyntaxKind.Identifier) {
            text = name.escapedText;
        } else if (name.kind === ts.SyntaxKind.ComputedPropertyName) {
            text = name.expression.text;
        }

        return this.createMethodDeclaration({
            accessor, isStatic, isFinal, type, name:text, parameters, body, javaNode, pos, end
        });
    }
}

module.exports = JavaParser;
