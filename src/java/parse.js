const ts = require("typescript");
const path = require("node:path");
const process = require("node:process");
const { readConfig, versionObject } = require('../config.js');
const EventCenter = require("./event.js");
const { entryFile } = require("../pkg.js");
const log = require('../log.js');
const {
    toCamel, toFileName, toPackageName, toClassName, toClassFullName,
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
const { NewExpression } = require("./ast");

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

        const pos = sourceFile.pos;
        const end = sourceFile.end;

        const packageName = toPackageName(fileName);
        const name = toClassName(fileName);

        // ast
        const javaModule = new JavaModule(this.project, fileName, packageName, name, pos, end);
        this.project.moduleMap[javaModule.fullName] = javaModule;

        // child
        for (let statement of sourceFile.statements) {
            const javaStatement = this.visitNode(statement, javaModule, javaModule.closure);
            if (javaStatement) {
                javaModule.addMember(javaStatement);
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

        propertyDeclaration.explicitType = this.compileUtils.parseType(type);

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

        methodDeclaration.explicitReturnType = this.compileUtils.parseType(type);

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

        lambdaFunction.explicitReturnType = this.compileUtils.parseType(type);

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
            throw new ReferenceError(`${text} is not defined. parent ${parentName}, file ${javaNode.module.fileName}.`);
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
        return new ThisKeyword(javaNode, tsNode.pos, tsNode.end);
    }

    /// import a from 'b'
    TSImportDeclaration(tsNode, javaNode, closure) {
        const importClause = tsNode.importClause;
        const moduleSpecifier = tsNode.moduleSpecifier.text;

        const currentModule = javaNode.module;

        const fileDir = path.dirname(currentModule.fileName);

        let modulePath = path.resolve(fileDir, moduleSpecifier);
        const modulePackage = toClassFullName(modulePath);

        currentModule.imports.push(modulePackage);

        const module = this.project.moduleMap[modulePackage];
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

    /// export default a = 1;
    TSExportAssignment(tsNode, javaNode, closure) {
        const expression = tsNode.expression;

        const module = javaNode.module;
        const name = 'exportDefault';

        const propertyDeclaration = new PropertyDeclaration(module, name);
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

        let classDeclaration;
        const { isExport, isDefault, accessor, isStatic, isFinal } = this.compileUtils.parseModifiers(tsNode);
        if (isExport) {
            const module = javaNode.module;
            if (isDefault) {
                classDeclaration = module;
                classDeclaration.pos = pos;
                classDeclaration.end = end;
            } else {
                classDeclaration = new ClassDeclaration(javaNode, name, pos, end);
                module.addMember(classDeclaration);
            }
        } else {
            classDeclaration = new ClassDeclaration(javaNode, name, pos, end);
            closure.var(name, classDeclaration);

            if (javaNode instanceof JavaModule) {
                javaNode.addMember(classDeclaration);
            } else if (javaNode instanceof Block) {
                closure.var(name, classDeclaration);
            }
        }

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

        const variableStatement = new VariableStatement(javaNode, tsNode.pos, tsNode.end);
        variableStatement.declarationList = this.TSVariableDeclarationList(declarationList, javaNode, closure);
        return variableStatement;
    }

    /// let a=1, b=2;
    TSVariableDeclarationList(tsNode, javaNode, closure) {
        const declarationList = tsNode;
        const statement = declarationList.parent;

        let { isExport, isDefault, accessor, isStatic } = this.compileUtils.parseModifiers(statement);

        let isFinal = false;
        switch (declarationList.flags) {
            case ts.NodeFlags.Const:
                isFinal = true;
                break;
        }

        if (javaNode instanceof JavaModule) {
            for (let declaration of declarationList.declarations) {
                const name = declaration.name.escapedText;
                const initializer = declaration.initializer;
                const type = declaration.type;

                const propertyDeclaration = this.createPropertyDeclaration({
                    accessor, isStatic, isFinal, type, name, initializer,
                    javaNode, pos: declaration.pos, end: declaration.end, closure
                });

                propertyDeclaration.initializer = this.visitNode(initializer, propertyDeclaration, closure);
                javaNode.addMember(propertyDeclaration);
            }
        } else {
            const variableDeclarationList = new VariableDeclarationList(javaNode, javaNode.pos, javaNode.end);
            for (let declaration of declarationList.declarations) {
                const name = declaration.name.escapedText;
                const initializer = declaration.initializer;
                const type = declaration.type;

                const variableDeclaration = new VariableDeclaration(javaNode, name, declaration.pos, declaration.end);

                variableDeclaration.isFinal = isFinal;
                variableDeclaration.explicitType = this.compileUtils.parseType(type);

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

    /// new A();
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

    /// a(1, 2);
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

    /// try {} catch(e) {} finally {}
    TSTryStatement(tsNode, javaNode, closure) {
        const tryBlock = tsNode.tryBlock;
        const catchClause = tsNode.catchClause;
        const finallyBlock = tsNode.finallyBlock;

        const tryStatement = new TryStatement(javaNode, tsNode.pos, tsNode.end);
        tryStatement.tryBlock = this.visitNode(tryBlock, tryStatement, closure);
        tryStatement.catchClause = this.visitNode(catchClause, tryStatement, closure);
        tryStatement.finallyBlock = this.visitNode(finallyBlock, tryStatement, closure);

        return tryStatement;
    }

    /// function a() {}
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
                    accessor, isStatic, isFinal, type, name: 'exportDefault',
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

    /// ++i
    TSPrefixUnaryExpression(tsNode, javaNode, closure) {
        const operand = tsNode.operand;
        const operator = tsNode.operator;

        const prefixUnaryExpression = new PrefixUnaryExpression(javaNode, tsNode.pos, tsNode.end);
        prefixUnaryExpression.operand = this.visitNode(operand, prefixUnaryExpression, closure);
        const compileUtils = this.project.compileUtils;
        prefixUnaryExpression.operator = compileUtils.parseUnaryOperator(operator);
        return prefixUnaryExpression;
    }

    /// i++
    TSPostfixUnaryExpression(tsNode, javaNode, closure) {
        const operand = tsNode.operand;
        const operator = tsNode.operator;

        const postfixUnaryExpression = new PostfixUnaryExpression(javaNode, tsNode.pos, tsNode.end);
        postfixUnaryExpression.operand = this.visitNode(operand, postfixUnaryExpression, closure);
        const compileUtils = this.project.compileUtils;
        postfixUnaryExpression.operator = compileUtils.parseUnaryOperator(operator);
        return postfixUnaryExpression;
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
        const initializer = tsNode.initializer;
        const expression = tsNode.expression;
        const statement = tsNode.statement;


        const forOfStatement = new ForOfStatement(javaNode, tsNode.pos, tsNode.end);
        const javaInitializer = this.visitNode(initializer, forOfStatement, forOfStatement.closure);
        if (javaInitializer) {
            if (javaInitializer instanceof VariableDeclarationList) {
                throw new Error(`'${initializer.getText()}' is not allowed in a compound declaration`);
            } else {
                forOfStatement.initializer = javaInitializer;
            }
        }

        forOfStatement.expression = this.visitNode(expression, forOfStatement, forOfStatement.closure);

        const block = new Block(forOfStatement, statement.pos, statement.end);
        forOfStatement.statement = block;
        for (let statementNode of statement.statements) {
            const javaStatement = this.visitNode(statementNode, forOfStatement, forOfStatement.closure);
            if (javaStatement) {
                if (javaStatement instanceof VariableDeclarationList) {
                    for (let item of javaStatement.declarations) {
                        block.statements.push(item);
                    }
                } else {
                    block.statements.push(javaStatement);
                }
            }
        }
        return forOfStatement;
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
            if (javaClause) {
                javaCaseBlock.clauses.push(javaClause);
            }
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
            if (javaStatement) {
                if (javaStatement instanceof VariableDeclarationList) {
                    for (let item of javaStatement.declarations) {
                        caseClause.statements.push(item);
                    }
                } else {
                    caseClause.statements.push(javaStatement);
                }
            }
        }

        return caseClause;
    }

    /// switch(a) { default: }
    TSDefaultClause(tsNode, javaNode, closure) {
        const statements = tsNode.statements;

        const defaultClause = new DefaultClause(javaNode, tsNode.pos, tsNode.end);
        for (let statement of statements) {
            const javaStatement = this.visitNode(statement, defaultClause, closure);
            if (javaStatement) {
                if (javaStatement instanceof VariableDeclarationList) {
                    for (let item of javaStatement.declarations) {
                        defaultClause.statements.push(item);
                    }
                } else {
                    defaultClause.statements.push(javaStatement);
                }
            }
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
        return this.visitNode(tsNode.expression, javaNode, closure);
    }

    /// class A { constructor() {} }
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

    /// class A { private int b = 1; }
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

    /// class A { public int b(double c) {} }
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

    /// function fun() {}
    /// class A { fun() {} }
    TSBlock(tsNode, javaNode, closure) {
        const pos = tsNode.pos;
        const end = tsNode.end;

        const block = new Block(javaNode, pos, end);
        const statements = tsNode.statements;
        for (let statement of statements) {
            const javaStatement = this.visitNode(statement, block, closure);
            if (javaStatement) {
                if (javaStatement instanceof VariableDeclarationList) {
                    for (let item of javaStatement.declarations) {
                        block.statements.push(item);
                    }
                } else {
                    block.statements.push(javaStatement);
                }
            }
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

        parameterDeclaration.explicitType = this.compileUtils.parseType(type);

        parameterDeclaration.initializer = this.visitNode(initializer, parameterDeclaration, closure);

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

    parseUnaryOperator(operator) {
        switch (operator) {
            case ts.SyntaxKind.PlusPlusToken:
                return '++'
            case ts.SyntaxKind.MinusMinusToken:
                return '--'
            case ts.SyntaxKind.PlusToken:
                return '+'
            case ts.SyntaxKind.MinusToken:
                return '-'
            case ts.SyntaxKind.TildeToken:
                return '~'
            case ts.SyntaxKind.ExclamationToken:
                return '!'
        }
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
            let functionClassName = 'Function';
            const typeParameters = javaNode.typeParameters;
            const parameters = javaNode.parameters;
            for (let typeParameter of typeParameters) {
                if (!typeParameter) continue;
                functionClassName += toCamel(typeParameter);
            }
            functionClassName += 'Return' + toCamel(javaNode.returnType);

            let functionMember = this.#functionMemberMap[functionClassName];
            if (!functionMember) {
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
        return 'void';
    }

    useFunctionInterface(javaNode) {
        const functionClassName = this.getFunctionType(javaNode);
        const fullName = `${config.java.package}.FunctionInterface`;
        const module = project.moduleMap[fullName];
        const functionMember = module.members.find(classNode => classNode.name === functionClassName);
        if (!functionMember) {
            const functionMember = this.#functionMemberMap[functionClassName];
            functionMember.addMember(functionMember);
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
