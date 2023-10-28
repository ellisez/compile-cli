const ts = require("typescript");
const path = require("node:path");
const { readConfig, versionObject } = require('../config.js');
const EventCenter = require("./event.js");
const { entryFile } = require("../pkg.js");
const log = require('../log.js');
const fs = require('node:fs');
const {
    toCamel, toFileName, toPackageName, toClassName, toClassInfo, toJavaFile,
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
    FunctionDeclaration,
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
    Type,
    NormalType,
    ArrayType,
    VoidType,
    BooleanType,
    IntType,
    DoubleType,
    StringType,
    PatternType,
} = require("./ast.js");
const { NewExpression } = require("./ast");

const config = readConfig();

const canUseVarKeyword = versionObject('java')[0] >= 10;

class JavaBundle {
    #project;

    #sourceMap = new Map();

    constructor(project) {
        this.#project = project;
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
            const fileName = toJavaFile(modulePackage);
            fs.writeFileSync(fileName, source);
        })

    }
}

class JavaParser {
    tsOptions;
    tsProgram;
    #TSKindMap = {};
    project;

    compileUtils;

    typeResolver(tsType, module) {
        if (tsType) {
            switch (tsType) {
                case 'number':
                    tsType = 'double';
                    break;
                case 'bigint':
                    tsType = 'int';
                    break;
                case 'string':
                    tsType = 'String';
                    break;
                case 'Set':
                    module.imports.add('java.util.HashSet');
                    tsType = 'HashSet';
                    break;
                case 'Map':
                    module.imports.add('java.util.HashMap');
                    tsType = 'HashMap';
                    break;
                case 'Array':
                    module.imports.add('java.util.ArrayList');
                    tsType = 'ArrayList';
                    break;
            }
            return new NormalType(tsType);
        }
    }

    entityResolver = {
        TSPropertyAccessExpression(tsNode, javaNode, closure) {
            const name = tsNode.name;
            const expression = tsNode.expression;

            if (expression && name && expression.escapedText === 'console' && (
                name.escapedText === 'log' || name.escapedText === 'error')) {
                const systemAccess = new PropertyAccessExpression(javaNode, tsNode.pos, tsNode.end);

                const printIdentifier = new Identifier(systemAccess, name.pos, name.end);
                printIdentifier.text = 'println';

                const functionDeclaration = new FunctionDeclaration(javaNode, '');
                functionDeclaration.parameters = ['param1'];
                functionDeclaration.typeParameters = [StringType];

                printIdentifier.implicitType = this.compileUtils.importFunctionType(functionDeclaration);

                systemAccess.name = printIdentifier;

                const outAccess = new PropertyAccessExpression(systemAccess, expression.pos, expression.end);
                systemAccess.expression = outAccess;

                const outIdentifier = new Identifier(outAccess, name.pos, name.end);
                outIdentifier.text = 'out';
                outIdentifier.implicitType = 'Output';

                outAccess.name = outIdentifier;

                const systemIdentifier = new Identifier(outAccess, name.pos, name.end);
                systemIdentifier.text = 'System';
                systemIdentifier.implicitType = 'System';

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
                    identifier = new Identifier(javaNode, tsNode.pos, tsNode.end);
                    identifier.implicitType = 'Set';
                    identifier.text = 'Set';
                    module.imports.add('java.util.Set');
                    return identifier;
                case 'Map':
                    identifier = new Identifier(javaNode, tsNode.pos, tsNode.end);
                    identifier.implicitType = 'HashMap';
                    identifier.text = 'HashMap';
                    module.imports.add('java.util.HashMap');
                    return identifier;
                case 'Array':
                    identifier = new Identifier(javaNode, tsNode.pos, tsNode.end);
                    identifier.implicitType = 'ArrayList';
                    identifier.text = 'ArrayList';
                    module.imports.add('java.util.ArrayList');
                    return identifier;
            }
        },
        TSArrayLiteralExpression(tsNode, javaNode, closure) {
            const elements = tsNode.elements;

            const newExpression = new NewExpression(javaNode, tsNode.pos, tsNode.end);
            const expression = new Identifier(newExpression, elements.pos, elements.end);
            expression.text = 'ArrayList';
            expression.implicitType = 'ArrayList';

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
        return new JavaBundle(this.project);
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

        const packageName = toPackageName(fileName);
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

    createPropertyDeclaration({
                                  accessor, isStatic, isFinal,
                                  type, name, initializer,
                                  javaNode, pos, end, closure
                              }) {

        const propertyDeclaration = new PropertyDeclaration(javaNode, name, pos, end);

        propertyDeclaration.accessor = accessor === undefined ? 'public' : accessor;
        propertyDeclaration.isStatic = isStatic === undefined ? false : isStatic;
        propertyDeclaration.isFinal = isFinal === undefined ? false : isFinal;

        propertyDeclaration.explicitType = this.TSType(type, propertyDeclaration, closure);

        const javaInitializer = this.visitNode(initializer, propertyDeclaration, closure);
        if (javaInitializer) {
            propertyDeclaration.initializer = javaInitializer;
            if (javaInitializer.type) {
                propertyDeclaration.implicitType = javaInitializer.type;
            }
        }
        return propertyDeclaration;
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

        methodDeclaration.explicitReturnType = this.TSType(type, methodDeclaration, methodDeclaration.closure);

        for (let parameter of parameters) {
            const javaParameter = this.TSParameter(parameter, methodDeclaration, methodDeclaration.closure);
            methodDeclaration.addParameter(javaParameter);
        }

        const javaBlock = this.TSBlock(body, methodDeclaration, methodDeclaration.closure);
        methodDeclaration.body = javaBlock;
        methodDeclaration.implicitReturnType = javaBlock.implicitReturnType;
        methodDeclaration.implicitType = this.compileUtils.getFunctionType(methodDeclaration);

        return methodDeclaration;
    }

    createLambdaFunction({
                             type, parameters, body,
                             javaNode, pos, end
                         }) {
        const lambdaFunction = new LambdaFunction(javaNode, pos, end);

        lambdaFunction.explicitReturnType = this.TSType(type, lambdaFunction, lambdaFunction.closure);

        for (let parameter of parameters) {
            const javaParameter = this.TSParameter(parameter, lambdaFunction, lambdaFunction.closure);
            lambdaFunction.addParameter(javaParameter);
        }

        const javaBlock = this.TSBlock(body, lambdaFunction, lambdaFunction.closure);
        lambdaFunction.body = javaBlock;
        lambdaFunction.implicitReturnType = javaBlock.implicitReturnType;
        lambdaFunction.implicitType = this.compileUtils.getFunctionType(lambdaFunction);

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

        let typeString = '';
        const module = javaNode.module;
        switch (tsNode.kind) {
            case ts.SyntaxKind.Identifier:
                typeString = tsNode.escapedText;
                break;
            case ts.SyntaxKind.ArrayType:// string[]
                const elementType = this.TSType(tsNode.elementType, javaNode, closure);
                return new ArrayType(elementType);
            case ts.SyntaxKind.TypeReference:// Array<string>
                const typeName = this.TSType(tsNode.typeName, javaNode, closure);
                const typeArguments = tsNode.typeArguments;
                if (typeArguments) {
                    for (let typeArgument of typeArguments) {
                        const argumentType = this.TSType(typeArgument, javaNode, closure);
                        typeName.typeArguments.push(argumentType);
                    }
                }
                return typeName;
            default:
                typeString = this.compileUtils.parseType(tsNode);
        }

        return this.typeResolver(typeString, module);
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

        const identifier = new Identifier(javaNode, tsNode.pos, tsNode.end);
        identifier.text = text;
        identifier.implicitType = this.compileUtils.parseType(tsNode);
        const declaration = closure.get(text);
        if (!declaration) {
            let parentName = 'root'
            const parentNode = tsNode.parent;
            if (parentNode) {
                parentName = this.#TSKindMap[parentNode.kind];
            }
            throw new ReferenceError(`${text} is not defined. parent ${parentName}, file ${javaNode.module.fileName}.`);
        }
        identifier.declaration = declaration;
        declaration.refs.push(identifier);
        return identifier;
    }

    ///a.b
    TSPropertyAccessExpression(tsNode, javaNode, closure) {
        const tryEntity = this.entityResolver['TSPropertyAccessExpression'];
        if (tryEntity) {
            const entity = tryEntity.call(this, tsNode, javaNode, closure);
            if (entity) return entity;
        }

        const name = tsNode.name.escapedText;
        const expression = tsNode.expression;

        const propertyAccessExpression = new PropertyAccessExpression(javaNode, tsNode.pos, tsNode.end);
        propertyAccessExpression.name = name;
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
            arrayLiteralExpression.elements.push(javaElement);
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
        const { packageName, fullName } = toClassInfo(modulePath);
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
            closure.var(moduleNamed, module);
        }

        const namedBindings = importClause.namedBindings;
        if (namedBindings) {
            for (let element of namedBindings.elements) {
                const propertyBinding = element.name.escapedText;

                let propertyName = propertyBinding;
                if (element.propertyName) {
                    propertyName = element.propertyName.escapedText;
                }

                if (propertyName === 'default') {
                    const exportDefault = moduleClosure.local('exportDefault');
                    if (exportDefault) {
                        closure.var(propertyBinding, exportDefault);
                    } else {
                        closure.var(propertyBinding, module);
                    }
                } else {
                    const propertyDeclaration = moduleClosure.local(propertyName);
                    closure.var(propertyBinding, propertyDeclaration);
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
        let { isExport, isDefault, accessor, isStatic, isFinal } = this.compileUtils.parseModifiers(tsNode);
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
                classDeclaration = module;
                classDeclaration.pos = pos;
                classDeclaration.end = end;
            } else {
                isStatic = true;
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

        let { isExport, isDefault, accessor, isStatic } = this.compileUtils.parseModifiers(tsNode);

        const variableStatement = new VariableStatement(javaNode, tsNode.pos, tsNode.end);
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

        if (parentNode instanceof JavaModule) {
            for (let declaration of declarationList.declarations) {
                const name = declaration.name.escapedText;
                const initializer = declaration.initializer;
                const type = declaration.type;

                const propertyDeclaration = this.createPropertyDeclaration({
                    accessor, isStatic, isFinal, type, name, initializer,
                    javaNode: parentNode, pos: declaration.pos, end: declaration.end, closure
                });

                propertyDeclaration.initializer = this.visitNode(initializer, propertyDeclaration, closure);
                parentNode.addMember(propertyDeclaration);
            }
        } else {
            const variableDeclarationList = new VariableDeclarationList(javaNode, javaNode.pos, javaNode.end);
            for (let declaration of declarationList.declarations) {
                const name = declaration.name.escapedText;
                const initializer = declaration.initializer;
                const type = declaration.type;

                const variableDeclaration = new VariableDeclaration(javaNode, name, declaration.pos, declaration.end);

                variableDeclaration.isFinal = isFinal;
                variableDeclaration.explicitType = this.TSType(type, variableDeclaration, closure);

                variableDeclaration.initializer = this.visitNode(initializer, variableDeclaration, closure);
                closure.var(name, variableDeclaration);

                if (declarationList.declarations.length === 1) {
                    return variableDeclaration;
                }
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
            newExpression.arguments.push(this.visitNode(argumentNode, newExpression, closure));
        }

        return newExpression;
    }

    ///a(1, 2);
    TSCallExpression(tsNode, javaNode, closure) {
        const expression = tsNode.expression;
        const argumentNodes = tsNode.arguments;

        const callExpression = new CallExpression(javaNode, tsNode.pos, tsNode.end);
        callExpression.expression = this.visitNode(expression, callExpression, closure);
        for (let argumentNode of argumentNodes) {
            const javaArgument = this.visitNode(argumentNode, callExpression, closure);
            callExpression.arguments.push(javaArgument);
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
        const name = variableName.escapedText;
        const block = tsNode.block;

        const catchClause = new CatchClause(javaNode, tsNode.pos, tsNode.end);
        catchClause.variableDeclaration = name;
        const declaration = new VariableDeclaration(catchClause, name, variableName.pos, variableName.end);
        closure.var(name, declaration);
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

        let { isExport, isDefault, accessor, isStatic, isFinal } = this.compileUtils.parseModifiers(tsNode);

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
                        javaNode: module, pos, end,
                    });
                    const identifier = new Identifier(propertyDeclaration);
                    identifier.implicitType = methodDeclaration.type;
                    identifier.text = name;
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
                const propertyDeclaration = this.createPropertyDeclaration({
                    accessor, isStatic, isFinal, type, name,
                    javaNode, pos, end,
                });

                const initializer = this.createLambdaFunction({
                    type, parameters, body, javaNode: propertyDeclaration, name, pos, end
                });
                propertyDeclaration.initializer = initializer;
                propertyDeclaration.implicitType = initializer.type;
                javaNode.addMember(propertyDeclaration);
            } else {
                return this.createLambdaFunction({
                    type, parameters, body, javaNode, pos, end,
                })
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
            } else {
                forOfStatement.initializer = javaInitializer;
            }
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
            block.implicitReturnType = javaExpression.type;
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

    ///class A { private int b = 1; }
    TSPropertyDeclaration(tsNode, javaNode, closure) {
        const name = tsNode.name.escapedText;
        const type = tsNode.type;
        const initializer = tsNode.initializer;

        const pos = tsNode.pos;
        const end = tsNode.end;

        const { accessor, isStatic, isFinal } = this.compileUtils.parseModifiers(tsNode);

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

        const { accessor, isStatic, isFinal } = this.compileUtils.parseModifiers(tsNode);

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

        const pos = tsNode.pos;
        const end = tsNode.end;

        const parameterDeclaration = new ParameterDeclaration(javaNode, paramName, pos, end);

        parameterDeclaration.explicitType = this.TSType(type, parameterDeclaration, closure);

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
        return new NumericLiteral(javaNode, tsNode.text, tsNode.pos, tsNode.end);
    }

    ///a = 'string';
    TSStringLiteral(tsNode, javaNode, closure) {
        return new StringLiteral(javaNode, tsNode.text, tsNode.pos, tsNode.end);
    }

    ////^\d{11}$/
    TSRegularExpressionLiteral(tsNode, javaNode, closure) {
        return new RegularExpressionLiteral(javaNode, tsNode.text, tsNode.pos, tsNode.end);
    }

}

class CompileUtils {
    tsProgram;

    tabSpace = '  ';

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
                    break;
                case ts.SyntaxKind.ConstKeyword:
                    result.isFinal = true;
                    break;
            }
        }

        return result;
    }

    parseType(tsNode) {
        if (!tsNode) return;

        const typeChecker = this.tsProgram.getTypeChecker();
        const tsType = typeChecker.getTypeAtLocation(tsNode);
        return typeChecker.typeToString(tsType);
    }

    parseOperator(tsNode) {
        if (!tsNode) return;
        return this.parseToken(tsNode.kind);
    }

    parseToken(operator) {
        switch (operator) {
            case ts.SyntaxKind.OpenBraceToken:
                return '{';
            case ts.SyntaxKind.CloseBraceToken:
                return '}';
            case ts.SyntaxKind.OpenParenToken:
                return '(';
            case ts.SyntaxKind.CloseParenToken:
                return ')';
            case ts.SyntaxKind.OpenBracketToken:
                return '[';
            case ts.SyntaxKind.CloseBracketToken:
                return ']';
            case ts.SyntaxKind.DotToken:
                return '.';
            case ts.SyntaxKind.DotDotDotToken:
                return '...';
            case ts.SyntaxKind.SemicolonToken:
                return ';';
            case ts.SyntaxKind.CommaToken:
                return ',';
            case ts.SyntaxKind.LessThanToken:
                return '<';
            case ts.SyntaxKind.LessThanSlashToken:
                return '</';
            case ts.SyntaxKind.GreaterThanToken:
                return '>';
            case ts.SyntaxKind.LessThanEqualsToken:
                return '<=';
            case ts.SyntaxKind.GreaterThanEqualsToken:
                return '>=';
            case ts.SyntaxKind.EqualsEqualsToken:
                return '==';
            case ts.SyntaxKind.ExclamationEqualsToken:
                return '!=';
            case ts.SyntaxKind.EqualsEqualsEqualsToken:
                return '===';
            case ts.SyntaxKind.ExclamationEqualsEqualsToken:
                return '!==';
            case ts.SyntaxKind.EqualsGreaterThanToken:
                return '=>';
            case ts.SyntaxKind.PlusToken:
                return '+';
            case ts.SyntaxKind.MinusToken:
                return '-';
            case ts.SyntaxKind.AsteriskToken:
                return '*';
            case ts.SyntaxKind.AsteriskAsteriskToken:
                return '**';
            case ts.SyntaxKind.SlashToken:
                return '/';
            case ts.SyntaxKind.PercentToken:
                return '%';
            case ts.SyntaxKind.PlusPlusToken:
                return '++';
            case ts.SyntaxKind.MinusMinusToken:
                return '--';
            case ts.SyntaxKind.LessThanLessThanToken:
                return '<<';
            case ts.SyntaxKind.GreaterThanGreaterThanToken:
                return '>>';
            case ts.SyntaxKind.GreaterThanGreaterThanGreaterThanToken:
                return '<<<';
            case ts.SyntaxKind.AmpersandToken:
                return '&';
            case ts.SyntaxKind.BarToken:
                return '|';
            case ts.SyntaxKind.CaretToken:
                return '^';
            case ts.SyntaxKind.ExclamationToken:
                return '!';
            case ts.SyntaxKind.TildeToken:
                return '~';
            case ts.SyntaxKind.AmpersandAmpersandToken:
                return '&&';
            case ts.SyntaxKind.BarBarToken:
                return '||';
            case ts.SyntaxKind.QuestionToken:
                return '?';
            case ts.SyntaxKind.ColonToken:
                return ':';
            case ts.SyntaxKind.AtToken:
                return '@';
            case ts.SyntaxKind.EqualsToken:
                return '=';
            case ts.SyntaxKind.PlusEqualsToken:
                return '+=';
            case ts.SyntaxKind.MinusEqualsToken:
                return '-=';
            case ts.SyntaxKind.AsteriskEqualsToken:
                return '*=';
            case ts.SyntaxKind.AsteriskAsteriskEqualsToken:
                return '**=';
            case ts.SyntaxKind.SlashEqualsToken:
                return '/=';
            case ts.SyntaxKind.PercentEqualsToken:
                return '%=';
            case ts.SyntaxKind.LessThanLessThanEqualsToken:
                return '<<=';
            case ts.SyntaxKind.GreaterThanGreaterThanEqualsToken:
                return '>>=';
            case ts.SyntaxKind.GreaterThanGreaterThanGreaterThanEqualsToken:
                return '>>>=';
            case ts.SyntaxKind.AmpersandEqualsToken:
                return '&=';
            case ts.SyntaxKind.BarEqualsToken:
                return '|=';
            case ts.SyntaxKind.CaretEqualsToken:
                return '^=';
        }
    }

    getFunctionType(javaNode) {
        if (!javaNode) return VoidType;

        if (isFunction(javaNode)) {
            let functionClassName = 'Function';
            const typeParameters = javaNode.typeParameters;
            const parameters = javaNode.parameters;
            for (let typeParameter of typeParameters) {
                if (!typeParameter) continue;
                const typeString = typeParameter.getText();
                functionClassName += toCamel(typeString);
            }
            const returnTypeString = javaNode.returnType.getText();
            functionClassName += 'Return' + toCamel(returnTypeString);

            let functionMember = this.#functionMemberMap[functionClassName];
            if (!functionMember) {
                const module = javaNode.module;
                functionMember = new ClassDeclaration(module, functionClassName);
                const methodMember = new MethodDeclaration(functionMember, 'call');
                methodMember.typeParameters = [...typeParameters];
                methodMember.parameters = [...parameters];
                methodMember.explicitReturnType = functionClassName;
                functionMember.addMember(methodMember);
                this.#functionMemberMap[functionClassName] = functionMember;
            }
            return functionClassName;
        }
        return VoidType;
    }

    importFunctionType(javaNode, module) {
        let functionClassName = javaNode;
        if (javaNode instanceof ASTNode) {
            functionClassName = this.getFunctionType(javaNode);
            module = javaNode.module;
        }
        const project = module.project;
        const fullName = `${config.java.package}.FunctionInterface`;
        const functionModule = project.moduleMap.get(fullName);
        const functionMember = functionModule.members.find(classNode => classNode.name === functionClassName);
        if (!functionMember) {
            const functionMember = this.#functionMemberMap[functionClassName];
            functionMember.addMember(functionMember);
        }
        const importFunction = `${fullName}.${functionClassName}`;
        module.imports.add(importFunction);
        return functionClassName;
    }

    getClassFromNode(javaNode) {
        if (!javaNode) return;
        if (javaNode instanceof ClassDeclaration) {
            return javaNode;
        }
        return this.getClassFromNode(javaNode.parent);
    }

    getClosureFromNode(node) {
        if (!node) return undefined;
        if (node.closure) return node.closure;
        if (node.parent) return this.getClosureFromNode(node.parent);
        return undefined;
    }

    getVariable(closure, name) {
        if (closure instanceof ASTNode) {
            closure = this.getClosureFromNode(closure);
        }
        if (closure.has(name)) {
            return closure.variables[name];
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
            closure.variables[name] = declaration;
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
        closure.variables[name] = declaration;
    }

    getBlockFromNode(javaNode) {
        if (!javaNode) return;
        if (javaNode instanceof Block) {
            return javaNode;
        }
        return this.getBlockFromNode(javaNode.parent);
    }

    get newLine() {
        return `\n${this.indent}`;
    }

    indent = '';

    increaseIndent() {
        this.indent += this.tabSpace;
        return this.indent;
    }

    decreaseIndent() {
        this.indent = this.indent.slice(0, -this.tabSpace.length);
        return this.indent;
    }
}

module.exports = JavaParser;
