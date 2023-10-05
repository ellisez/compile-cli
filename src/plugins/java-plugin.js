import typescript from "typescript";
import path from "node:path";
import process from "node:process";
import plugin from "../plugin.js";
import { readConfig, versionObject } from '../config.js';
import fs from "node:fs";
import ListMap from '../utils/ListMap.js';
import { debug } from "util";

const config = readConfig();
const cwd = process.cwd();
const tabSpace = '\t';

function toClassName(basename) {
    return basename.replace(/(^[a-z])|[\._]([a-z])/g, (_, $1, $2) => {
        if ($2) return $2.toUpperCase()
        return $1.toUpperCase();
    });
}

function toPackageName(absPath) {
    let relative = path.relative(cwd, absPath);
    relative = relative.replace(/^src[\\/]?/, '').replace(/[\\/]/, '.');
    let packageName = `${config.java.package}.${relative}`;
    return packageName.replace(/(^\.)|(\.$)/g, '');
}

function toFullClassName(classpath) {
    const pathObject = path.parse(classpath);
    const packageName = toPackageName(pathObject.dir);
    const className = toClassName(pathObject.name);
    let full = `${packageName}.${className}`;
    return full.replace(/(^\.)|(\.$)/g, '');
}

function isTopNode(astNode) {
    return astNode.parent.kind === typescript.SyntaxKind.SourceFile;
}

function toModuleName(classFullName) {
    return /\.([A-Z][a-zA-Z]+)$/g.exec(classFullName)[1];
}

function toModulePackage(classFullName) {
    return /(^.*)\.[A-Z][a-zA-Z]+$/.exec(classFullName)[1];
}

const canUseVarKeyword = versionObject('java')[0] >= 10;

function callFunction(fun) {
    if (typeof (fun) === 'function') {
        fun = fun();
        return callFunction(fun);
    }
    return fun;
}

class Printer {
    #level = 0;
    indent = '';

    #seq = ' ';

    constructor(level = 0) {
        this.#level = level;
        for (let i = 1; i <= level; i++) {
            this.indent += tabSpace;
        }
    }

    get isEmpty() {
        return this.#lines.length == 0;
    }

    get level() {
        return this.#level;
    }

    enterClosure() {
        this.#level++;
        this.indent += tabSpace;
    }

    exitClosure() {
        this.#level--;
        this.indent = this.indent.slice(0, -tabSpace.length);
    }

    #lines = [];

    write(text) {
        this.#lines.push(text);
    }

    writeln(text = '') {
        this.#lines.push('\n' + this.indent);
        if (text) {
            this.#lines.push(text);
        }
    }

    toString() {
        let noSeq = false;
        let code = '';
        for (let line of this.#lines) {
            if (typeof (line) === 'function') {
                line = callFunction(line);
            } else {
                line = line.toString();
            }
            if (line.startsWith('\n')) {
                code += line;
                noSeq = true;
            } else if (line.startsWith('\0')) {
                const slice = line.slice(1);
                if (slice.length > 0) {
                    code += slice;
                } else {
                    noSeq = true;
                }
            } else {
                if (!noSeq && code.length > 0 && line.length > 0) {
                    code += this.#seq;
                }
                code += line;
                noSeq = false;
            }
        }
        return code;
    }

    clone() {
        const printer = new Printer(this.level);
        printer.#lines = [...this.#lines];
        return printer;
    }
}

class Parser extends Printer {
    pluginContext;
    serviceOptions;
    pluginObject;
    compileContext;
    javaModule;
    fileName;

    alias = {};

    #initPrinter = new Printer(2);

    #codePrinter = new Printer(1);

    constructor({ pluginContext, serviceOptions, pluginObject, compileContext }) {
        super();
        this.pluginContext = pluginContext;
        this.serviceOptions = serviceOptions;
        this.pluginObject = pluginObject;
        this.compileContext = compileContext;

        this.javaModule = new JavaModule(this);
    }

    get root() {
        return this.javaModule.root;
    }

    get imports() {
        return this.javaModule.imports;
    }

    get exports() {
        return this.javaModule.exports;
    }

    get classFullName() {
        return this.packageName + '.' + this.className
    }

    get className() {
        return this.javaModule.className;
    }

    set className(className) {
        this.javaModule.className = className;
    }

    get packageName() {
        return this.javaModule.packageName;
    }

    set packageName(packageName) {
        this.javaModule.packageName = packageName;
    }

    addImport(classFullName) {
        return this.javaModule.addImport(classFullName);
    }

    createAlias(alias, classFullName, identifier = null) {
        this.addImport(classFullName);

        identifier = identifier || toModuleName(classFullName);
        const importIdentifier = new ImportIdentifier();
        importIdentifier.module = classFullName;
        importIdentifier.identifier = identifier;
        this.alias[alias] = importIdentifier;
        return importIdentifier;

    }

    addExport(declaration, type) {
        const classFullName = this.packageName + '.' + this.className;
        this.exports = javaContext.modules[classFullName];
        if (this.exports) {
            this.exports = {};
            javaContext.modules[classFullName] = this.exports;
        }
        this.exports[declaration] = type;
    }

    getExportType(classFullName = null, declaration) {
        let exports = this.exports;
        if (classFullName) {
            exports = javaContext.modules[classFullName];
        }
        return exports[declaration];
    }

    toString() {
        this.write('/* Generate by Compile.JS */');
        this.writeln(`package ${this.packageName};`);

        const rootCode = this.root.toString();

        for (let javaImport of this.imports) {
            this.writeln(`import ${javaImport};`);
        }

        this.writeln(rootCode);

        return super.toString();
    }

    outputFile() {
        const baseDir = this.serviceOptions.output.dir;
        const packagePath = this.packageName.replace(/\./g, path.sep);
        const outputDir = path.join(baseDir, 'src', 'main', 'java', packagePath);
        if (!fs.existsSync(outputDir)) {
            fs.mkdirSync(outputDir, { recursive: true });
        }
        fs.writeFileSync(path.join(outputDir, `${this.className}.java`), this.toString());
    }

    parse(sourceFile) {
        this.fileName = sourceFile.fileName;
        const pathObject = path.parse(this.fileName);
        const packageName = toPackageName(pathObject.dir);
        const className = toClassName(pathObject.name);
        const classFullName = packageName + '.' + className;

        this.javaModule.packageName = packageName;
        this.javaModule.className = className;
        this.javaModule.classFullName = classFullName;
        javaContext.setModule(this.javaModule);

        const root = this.javaModule.root;
        root.module = classFullName;
        root.identifier = className;
        root.type = className;
        root.accessor = 'public';
        this.javaModule.exports[className] = root;

        root.enterClosure();

        const statements = sourceFile.statements;
        for (const statement of statements) {
            switch (statement.kind) {
                /// import / export
                case typescript.SyntaxKind.ImportDeclaration:
                    this.ImportDeclaration(statement, this.root.staticBlock);
                    break;
                case typescript.SyntaxKind.ExportAssignment:
                    this.ExportAssignment(statement, this.root.staticBlock);
                    break;
                /// function declaration
                case typescript.SyntaxKind.FunctionDeclaration:
                    this.root.writeln();
                    this.FunctionDeclaration(statement, this.root);
                    break;
                /// const / let =
                case typescript.SyntaxKind.VariableStatement:
                    this.root.writeln();
                    this.VariableStatement(statement, this.root);
                    break;
                case typescript.SyntaxKind.ClassDeclaration:
                    this.root.writeln();
                    this.ClassDeclaration(statement, this.root);
                    break;
                /// call / new / operator
                case typescript.SyntaxKind.ExpressionStatement:
                    this.root.staticBlock.writeln();
                    this.ExpressionStatement(statement, this.root.staticBlock);
                    break;

                /// if / else if / else
                case typescript.SyntaxKind.IfStatement:
                    this.root.staticBlock.writeln();
                    this.IfStatement(statement, this.root.staticBlock);
                    break;
                /// for / do-while / while / break / continue
                case typescript.SyntaxKind.DoStatement:
                    this.root.staticBlock.writeln();
                    this.DoStatement(statement, this.root.staticBlock);
                    break;
                case typescript.SyntaxKind.WhileStatement:
                    this.root.staticBlock.writeln();
                    this.WhileStatement(statement, this.root.staticBlock);
                    break;
                case typescript.SyntaxKind.ForStatement:
                    this.root.staticBlock.writeln();
                    this.ForStatement(statement, this.root.staticBlock);
                    break;
                case typescript.SyntaxKind.ForInStatement:
                    this.root.staticBlock.writeln();
                    this.ForInStatement(statement, this.root.staticBlock);
                    break;
                case typescript.SyntaxKind.ForOfStatement:
                    this.root.staticBlock.writeln();
                    this.ForOfStatement(statement, this.root.staticBlock);
                    break;
                case typescript.SyntaxKind.ReturnStatement:
                    this.root.staticBlock.writeln();
                    this.ReturnStatement(statement, this.root.staticBlock);
                    break;
                /// with / switch
                case typescript.SyntaxKind.WithStatement:
                    this.root.staticBlock.writeln();
                    this.WhileStatement(statement, this.root.staticBlock);
                    break;
                case typescript.SyntaxKind.SwitchStatement:
                    this.root.staticBlock.writeln();
                    this.SwitchStatement(statement, this.root.staticBlock);
                    break;
                /// label : xxx
                case typescript.SyntaxKind.LabeledStatement:
                    this.root.staticBlock.writeln();
                    this.LabeledStatement(statement, this.root.staticBlock);
                    break;
                /// throw xxx
                case typescript.SyntaxKind.ThrowStatement:
                    this.root.staticBlock.writeln();
                    this.ThrowStatement(statement, this.root.staticBlock);
                    break;
                /// try catch finally
                case typescript.SyntaxKind.TryStatement:
                    this.root.staticBlock.writeln();
                    this.TryStatement(statement, this.root.staticBlock);
                    break;
                case typescript.SyntaxKind.CatchClause:
                    this.root.staticBlock.writeln();
                    this.CatchClause(statement, this.root.staticBlock);
                    break;

            }
        }
        root.exitClosure();
    }

    /// custom eval
    EvalTypeReference(astNode, rawType) {
        let expression = rawType;
        let module = null;
        const typeDeclaration = this.EvalIdentifier(astNode, rawType);
        if (typeDeclaration) {
            module = typeDeclaration.module;
            if (typeDeclaration instanceof ImportIdentifier) {
                expression = () => typeDeclaration.expression(this.javaModule);
            } else {
                expression = typeDeclaration.expression(this.javaModule);
            }
        } else if (expression === 'Date') {
            this.addImport('java.util.Date');
            module = 'java.util.Date';
        }
        return { expression, module };
    }

    EvalJavaType(typeNode, defaultType = 'Object') {
        let expression = defaultType;
        let module = null;
        if (typeNode) {
            switch (typeNode.kind) {
                case typescript.SyntaxKind.TypeReference:
                    return this.EvalTypeReference(typeNode, typeNode.typeName.escapedText);
                case typescript.SyntaxKind.StringKeyword:
                    expression = 'String';
                    break;
                case typescript.SyntaxKind.NumberKeyword:
                    expression = 'Number';
                    break;
                case typescript.SyntaxKind.BooleanKeyword:
                    expression = 'Boolean';
                    break;
                case typescript.SyntaxKind.ArrayType:
                    const elementType = this.EvalJavaType(typeNode.elementType);
                    module = elementType.module;
                    if (typeof (elementType.expression) === 'function') {
                        expression = () => {
                            let elementExpression = elementType.expression ? elementType.expression : 'Object';
                            elementExpression = callFunction(elementExpression);
                            return `${elementExpression}[]`;
                        }
                    } else {
                        let elementExpression = elementType.expression ? elementType.expression : 'Object';
                        expression = `${elementExpression}[]`;
                    }
                    break;
                case typescript.SyntaxKind.ObjectKeyword:
                    expression = 'Object';
                    break;
                case typescript.SyntaxKind.TupleType:
                    expression = 'Object';
                    break;
            }
        }
        return { expression, module };
    }

    EvalReturnType(typeNode) {
        return this.EvalJavaType(typeNode, 'void');
    }

    EvalParameterType(astNode, printer) {
        const typeNode = astNode.type;
        let type = 'Object';
        let module = null;

        function arrayType(elementExpression) {
            if (astNode.dotDotDotToken) {
                return elementExpression || 'Object';
            } else {
                elementExpression = elementExpression ? elementExpression : 'Object';
                return `${elementExpression}[]`;
            }
        }

        if (typeNode) {
            switch (typeNode.kind) {
                case typescript.SyntaxKind.TypeReference:
                    type = typeNode.typeName.escapedText;
                    const typeReference = this.EvalTypeReference(astNode, type);
                    module = typeReference.module;
                    type = typeReference.expression;
                    break;
                case typescript.SyntaxKind.StringKeyword:
                    type = 'String';
                    break;
                case typescript.SyntaxKind.NumberKeyword:
                    type = 'Number';
                    break;
                case typescript.SyntaxKind.BooleanKeyword:
                    type = 'Boolean';
                    break;
                case typescript.SyntaxKind.ArrayType:
                    let elementType = this.EvalJavaType(typeNode.elementType);
                    module = elementType.module;
                    let elementExpression = elementType.expression;

                    if (typeof (elementExpression) === 'function') {
                        type = () => arrayType(elementExpression);
                    } else {
                        type = arrayType(elementExpression);
                    }
                    break;
                case typescript.SyntaxKind.ObjectKeyword:
                case typescript.SyntaxKind.TupleType:
            }
        }
        const name = astNode.name.escapedText;
        const variableIdentifier = new VariableIdentifier(printer.level);
        variableIdentifier.module = this.classFullName;
        variableIdentifier.identifier = name;
        variableIdentifier.type = type;
        astNode.eval = variableIdentifier;
        return {
            type,
            dotDotDot: astNode.dotDotDotToken != null,
            name,
            module
        };
    }

    EvalNumberType(astNode) {
        if (astNode.numericLiteralFlags != typescript.TokenFlags.None) {
            return 'int';
        }
        let text = astNode.getText();
        if (text.includes('.')) {
            return 'double';
        }
        return 'int';
    }

    EvalIdentifier(astNode, identifierName) {
        if (identifierName === this.className) {
            return this.root;
        }
        const locals = astNode.locals;
        const isTop = astNode.kind === typescript.SyntaxKind.SourceFile;
        if (locals) {
            const identifier = locals.get(identifierName);
            if (identifier) {
                const declaration = identifier.declarations[0];
                return declaration.eval;
            }
        }
        const parentNode = astNode.parent;
        if (parentNode) {
            return this.EvalIdentifier(parentNode, identifierName);
        }
        //
        let identifierEval = this.alias[identifierName];
        if (identifierEval) return identifierEval;
        return this.exports[identifierName];
    }

    EvalKeyword(astNode, printer) {
        let typeInference = null;
        switch (astNode.kind) {
            case typescript.SyntaxKind.NullKeyword:
                typeInference = this.NullKeyword(astNode, printer);
                break;
            case typescript.SyntaxKind.NumericLiteral:
                typeInference = this.NumericLiteral(astNode, printer);
                break;
            case typescript.SyntaxKind.StringLiteral:
                typeInference = this.StringLiteral(astNode, printer);
                break;
            case typescript.SyntaxKind.TrueKeyword:
                typeInference = this.TrueKeyword(astNode, printer);
                break;
            case typescript.SyntaxKind.FalseKeyword:
                typeInference = this.FalseKeyword(astNode, printer);
                break;
            case typescript.SyntaxKind.ArrayLiteralExpression:
                typeInference = this.ArrayLiteralExpression(astNode, printer);
                break;
            case typescript.SyntaxKind.FunctionExpression:
                typeInference = this.FunctionExpression(astNode, printer);
                break;
            case typescript.SyntaxKind.ArrowFunction:
                typeInference = this.ArrowFunction(astNode, printer);
                break;
            case typescript.SyntaxKind.NewExpression:
                typeInference = this.NewExpression(astNode, printer);
                break;
            case typescript.SyntaxKind.CallExpression:
                typeInference = this.CallExpression(astNode, printer);
                break;
            case typescript.SyntaxKind.BinaryExpression:
                typeInference = this.BinaryExpression(astNode, printer);
                break;
            case typescript.SyntaxKind.PropertyAccessExpression:
                typeInference = this.PropertyAccessExpression(astNode, printer);
                break;
            case typescript.SyntaxKind.PrefixUnaryExpression:
                typeInference = this.PrefixUnaryExpression(astNode, printer);
                break;
            case typescript.SyntaxKind.PostfixUnaryExpression:
                typeInference = this.PostfixUnaryExpression(astNode, printer);
                break;
        }
        return typeInference;
    }

    EvalExpression(astNode, printer) {
        let typeInference = this.EvalKeyword(astNode, printer);
        if (typeInference) return typeInference;
        switch (astNode.kind) {
            case typescript.SyntaxKind.Identifier:
                typeInference = this.Identifier(astNode, printer);
                if (printer.isStatic) {
                    astNode.eval.isStatic = true;
                }
                break;
        }
        return typeInference;
    }

    EvalAssign(astNode, printer) {
        let typeInference = this.EvalKeyword(astNode, printer);
        if (typeInference) return typeInference;
        switch (astNode.kind) {
            case typescript.SyntaxKind.Identifier:
                typeInference = this.AssignIdentifier(astNode, printer);

                if (printer.isStatic) {
                    astNode.eval.isStatic = true;
                }
                break;
        }
        return typeInference;
    }

    EvalCall(astNode, printer) {
        let typeInference = this.EvalKeyword(astNode, printer);
        if (typeInference) return typeInference;
        switch (astNode.kind) {
            case typescript.SyntaxKind.Identifier:
                typeInference = this.CallIdentifier(astNode, printer);

                if (printer.isStatic) {
                    astNode.eval.isStatic = true;
                }
                break;
        }
        return typeInference;
    }

    EvalMultiValue(elements, printer, multiLine) {
        if (!elements) return;
        let hasMultiLine = false;
        let typeInference = null;
        for (let i = 0; i < elements.length; i++) {
            let element = elements[i];
            const indent = printer.level * 4;
            const len = indent + (element.end - element.pos);
            let itemTypeInference = null;
            if (multiLine === true || len > 100) {
                hasMultiLine = true;
                printer.enterClosure();
                if (i !== 0) {
                    printer.write('\0, ');
                }
                printer.writeln();
                itemTypeInference = this.EvalExpression(element, printer);
                printer.exitClosure();
            } else {
                if (i !== 0) {
                    printer.write('\0, ');
                }
                let element = elements[i];
                printer.write('\0');
                itemTypeInference = this.EvalExpression(element, printer);
            }
            if (!typeInference) {
                typeInference = itemTypeInference;
            } else if (typeInference !== itemTypeInference) {
                typeInference = 'Object';
            }
        }
        if (hasMultiLine) {
            printer.writeln();
        }
        return typeInference + '[]';
    }

    EvalInitalizer(initializer, printer, defaultType = 'var') {
        const rawType = printer.rawType;
        let type = rawType || defaultType;
        if (initializer) {
            printer.write(' =');
            let typeInference = this.EvalAssign(initializer, printer);

            if (!rawType && typeInference) {
                // use typeInference can trigger FunctionInterface import.
                type = typeInference;
                const initializerEval = initializer.eval;
                if (initializerEval instanceof FunctionIdentifier || initializerEval instanceof LambdaIdentifier) {
                    const functionInterface = initializerEval.functionInterface;
                    const functionType = functionInterface.type;
                    javaContext.functionInterface.set(functionType, functionInterface);
                    this.addImport(`${config.java.package}.FunctionInterface.${functionType}`);
                    printer.isFunction = true;
                } else if (initializerEval instanceof ImportIdentifier) {
                    printer.isFunction = null;
                    type = () => {
                        const realDeclaration = initializerEval.declaration;
                        if (realDeclaration instanceof FunctionIdentifier || realDeclaration instanceof LambdaIdentifier) {
                            const functionInterface = realDeclaration.functionInterface;
                            const functionType = functionInterface.type;
                            javaContext.functionInterface.set(functionType, functionInterface);
                            this.addImport(`${config.java.package}.FunctionInterface.${functionType}`);
                            printer.isFunction = true;
                        } else {
                            printer.isFunction = false;
                        }
                        return realDeclaration.type;
                    }
                }
            }
        }
        printer.type = type;
    }

    /// ast parse
    Unknown(astNode, printer) {
    }

    EndOfFileToken(astNode, printer) {
    }

    SingleLineCommentTrivia(astNode, printer) {
    }

    MultiLineCommentTrivia(astNode, printer) {
    }

    NewLineTrivia(astNode, printer) {
    }

    WhitespaceTrivia(astNode, printer) {
    }

    ShebangTrivia(astNode, printer) {
    }

    ConflictMarkerTrivia(astNode, printer) {
    }

    NonTextFileMarkerTrivia(astNode, printer) {
    }

    NumericLiteral(astNode, printer) {
        printer.write(astNode.getText());
        return this.EvalNumberType(astNode);
    }

    BigIntLiteral(astNode, printer) {
    }

    StringLiteral(astNode, printer) {
        printer.write(`"${astNode.text}"`);
        return 'String';
    }

    JsxText(astNode, printer) {
    }

    JsxTextAllWhiteSpaces(astNode, printer) {
    }

    RegularExpressionLiteral(astNode, printer) {
    }

    NoSubstitutionTemplateLiteral(astNode, printer) {
    }

    TemplateHead(astNode, printer) {
    }

    TemplateMiddle(astNode, printer) {
    }

    TemplateTail(astNode, printer) {
    }

    OpenBraceToken(astNode, printer) {
    }

    CloseBraceToken(astNode, printer) {
    }

    OpenParenToken(astNode, printer) {
    }

    CloseParenToken(astNode, printer) {
    }

    OpenBracketToken(astNode, printer) {
    }

    CloseBracketToken(astNode, printer) {
    }

    DotToken(astNode, printer) {
    }

    DotDotDotToken(astNode, printer) {
    }

    SemicolonToken(astNode, printer) {
    }

    CommaToken(astNode, printer) {
    }

    QuestionDotToken(astNode, printer) {
    }

    LessThanToken(astNode, printer) {
    }

    LessThanSlashToken(astNode, printer) {
    }

    GreaterThanToken(astNode, printer) {
    }

    LessThanEqualsToken(astNode, printer) {
    }

    GreaterThanEqualsToken(astNode, printer) {
    }

    EqualsEqualsToken(astNode, printer) {
    }

    ExclamationEqualsToken(astNode, printer) {
    }

    EqualsEqualsEqualsToken(astNode, printer) {
    }

    ExclamationEqualsEqualsToken(astNode, printer) {
    }

    EqualsGreaterThanToken(astNode, printer) {
    }

    PlusToken(astNode, printer) {
    }

    MinusToken(astNode, printer) {
    }

    AsteriskToken(astNode, printer) {
    }

    AsteriskAsteriskToken(astNode, printer) {
    }

    SlashToken(astNode, printer) {
    }

    PercentToken(astNode, printer) {
    }

    PlusPlusToken(astNode, printer) {
    }

    MinusMinusToken(astNode, printer) {
    }

    LessThanLessThanToken(astNode, printer) {
    }

    GreaterThanGreaterThanToken(astNode, printer) {
    }

    GreaterThanGreaterThanGreaterThanToken(astNode, printer) {
    }

    AmpersandToken(astNode, printer) {
    }

    BarToken(astNode, printer) {
    }

    CaretToken(astNode, printer) {
    }

    ExclamationToken(astNode, printer) {
    }

    TildeToken(astNode, printer) {
    }

    AmpersandAmpersandToken(astNode, printer) {
    }

    BarBarToken(astNode, printer) {
    }

    QuestionToken(astNode, printer) {
    }

    ColonToken(astNode, printer) {
    }

    AtToken(astNode, printer) {
    }

    QuestionQuestionToken(astNode, printer) {
    }

    /** Only the JSDoc scanner produces BacktickToken. The normal scanner produces NoSubstitutionTemplateLiteral and related kinds. */
    BacktickToken(astNode, printer) {
    }

    /** Only the JSDoc scanner produces HashToken. The normal scanner produces PrivateIdentifier. */
    HashToken(astNode, printer) {
    }

    EqualsToken(astNode, printer) {
    }

    PlusEqualsToken(astNode, printer) {
    }

    MinusEqualsToken(astNode, printer) {
    }

    AsteriskEqualsToken(astNode, printer) {
    }

    AsteriskAsteriskEqualsToken(astNode, printer) {
    }

    SlashEqualsToken(astNode, printer) {
    }

    PercentEqualsToken(astNode, printer) {
    }

    LessThanLessThanEqualsToken(astNode, printer) {
    }

    GreaterThanGreaterThanEqualsToken(astNode, printer) {
    }

    GreaterThanGreaterThanGreaterThanEqualsToken(astNode, printer) {
    }

    AmpersandEqualsToken(astNode, printer) {
    }

    BarEqualsToken(astNode, printer) {
    }

    BarBarEqualsToken(astNode, printer) {
    }

    AmpersandAmpersandEqualsToken(astNode, printer) {
    }

    QuestionQuestionEqualsToken(astNode, printer) {
    }

    CaretEqualsToken(astNode, printer) {
    }

    CallIdentifier(astNode, printer) {
        const identifierName = astNode.escapedText;
        const identifierObject = this.EvalIdentifier(astNode.parent, identifierName);
        if (!identifierObject) {
            this.pluginContext.error(`Unknown ${identifierName}`, astNode.pos);
        }
        astNode.eval = identifierObject;

        /// call
        if (identifierObject instanceof ImportIdentifier) {
            printer.write(() => identifierObject.call(this.javaModule));
            return () => identifierObject.type;
        } else {
            printer.write(identifierObject.call(this.javaModule));
            return identifierObject.type;
        }
    }

    AssignIdentifier(astNode, printer) {
        const identifierName = astNode.escapedText;
        const identifierObject = this.EvalIdentifier(astNode.parent, identifierName);
        if (!identifierObject) {
            this.pluginContext.error(`Unknown ${identifierName}`, astNode.pos);
        }
        astNode.eval = identifierObject;

        /// assign
        if (identifierObject instanceof ImportIdentifier) {
            printer.write(() => identifierObject.assign(this.javaModule));
            return () => identifierObject.type;
        } else {
            printer.write(identifierObject.assign(this.javaModule));
            return identifierObject.type;
        }
    }

    Identifier(astNode, printer) {
        const identifierName = astNode.escapedText;
        const identifierObject = this.EvalIdentifier(astNode.parent, identifierName);
        if (!identifierObject) {
            this.pluginContext.error(`Unknown ${identifierName}`, astNode.pos);
        }
        astNode.eval = identifierObject;

        /// expression
        if (identifierObject instanceof ImportIdentifier) {
            printer.write(() => identifierObject.expression(this.javaModule));
            return () => identifierObject.type;
        } else {
            printer.write(identifierObject.expression(this.javaModule));
            return identifierObject.type;
        }
    }

    PrivateIdentifier(astNode, printer) {
    }

    BreakKeyword(astNode, printer) {
    }

    CaseKeyword(astNode, printer) {
    }

    CatchKeyword(astNode, printer) {
    }

    ClassKeyword(astNode, printer) {
    }

    ConstKeyword(astNode, printer) {
    }

    ContinueKeyword(astNode, printer) {
    }

    DebuggerKeyword(astNode, printer) {
    }

    DefaultKeyword(astNode, printer) {
    }

    DeleteKeyword(astNode, printer) {
    }

    DoKeyword(astNode, printer) {
    }

    ElseKeyword(astNode, printer) {
    }

    EnumKeyword(astNode, printer) {
    }

    ExportKeyword(astNode, printer) {
    }

    ExtendsKeyword(astNode, printer) {
    }

    FalseKeyword(astNode, printer) {
        printer.write('false');
        return 'boolean';
    }

    FinallyKeyword(astNode, printer) {
    }

    ForKeyword(astNode, printer) {
    }

    FunctionKeyword(astNode, printer) {
    }

    IfKeyword(astNode, printer) {
    }

    ImportKeyword(astNode, printer) {
    }

    InKeyword(astNode, printer) {
    }

    InstanceOfKeyword(astNode, printer) {
    }

    NewKeyword(astNode, printer) {
    }

    NullKeyword(astNode, printer) {
        printer.write('null');
        return null;
    }

    ReturnKeyword(astNode, printer) {
    }

    SuperKeyword(astNode, printer) {
    }

    SwitchKeyword(astNode, printer) {
    }

    ThisKeyword(astNode, printer) {
    }

    ThrowKeyword(astNode, printer) {
    }

    TrueKeyword(astNode, printer) {
        printer.write('true');
        return 'boolean';
    }

    TryKeyword(astNode, printer) {
    }

    TypeOfKeyword(astNode, printer) {
    }

    VarKeyword(astNode, printer) {
    }

    VoidKeyword(astNode, printer) {
    }

    WhileKeyword(astNode, printer) {
    }

    WithKeyword(astNode, printer) {
    }

    ImplementsKeyword(astNode, printer) {
    }

    InterfaceKeyword(astNode, printer) {
    }

    LetKeyword(astNode, printer) {
    }

    PackageKeyword(astNode, printer) {
    }

    PrivateKeyword(astNode, printer) {
    }

    ProtectedKeyword(astNode, printer) {
    }

    PublicKeyword(astNode, printer) {
    }

    StaticKeyword(astNode, printer) {
    }

    YieldKeyword(astNode, printer) {
    }

    AbstractKeyword(astNode, printer) {
    }

    AccessorKeyword(astNode, printer) {
    }

    AsKeyword(astNode, printer) {
    }

    AssertsKeyword(astNode, printer) {
    }

    AssertKeyword(astNode, printer) {
    }

    AnyKeyword(astNode, printer) {
    }

    AsyncKeyword(astNode, printer) {
    }

    AwaitKeyword(astNode, printer) {
    }

    BooleanKeyword(astNode, printer) {
    }

    ConstructorKeyword(astNode, printer) {
    }

    DeclareKeyword(astNode, printer) {
    }

    GetKeyword(astNode, printer) {
    }

    InferKeyword(astNode, printer) {
    }

    IntrinsicKeyword(astNode, printer) {
    }

    IsKeyword(astNode, printer) {
    }

    KeyOfKeyword(astNode, printer) {
    }

    ModuleKeyword(astNode, printer) {
    }

    NamespaceKeyword(astNode, printer) {
    }

    NeverKeyword(astNode, printer) {
    }

    OutKeyword(astNode, printer) {
    }

    ReadonlyKeyword(astNode, printer) {
    }

    RequireKeyword(astNode, printer) {
    }

    NumberKeyword(astNode, printer) {
    }

    ObjectKeyword(astNode, printer) {
    }

    SatisfiesKeyword(astNode, printer) {
    }

    SetKeyword(astNode, printer) {
    }

    StringKeyword(astNode, printer) {
    }

    SymbolKeyword(astNode, printer) {
    }

    TypeKeyword(astNode, printer) {
    }

    UndefinedKeyword(astNode, printer) {
    }

    UniqueKeyword(astNode, printer) {
    }

    UnknownKeyword(astNode, printer) {
    }

    UsingKeyword(astNode, printer) {
    }

    FromKeyword(astNode, printer) {
    }

    GlobalKeyword(astNode, printer) {
    }

    BigIntKeyword(astNode, printer) {
    }

    OverrideKeyword(astNode, printer) {
    }

    OfKeyword(astNode, printer) {
    }

    QualifiedName(astNode, printer) {
    }

    ComputedPropertyName(astNode, printer) {
    }

    TypeParameter(astNode, printer) {
    }

    FunctionParameter(astNode, printer) {
        const parameters = astNode.parameters;
        const functionInterface = new JavaFunctionInterface();
        functionInterface.returnType = printer.returnType;
        if (printer.returnTypeModule) {
            functionInterface.imports.add(printer.returnTypeModule);
        }

        const paramPrinter = new Printer(printer.level);
        printer.parameters = paramPrinter;

        const overrideParams = [];
        let overrideIndex = -1;
        paramPrinter.write('\0');
        for (let i = 0; i < parameters.length; i++) {
            let parameter = parameters[i];
            if (i !== 0) {
                paramPrinter.write(',');
            }

            const parameterObject = this.EvalParameterType(parameter, paramPrinter);
            const type = parameterObject.type;
            const name = parameterObject.name;
            paramPrinter.write(type);
            paramPrinter.write(name);

            const data = { type, name };

            functionInterface.parameters.push(type);
            if (parameterObject.module) {
                functionInterface.imports.add(parameterObject.module);
            }

            const initializer = parameter.initializer;
            if (initializer) {
                data.default = new Printer(printer.level);
                this.EvalAssign(initializer, data.default);
                if (overrideIndex < 0) overrideIndex = i;
            } else {
                overrideIndex = -1;
            }
            overrideParams.push(data);
        }

        printer.functionInterface = functionInterface;
        const functionType = functionInterface.type;
        printer.type = functionType;
        /// support default parameter
        this.OverrideFunctionDeclaration(astNode, overrideParams, printer, overrideIndex);
    }

    OverrideFunctionDeclaration(astNode, overrideParams, printer, index) {
        if (index < 0) return;
        for (let i = index; i < overrideParams.length; i++) {
            const newPrinter = printer.clone();
            const parentPrinter = astNode.parent.eval;
            parentPrinter.writeln(newPrinter);

            const paramPrinter = new Printer(printer.level);
            newPrinter.parameters = paramPrinter;

            const callParams = [];
            for (let j = 0; j < i; j++) {
                let overrideParam = overrideParams[j];

                if (j !== 0) {
                    paramPrinter.write(',');
                }

                const { name, type, default: value } = overrideParam;
                paramPrinter.write(type);
                paramPrinter.write(name);

                callParams.push(value || name);
            }
            callParams.push(overrideParams[i].default);
            /// bodyCode
            newPrinter.write(' {');
            newPrinter.enterClosure();
            newPrinter.writeln();
            newPrinter.write(() => {
                let returnType = printer.returnType;
                if (typeof (returnType) === 'function') {
                    returnType = callFunction(returnType);
                } else {
                    returnType = returnType.toString();
                }
                if (returnType === 'void') return '\0';
                return 'return';
            })
            newPrinter.write(`this.${newPrinter.identifier}(`);
            newPrinter.write('\0');
            newPrinter.write(() => callParams.join(', '));
            newPrinter.write('\0);');
            newPrinter.exitClosure();
            newPrinter.writeln('}');
        }
    }

    ConstructorParameter(astNode, printer) {
        const parameters = astNode.parameters;

        const paramPrinter = new Printer(printer.level);
        printer.parameters = paramPrinter;

        paramPrinter.write('\0');
        for (let i = 0; i < parameters.length; i++) {
            let parameter = parameters[i];
            if (i !== 0) paramPrinter.write(',');
            const parameterObject = this.EvalParameterType(parameter, printer);
            paramPrinter.write(parameterObject.type);
            paramPrinter.write(parameterObject.name);
        }
    }

    Decorator(astNode, printer) {
    }

    PropertySignature(astNode, printer) {
    }

    PropertyDeclaration(astNode, printer) {
        const variableIdentifier = new VariableIdentifier(printer.level);
        astNode.eval = variableIdentifier;
        printer.write(variableIdentifier);

        variableIdentifier.module = this.classFullName;

        variableIdentifier.accessor = 'public';

        const javaType = this.EvalJavaType(astNode.type, '');
        variableIdentifier.rawType = javaType.expression;
        variableIdentifier.rawTypeModule = javaType.module;

        const name = astNode.name.escapedText;
        variableIdentifier.identifier = name;

        const modifiers = astNode.modifiers;
        if (modifiers) {
            for (const modifier of modifiers) {
                switch (modifier.kind) {
                    case typescript.SyntaxKind.PublicKeyword:
                        variableIdentifier.accessor = 'public';
                        break;
                    case typescript.SyntaxKind.PrivateKeyword:
                        variableIdentifier.accessor = 'private';
                        break;
                    case typescript.SyntaxKind.ProtectedKeyword:
                        variableIdentifier.accessor = 'protected';
                        break;
                    case typescript.SyntaxKind.StaticKeyword:
                        variableIdentifier.isStatic = true;
                        break;
                    case typescript.SyntaxKind.ConstKeyword:
                        variableIdentifier.isFinal = true;
                }
            }
        }
        // exports
        if (astNode.parent.isTop && variableIdentifier.accessor === 'public' && variableIdentifier.isStatic === true) {
            this.exports[name] = variableIdentifier;
        }
        // initializer
        const defaultType = 'Object';
        const initializer = astNode.initializer;
        this.EvalInitalizer(initializer, variableIdentifier, defaultType);

        variableIdentifier.write('\0;');
    }

    MethodSignature(astNode, printer) {
    }

    MethodDeclaration(astNode, printer) {
        const functionIdentifier = new FunctionIdentifier(printer.level);
        astNode.eval = functionIdentifier;
        printer.write(functionIdentifier);

        functionIdentifier.accessor = 'public';

        const returnType = this.EvalReturnType(astNode.type);
        functionIdentifier.returnType = returnType.expression;
        functionIdentifier.returnTypeModule = returnType.module;

        const modifiers = astNode.modifiers;
        if (modifiers) {
            for (let modifier of modifiers) {
                switch (modifier.kind) {
                    case typescript.SyntaxKind.PublicKeyword:
                        functionIdentifier.accessor = 'public';
                        break;
                    case typescript.SyntaxKind.PrivateKeyword:
                        functionIdentifier.accessor = 'private';
                        break;
                    case typescript.SyntaxKind.ProtectedKeyword:
                        functionIdentifier.accessor = 'protected';
                        break;
                    case typescript.SyntaxKind.ConstKeyword:
                        functionIdentifier.isFinal = true;
                        break;
                    case typescript.SyntaxKind.StaticKeyword:
                        functionIdentifier.isStatic = true;
                        break;
                }
            }
        }

        // name
        const name = astNode.name.escapedText;
        functionIdentifier.identifier = name;

        // exports
        if (astNode.parent.isTop && functionIdentifier.accessor === 'public' && functionIdentifier.isStatic === true) {
            this.exports[name] = functionIdentifier;
        }

        this.FunctionParameter(astNode, functionIdentifier);

        functionIdentifier.write(' {');
        functionIdentifier.enterClosure();
        this.Block(astNode.body, functionIdentifier);
        functionIdentifier.exitClosure();
        functionIdentifier.writeln('}');
    }

    ClassStaticBlockDeclaration(astNode, printer) {
    }

    Constructor(astNode, printer) {
        const constructorIdentifier = new ConstructorIdentifier(printer.level);
        astNode.eval = constructorIdentifier;
        printer.write(constructorIdentifier);

        constructorIdentifier.module = this.classFullName;

        constructorIdentifier.accessor = 'public';

        // identifier
        const className = astNode.parent.name.escapedText;
        constructorIdentifier.identifier = className;
        constructorIdentifier.type = className;

        // parameters
        this.ConstructorParameter(astNode, constructorIdentifier);

        // body
        constructorIdentifier.write('{');
        constructorIdentifier.enterClosure();
        this.Block(astNode.body, constructorIdentifier);
        constructorIdentifier.exitClosure();
        constructorIdentifier.writeln('\0}');
    }

    GetAccessor(astNode, printer) {
    }

    SetAccessor(astNode, printer) {
    }

    CallSignature(astNode, printer) {
    }

    ConstructSignature(astNode, printer) {
    }

    IndexSignature(astNode, printer) {
    }

    TypePredicate(astNode, printer) {
    }

    TypeReference(astNode, printer) {
    }

    FunctionType(astNode, printer) {
    }

    ConstructorType(astNode, printer) {
    }

    TypeQuery(astNode, printer) {
    }

    TypeLiteral(astNode, printer) {
    }

    ArrayType(astNode, printer) {
    }

    TupleType(astNode, printer) {
    }

    OptionalType(astNode, printer) {
    }

    RestType(astNode, printer) {
    }

    UnionType(astNode, printer) {
    }

    IntersectionType(astNode, printer) {
    }

    ConditionalType(astNode, printer) {
    }

    InferType(astNode, printer) {
    }

    ParenthesizedType(astNode, printer) {
    }

    ThisType(astNode, printer) {
    }

    TypeOperator(astNode, printer) {
    }

    IndexedAccessType(astNode, printer) {
    }

    MappedType(astNode, printer) {
    }

    LiteralType(astNode, printer) {
    }

    NamedTupleMember(astNode, printer) {
    }

    TemplateLiteralType(astNode, printer) {
    }

    TemplateLiteralTypeSpan(astNode, printer) {
    }

    ImportType(astNode, printer) {
    }

    ObjectBindingPattern(astNode, printer) {
    }

    ArrayBindingPattern(astNode, printer) {
    }

    BindingElement(astNode, printer) {
    }

    ArrayLiteralExpression(astNode, printer) {
        let typeInference = 'Object[]';
        printer.write(() => 'new ' + typeInference);
        printer.write('{');
        typeInference = this.EvalMultiValue(astNode.elements, printer, astNode.multiLine);
        printer.write('\0}');
    }

    ObjectLiteralExpression(astNode, printer) {
    }

    PropertyAccessExpression(astNode, printer) {
        const name = astNode.name.escapedText;
        const expression = astNode.expression;
        if (expression) {
            switch (expression.kind) {
                case typescript.SyntaxKind.Identifier:
                    if (expression.escapedText === 'console' && ['log', 'info', 'debug', 'warn'].includes(name)) {
                        printer.write('\0System.out.println');
                        return;
                    }
                    this.Identifier(expression, printer);
                    break;
                case typescript.SyntaxKind.ThisKeyword:
                    printer.write('this');
                    break;
                case typescript.SyntaxKind.PropertyAccessExpression:
                    this.PropertyAccessExpression(expression, printer);
                    break;
            }
            printer.write(`\0.${name}`);
        } else {
            printer.write(`\0${name}`);
        }
    }

    ElementAccessExpression(astNode, printer) {
    }

    CallExpression(astNode, printer) {
        const expression = astNode.expression;
        const argumentsList = astNode.arguments;
        switch (expression.kind) {
            case typescript.SyntaxKind.PropertyAccessExpression:
                this.PropertyAccessExpression(expression, printer);
                break;
            case typescript.SyntaxKind.Identifier:
                this.CallIdentifier(expression, printer);
        }
        printer.write('\0(');
        this.EvalMultiValue(argumentsList, printer);
        printer.write('\0)');
    }

    NewExpression(astNode, printer) {
        printer.write('new');
        const expression = astNode.expression;
        const typeReference = this.EvalTypeReference(astNode, expression.escapedText);
        const className = typeReference.expression;
        printer.write(className)
        printer.write('\0(');
        this.EvalMultiValue(astNode.arguments, printer);
        printer.write('\0)');
        return className;
    }

    TaggedTemplateExpression(astNode, printer) {
    }

    TypeAssertionExpression(astNode, printer) {
    }

    ParenthesizedExpression(astNode, printer) {
    }

    FunctionExpression(astNode, printer) {
        debugger;
    }

    ArrowFunction(astNode, printer) {
        const lambdaIdentifier = new LambdaIdentifier(printer.level);
        astNode.eval = lambdaIdentifier;
        printer.write(lambdaIdentifier);

        lambdaIdentifier.module = this.classFullName;

        const returnType = this.EvalReturnType(astNode.type);
        lambdaIdentifier.returnType = returnType.expression;
        lambdaIdentifier.returnTypeModule = returnType.module;

        this.FunctionParameter(astNode, lambdaIdentifier);

        const body = astNode.body;
        switch (body.kind) {
            case typescript.SyntaxKind.NewExpression:
                this.NewExpression(body, lambdaIdentifier);
                break;
            case typescript.SyntaxKind.Block:
                this.Block(body, lambdaIdentifier);
                break;
        }
        return lambdaIdentifier.type;
    }

    DeleteExpression(astNode, printer) {
    }

    TypeOfExpression(astNode, printer) {
    }

    VoidExpression(astNode, printer) {
    }

    AwaitExpression(astNode, printer) {
    }

    PrefixUnaryExpression(astNode, printer) {
        switch (astNode.operator) {
            case typescript.SyntaxKind.PlusPlusToken:
                printer.write('++');
                break;
            case typescript.SyntaxKind.MinusMinusToken:
                printer.write('--');
                break;
        }
        printer.write('\0');
        return this.EvalExpression(astNode.operand, printer);
    }

    PostfixUnaryExpression(astNode, printer) {
        this.EvalExpression(astNode.operand, printer);
        printer.write('\0');
        switch (astNode.operator) {
            case typescript.SyntaxKind.PlusPlusToken:
                printer.write('++');
                break;
            case typescript.SyntaxKind.MinusMinusToken:
                printer.write('--');
                break;
        }
    }

    BinaryExpression(astNode, printer) {
        this.EvalExpression(astNode.left, printer);
        this.BinaryOperation(astNode.operatorToken, printer);
        this.EvalExpression(astNode.right, printer);
    }

    BinaryOperation(astNode, printer) {
        switch (astNode.kind) {
            case typescript.SyntaxKind.EqualsToken:
                printer.write('=');
                break;
            case typescript.SyntaxKind.PlusToken:
                printer.write('+');
                break;
            case typescript.SyntaxKind.PlusPlusToken:
                printer.write('++');
                break;
            case typescript.SyntaxKind.PlusEqualsToken:
                printer.write('+=');
                break;
            case typescript.SyntaxKind.MinusToken:
                printer.write('-');
                break;
            case typescript.SyntaxKind.MinusEqualsToken:
                printer.write('-=');
                break;
            case typescript.SyntaxKind.AsteriskToken:
                printer.write('*');
                break;
            case typescript.SyntaxKind.SlashToken:
                printer.write('/');
                break;
            default:

        }
    }

    // BinaryValue(astNode, printer) {
    //     switch (astNode.kind) {
    //         case typescript.SyntaxKind.PropertyAccessExpression:
    //             this.PropertyAccessExpression(astNode, printer);
    //             break;
    //         case typescript.SyntaxKind.Identifier:
    //             this.Identifier(astNode, printer);
    //             break;
    //     }
    // }

    ConditionalExpression(astNode, printer) {
    }

    TemplateExpression(astNode, printer) {
    }

    YieldExpression(astNode, printer) {
    }

    SpreadElement(astNode, printer) {
    }

    ClassExpression(astNode, printer) {
    }

    OmittedExpression(astNode, printer) {
    }

    ExpressionWithTypeArguments(astNode, printer) {
    }

    AsExpression(astNode, printer) {
    }

    NonNullExpression(astNode, printer) {
    }

    MetaProperty(astNode, printer) {
    }

    SyntheticExpression(astNode, printer) {
    }

    SatisfiesExpression(astNode, printer) {
    }

    TemplateSpan(astNode, printer) {
    }

    SemicolonClassElement(astNode, printer) {
    }

    Block(astNode, printer) {
        const statements = astNode.statements;
        for (const statement of statements) {
            printer.writeln();
            switch (statement.kind) {
                case typescript.SyntaxKind.FirstStatement:
                    this.FirstStatement(statement, printer);
                    break;
                /// const / let =
                case typescript.SyntaxKind.VariableStatement:
                    this.VariableStatement(statement, printer);
                    break;
                /// function declaration
                case typescript.SyntaxKind.FunctionDeclaration:
                    printer.writeln();
                    this.FunctionDeclaration(statement, printer);
                    break;
                /// class declaration
                case typescript.SyntaxKind.ClassDeclaration:
                    printer.writeln();
                    this.ClassDeclaration(statement, printer);
                    break;
                /// call / new / operator
                case typescript.SyntaxKind.ExpressionStatement:
                    this.ExpressionStatement(statement, printer);
                    break;
                /// if / else if / else
                case typescript.SyntaxKind.IfStatement:
                    this.IfStatement(statement, printer);
                    break;
                /// for / do-while / while / break / continue
                case typescript.SyntaxKind.DoStatement:
                    this.DoStatement(statement, printer);
                    break;
                case typescript.SyntaxKind.WhileStatement:
                    this.WhileStatement(statement, printer);
                    break;
                case typescript.SyntaxKind.ForStatement:
                    this.ForStatement(statement, printer);
                    break;
                case typescript.SyntaxKind.ForInStatement:
                    this.ForInStatement(statement, printer);
                    break;
                case typescript.SyntaxKind.ForOfStatement:
                    this.ForOfStatement(statement, printer);
                    break;
                case typescript.SyntaxKind.ReturnStatement:
                    this.ReturnStatement(statement, printer);
                    break;
                /// with / switch
                case typescript.SyntaxKind.WithStatement:
                    this.WhileStatement(statement, printer);
                    break;
                case typescript.SyntaxKind.SwitchStatement:
                    this.SwitchStatement(statement, printer);
                    break;
                /// label : xxx
                case typescript.SyntaxKind.LabeledStatement:
                    this.LabeledStatement(statement, printer);
                    break;
                /// throw xxx
                case typescript.SyntaxKind.ThrowStatement:
                    this.ThrowStatement(statement, printer);
                    break;
                /// try catch finally
                case typescript.SyntaxKind.TryStatement:
                    this.TryStatement(statement, printer);
                    break;
                case typescript.SyntaxKind.CatchClause:
                    this.CatchClause(statement, printer);
                    break;

            }
            printer.write('\0;');
        }
    }

    EmptyStatement(astNode, printer) {
    }

    VariableStatement(astNode, printer) {
        this.VariableDeclarationList(astNode.declarationList, printer);
    }

    ExpressionStatement(astNode, printer) {
        const expression = astNode.expression;
        switch (expression.kind) {
            case typescript.SyntaxKind.CallExpression:
                this.CallExpression(expression, printer);
                break;
            case typescript.SyntaxKind.BinaryExpression:
                this.BinaryExpression(expression, printer);
                break;
        }
    }

    IfStatement(astNode, printer) {
    }

    DoStatement(astNode, printer) {
    }

    WhileStatement(astNode, printer) {
    }

    ForStatement(astNode, printer) {
    }

    ForInStatement(astNode, printer) {
    }

    ForOfStatement(astNode, printer) {
    }

    ContinueStatement(astNode, printer) {
    }

    BreakStatement(astNode, printer) {
    }

    ReturnStatement(astNode, printer) {
        printer.write('return');
        this.EvalExpression(astNode.expression, printer);
    }

    WithStatement(astNode, printer) {
    }

    SwitchStatement(astNode, printer) {
    }

    LabeledStatement(astNode, printer) {
    }

    ThrowStatement(astNode, printer) {
    }

    TryStatement(astNode, printer) {
    }

    DebuggerStatement(astNode, printer) {
    }

    VariableDeclaration(astNode, printer) {
        const variableIdentifier = new VariableIdentifier(printer.level);
        astNode.eval = variableIdentifier;

        variableIdentifier.module = this.classFullName;

        let fieldName = astNode.name.escapedText;

        let defaultType = canUseVarKeyword ? 'var' : 'Object';
        let hasEndSymbol = false;

        // accessor
        const astParent = astNode.parent.parent;
        if (isTopNode(astParent)) {
            variableIdentifier.accessor = 'private';
            const modifiers = astParent.modifiers;
            if (modifiers) {
                for (const modifier of modifiers) {
                    switch (modifier.kind) {
                        case typescript.SyntaxKind.ExportKeyword:
                            variableIdentifier.accessor = 'public';
                            variableIdentifier.isStatic = true;
                            this.exports[fieldName] = variableIdentifier;
                            break;
                        case typescript.SyntaxKind.DefaultKeyword:
                            fieldName = this.className;
                            break;
                    }
                }
            }
            defaultType = 'Object';
            hasEndSymbol = true;
            this.root.write(variableIdentifier);
        } else {
            printer.write(variableIdentifier);
        }


        // modifierFlags
        if (astNode.parent.flags == typescript.NodeFlags.Const) {
            variableIdentifier.isFinal = true;
        }

        // type
        const javaType = this.EvalJavaType(astNode.type, '');
        variableIdentifier.rawType = javaType.expression;
        variableIdentifier.rawTypeModule = javaType.module;
        // name
        variableIdentifier.identifier = fieldName;
        // initializer
        const initializer = astNode.initializer;
        this.EvalInitalizer(initializer, variableIdentifier, defaultType);

        if (hasEndSymbol) {
            variableIdentifier.write('\0;');
        }
    }

    VariableDeclarationList(astNode, printer) {
        for (let declaration of astNode.declarations) {
            this.VariableDeclaration(declaration, printer);
        }
    }

    FunctionDeclaration(astNode, printer) {
        const functionIdentifier = new FunctionIdentifier(printer.level);
        astNode.eval = functionIdentifier;

        functionIdentifier.module = this.classFullName;

        // methodName
        let methodName = astNode.name.escapedText;


        // accessor
        if (isTopNode(astNode)) {
            astNode.isTop = true;
            functionIdentifier.accessor = 'private';
            const modifiers = astNode.modifiers;
            if (modifiers) {
                for (const modifier of modifiers) {
                    switch (modifier.kind) {
                        case typescript.SyntaxKind.ExportKeyword:
                            functionIdentifier.accessor = 'public';
                            functionIdentifier.isStatic = true;
                            this.exports[methodName] = functionIdentifier;
                            break;
                        case typescript.SyntaxKind.DefaultKeyword:
                            methodName = this.className;
                            break;
                    }
                }
            }
            this.root.write(functionIdentifier);
        } else {
            printer.write(functionIdentifier);
        }

        functionIdentifier.identifier = methodName;

        // returnType
        const returnType = this.EvalReturnType(astNode.type);
        functionIdentifier.returnType = returnType.expression;
        functionIdentifier.returnTypeModule = returnType.module;

        // parameter
        this.FunctionParameter(astNode, functionIdentifier);
        // function body
        functionIdentifier.write(' {');
        functionIdentifier.enterClosure();
        this.Block(astNode.body, functionIdentifier);
        functionIdentifier.exitClosure();
        functionIdentifier.writeln('}');

    }

    ClassDeclaration(astNode, printer) {
        const className = astNode.name.escapedText;
        if (isTopNode(astNode) && this.className === className) {
            astNode.eval = this.root;
            astNode.isTop = true;
            this.ClassMember(astNode.members, this.root);
            return;
        }
        const classIdentifier = new ClassIdentifier(printer.level);
        astNode.eval = classIdentifier;
        printer.write(classIdentifier);

        if (isTopNode(astNode)) {
            this.exports[className] = classIdentifier;
        }

        classIdentifier.module = this.classFullName;

        classIdentifier.type = className;
        classIdentifier.identifier = className;

        for (let modifier of astNode.modifiers) {
            switch (modifier.kind) {
                case typescript.SyntaxKind.ExportKeyword:
                    classIdentifier.accessor = 'public';
                    classIdentifier.isStatic = true;
                    break;
                case typescript.SyntaxKind.DefaultKeyword:
                    //classIdentifier.isStatic = true;
                    break;
            }
        }

        classIdentifier.enterClosure();
        classIdentifier.writeln();
        this.ClassMember(astNode.members, classIdentifier);
        classIdentifier.exitClosure();
    }

    ClassMember(members, printer) {
        for (let i = 0; i < members.length; i++) {
            const member = members[i];
            if (i !== 0) {
                printer.writeln();
            }
            switch (member.kind) {
                case typescript.SyntaxKind.Constructor:
                    this.Constructor(member, printer);
                    break;
                case typescript.SyntaxKind.PropertyDeclaration:
                    this.PropertyDeclaration(member, printer);
                    break;
                case typescript.SyntaxKind.MethodDeclaration:
                    this.MethodDeclaration(member, printer);
                    break;
            }
        }
    }

    InterfaceDeclaration(astNode, printer) {
    }

    TypeAliasDeclaration(astNode, printer) {
    }

    EnumDeclaration(astNode, printer) {
    }

    ModuleDeclaration(astNode, printer) {
    }

    ModuleBlock(astNode, printer) {
    }

    CaseBlock(astNode, printer) {
    }

    NamespaceExportDeclaration(astNode, printer) {
    }

    ImportEqualsDeclaration(astNode, printer) {
    }

    ImportDeclaration(astNode, printer) {
        const moduleSpecifier = astNode.moduleSpecifier.text;
        const resolvePath = this.pluginObject.resolveId(moduleSpecifier, this.fileName);
        if (!resolvePath) {
            return;
        }
        const moduleFullName = toFullClassName(resolvePath);

        let moduleName = toModuleName(moduleFullName);

        this.addImport(moduleFullName);

        const importClause = astNode.importClause;
        if (importClause) {
            const importAsName = importClause.name?.escapedText;
            if (importAsName) {
                const identifierAlias = this.createAlias(importAsName, moduleFullName);
                importClause.eval = identifierAlias;
            }

            const namedBindings = importClause.namedBindings;
            if (namedBindings) {
                for (let element of namedBindings.elements) {
                    const elementName = element.name.escapedText;
                    let propertyName = element.propertyName?.escapedText;
                    if (!propertyName) {
                        propertyName = elementName;
                    }
                    const identifierAlias = this.createAlias(elementName, moduleFullName, propertyName);
                    element.eval = identifierAlias;
                }
            }
        }
    }

    ImportClause(astNode, printer) {
    }

    NamespaceImport(astNode, printer) {
    }

    // NamedImports(astNode, printer) {
    // }

    ImportSpecifier(astNode, printer) {
    }

    ExportAssignment(astNode, printer) {
        const name = astNode.symbol.escapedName;
        const text = astNode.expression.escapedText;
        //this.declarations[astNode.symbol.escapedName].accessor = 'public';
    }

    ExportDeclaration(astNode, printer) {
    }

    NamedExports(astNode, printer) {
    }

    NamespaceExport(astNode, printer) {
    }

    ExportSpecifier(astNode, printer) {
    }

    MissingDeclaration(astNode, printer) {
    }

    ExternalModuleReference(astNode, printer) {
    }

    JsxElement(astNode, printer) {
    }

    JsxSelfClosingElement(astNode, printer) {
    }

    JsxOpeningElement(astNode, printer) {
    }

    JsxClosingElement(astNode, printer) {
    }

    JsxFragment(astNode, printer) {
    }

    JsxOpeningFragment(astNode, printer) {
    }

    JsxClosingFragment(astNode, printer) {
    }

    JsxAttribute(astNode, printer) {
    }

    JsxAttributes(astNode, printer) {
    }

    JsxSpreadAttribute(astNode, printer) {
    }

    JsxExpression(astNode, printer) {
    }

    JsxNamespacedName(astNode, printer) {
    }

    CaseClause(astNode, printer) {
    }

    DefaultClause(astNode, printer) {
    }

    HeritageClause(astNode, printer) {
    }

    CatchClause(astNode, printer) {
    }

    AssertClause(astNode, printer) {
    }

    AssertEntry(astNode, printer) {
    }

    ImportTypeAssertionContainer(astNode, printer) {
    }

    PropertyAssignment(astNode, printer) {
    }

    ShorthandPropertyAssignment(astNode, printer) {
    }

    SpreadAssignment(astNode, printer) {
    }

    EnumMember(astNode, printer) {
    }

    SourceFile(astNode, printer) {
    }

    Bundle(astNode, printer) {
    }

    JSDocTypeExpression(astNode, printer) {
    }

    JSDocNameReference(astNode, printer) {
    }

    JSDocMemberName(astNode, printer) {
    }

    JSDocAllType(astNode, printer) {
    }

    JSDocUnknownType(astNode, printer) {
    }

    JSDocNullableType(astNode, printer) {
    }

    JSDocNonNullableType(astNode, printer) {
    }

    JSDocOptionalType(astNode, printer) {
    }

    JSDocFunctionType(astNode, printer) {
    }

    JSDocVariadicType(astNode, printer) {
    }

    JSDocNamepathType(astNode, printer) {
    }

    JSDoc(astNode, printer) {
    }

    JSDocText(astNode, printer) {
    }

    JSDocTypeLiteral(astNode, printer) {
    }

    JSDocSignature(astNode, printer) {
    }

    JSDocLink(astNode, printer) {
    }

    JSDocLinkCode(astNode, printer) {
    }

    JSDocLinkPlain(astNode, printer) {
    }

    JSDocTag(astNode, printer) {
    }

    JSDocAugmentsTag(astNode, printer) {
    }

    JSDocImplementsTag(astNode, printer) {
    }

    JSDocAuthorTag(astNode, printer) {
    }

    JSDocDeprecatedTag(astNode, printer) {
    }

    JSDocClassTag(astNode, printer) {
    }

    JSDocPublicTag(astNode, printer) {
    }

    JSDocPrivateTag(astNode, printer) {
    }

    JSDocProtectedTag(astNode, printer) {
    }

    JSDocReadonlyTag(astNode, printer) {
    }

    JSDocOverrideTag(astNode, printer) {
    }

    JSDocCallbackTag(astNode, printer) {
    }

    JSDocOverloadTag(astNode, printer) {
    }

    JSDocEnumTag(astNode, printer) {
    }

    JSDocParameterTag(astNode, printer) {
    }

    JSDocReturnTag(astNode, printer) {
    }

    JSDocThisTag(astNode, printer) {
    }

    JSDocTypeTag(astNode, printer) {
    }

    JSDocTemplateTag(astNode, printer) {
    }

    JSDocTypedefTag(astNode, printer) {
    }

    JSDocSeeTag(astNode, printer) {
    }

    JSDocPropertyTag(astNode, printer) {
    }

    JSDocThrowsTag(astNode, printer) {
    }

    JSDocSatisfiesTag(astNode, printer) {
    }

    SyntaxList(astNode, printer) {
    }

    NotEmittedStatement(astNode, printer) {
    }

    PartiallyEmittedExpression(astNode, printer) {
    }

    CommaListExpression(astNode, printer) {
    }

    SyntheticReferenceExpression(astNode, printer) {
    }

    Count(astNode, printer) {
    }

    FirstAssignment(astNode, printer) {
    }

    LastAssignment(astNode, printer) {
    }

    FirstCompoundAssignment(astNode, printer) {
    }

    LastCompoundAssignment(astNode, printer) {
    }

    FirstReservedWord(astNode, printer) {
    }

    LastReservedWord(astNode, printer) {
    }

    FirstKeyword(astNode, printer) {
    }

    LastKeyword(astNode, printer) {
    }

    FirstFutureReservedWord(astNode, printer) {
    }

    LastFutureReservedWord(astNode, printer) {
    }

    FirstTypeNode(astNode, printer) {
    }

    LastTypeNode(astNode, printer) {
    }

    FirstPunctuation(astNode, printer) {
    }

    LastPunctuation(astNode, printer) {
    }

    FirstToken(astNode, printer) {
    }

    LastToken(astNode, printer) {
    }

    FirstTriviaToken(astNode, printer) {
    }

    LastTriviaToken(astNode, printer) {
    }

    FirstLiteralToken(astNode, printer) {
    }

    LastLiteralToken(astNode, printer) {
    }

    FirstTemplateToken(astNode, printer) {
    }

    LastTemplateToken(astNode, printer) {
    }

    FirstBinaryOperator(astNode, printer) {
    }

    LastBinaryOperator(astNode, printer) {
    }

    FirstStatement(astNode, printer) {
        const declarationList = astNode.declarationList;
        switch (declarationList.kind) {
            case typescript.SyntaxKind.VariableDeclarationList:
                this.VariableDeclarationList(declarationList, printer);
                break;
        }
    }

    LastStatement(astNode, printer) {
    }

    FirstNode(astNode, printer) {
    }

    FirstJSDocNode(astNode, printer) {
    }

    LastJSDocNode(astNode, printer) {
    }

    FirstJSDocTagNode(astNode, printer) {
    }

    LastJSDocTagNode(astNode, printer) {
    }
}

class JavaIdentifier extends Printer {
    module;
    identifier;
    #type;
    // 260 Variable, 262 Function, 263 Class, 264 Interface, 267 Module
    kind;

    set type(val) {
        this.#type = val;
    }

    get type() {
        return this.#type;
    }

    assign(module = null) {
        return this.expression(module);
    }

    call(module = null) {
        return this.expression(module);
    }

    expression(module = null) {
        return this.identifier;
    }

    constructor(level) {
        super(level);
    }
}

class FunctionIdentifier extends JavaIdentifier {
    accessor = null;// private | public
    isStatic = false;
    isFinal = false;// final
    returnType = 'void';
    returnTypeModule = null;

    parameters = '';

    functionInterface;

    constructor(level) {
        super(level);
        this.kind = typescript.SyntaxKind.FunctionDeclaration;
    }

    assign(module = null) {
        let moduleName = toModuleName(this.module);
        if (module == null || module.classFullName === this.module) {
            // use local module
            return this.identifier;
        }
        let pre = this.module;
        if (module.tryImport(this.module)) {
            pre = moduleName;
        }
        if (this.identifier === moduleName) {
            return pre;
        } else {
            return `${pre}::${this.identifier}`;
        }
    }

    expression(module = null) {
        let moduleName = toModuleName(this.module);
        if (module == null || module.classFullName === this.module) {
            // use local module
            return this.identifier;
        }
        let pre = this.module;
        if (module.tryImport(this.module)) {
            pre = moduleName;
        }
        if (this.identifier === moduleName) {
            return pre;
        } else {
            return `${pre}.${this.identifier}`;
        }
    }

    toString() {
        let code = '';
        if (this.accessor !== null) {
            code += this.accessor + ' ';
        }
        if (this.isStatic) {
            code += 'static ';
        }
        if (this.isFinal) {
            code += 'final ';
        }
        let returnType = this.returnType;
        if (typeof (returnType) === 'function') {
            returnType = callFunction(returnType);
        }
        code += `${returnType} ${this.identifier}(${this.parameters.toString()})${super.toString()}`;
        return code;
    }

    clone() {
        const functionIdentifier = new FunctionIdentifier(this.level);
        functionIdentifier.identifier = this.identifier;
        functionIdentifier.module = this.module;
        functionIdentifier.type = this.type;
        functionIdentifier.kind = this.kind;

        functionIdentifier.accessor = this.accessor;
        functionIdentifier.isFinal = this.isFinal;
        functionIdentifier.isStatic = this.isStatic;
        functionIdentifier.returnType = this.returnType;
        functionIdentifier.returnTypeModule = this.returnTypeModule;
        functionIdentifier.parameters = this.parameters;
        functionIdentifier.functionInterface = this.functionInterface;
        return functionIdentifier;
    }
}

class LambdaIdentifier extends JavaIdentifier {
    returnType = 'void';
    returnTypeModule = null;

    parameters = '';

    functionInterface;

    constructor(level) {
        super(level);
        this.kind = typescript.SyntaxKind.FunctionDeclaration;
    }

    toString() {
        return `(${this.parameters}) -> ${super.toString()}`;
    }

    clone() {
        const lambdaIdentifier = new LambdaIdentifier(this.level);
        lambdaIdentifier.identifier = this.identifier;
        lambdaIdentifier.module = this.module;
        lambdaIdentifier.type = this.type;
        lambdaIdentifier.kind = this.kind;

        lambdaIdentifier.returnType = this.returnType;
        lambdaIdentifier.returnTypeModule = this.returnTypeModule;
        lambdaIdentifier.parameters = this.parameters;
        lambdaIdentifier.functionInterface = this.functionInterface;
        return lambdaIdentifier;
    }
}

class ConstructorIdentifier extends JavaIdentifier {
    accessor = null;// private | public
    isStatic = false;
    modifier = null;// final

    parameters = '';

    constructor(level) {
        super(level);
        this.kind = typescript.SyntaxKind.FunctionDeclaration;
    }

    toString() {
        let code = '';
        if (this.accessor !== null) {
            code += this.accessor + ' ';
        }
        if (this.isStatic) {
            code += 'static ';
        }
        if (this.modifier) {
            code += this.modifier + ' ';
        }
        code += `${this.identifier}(${this.parameters})${super.toString()}`;
        return code;
    }
}

class VariableIdentifier extends JavaIdentifier {
    accessor = null;// private | public
    isStatic = false;
    isFinal = false;
    isFunction = false;// null | false | true

    rawType = '';

    constructor(level) {
        super(level);
        this.kind = typescript.SyntaxKind.VariableDeclaration;
    }

    call(module = null) {
        if (this.isFunction === null) {
            return () => {
                if (this.isFunction === true) {
                    return this.expression(module) + '.call';
                }
                return this.expression(module);
            }
        } else if (this.isFunction === true) {
            return this.expression(module) + '.call';
        }
        return this.expression(module);
    }

    expression(module = null) {
        let moduleName = toModuleName(this.module);
        if (module == null || module.classFullName === this.module) {
            // use local module
            return this.identifier;
        }
        let pre = this.module;
        if (module.tryImport(this.module)) {
            pre = moduleName;
        }
        if (this.identifier === moduleName) {
            return pre;
        } else {
            return `${pre}.${this.identifier}`;
        }
    }

    toString() {
        let code = '';
        if (this.accessor !== null) {
            code += this.accessor + ' ';
        }
        if (this.isStatic) {
            code += 'static ';
        }
        if (this.isFinal) {
            code += 'final ';
        }
        let type = this.type;
        if (typeof (type) === 'function') {
            type = callFunction(type);
        } else {
            type = type.toString();
        }
        code += `${type} ${this.identifier}${super.toString()}`;
        return code;
    }
}

class Block extends Printer {

    constructor(level) {
        super(level + 1);
    }
}

class ClassIdentifier extends JavaIdentifier {
    accessor = null;// private | public
    isStatic = false;

    modifier = null;// final

    staticBlock;

    constructor(level) {
        super(level);
        this.kind = typescript.SyntaxKind.ClassDeclaration;
        this.staticBlock = new Block(level);
    }

    expression(module = null) {
        let moduleName = toModuleName(this.module);
        if (module == null || module.classFullName === this.module) {
            // use local module
            return this.identifier;
        }
        let pre = this.module;
        if (module.tryImport(this.module)) {
            pre = moduleName;
        }
        if (this.identifier === moduleName) {
            return pre;
        } else {
            return `${pre}.${this.identifier}`;
        }
    }

    toString() {
        let code = '';
        if (this.accessor !== null) {
            code += this.accessor + ' ';
        }
        if (this.isStatic) {
            code += 'static ';
        }
        if (this.modifier) {
            code += this.modifier + ' ';
        }
        let staticCode = '';
        if (!this.staticBlock.isEmpty) {
            staticCode = `\n${this.indent}static {\n${this.staticBlock.indent}${this.staticBlock.toString()}\n${this.indent}}`;
        }
        code += `class ${this.identifier} {${staticCode}\n${this.indent}${super.toString()}\n${this.indent}}`;
        return code;
    }
}

class InterfaceIdentifier extends JavaIdentifier {

    constructor() {
        super();
        this.kind = typescript.SyntaxKind.InterfaceDeclaration;
    }
}


class ImportIdentifier extends JavaIdentifier {

    get type() {
        return this.declaration.type;
    }

    assign(module = null) {
        return this.declaration.assign(module);
    }

    call(module = null) {
        return this.declaration.call(module);
    }

    expression(module = null) {
        return this.declaration.expression(module);
    }

    get declaration() {
        return javaContext.modules.get(this.module).exports[this.identifier];
    }
}

class JavaModule {

    constructor(parser) {
        this.#parser = parser;
    }

    packageName;
    className;
    classFullName;

    // [module, ...]
    imports = [];

    // export identifier: <identifier, JavaIdentifier>
    exports = {};

    root = new ClassIdentifier(0);

    #parser;

    tryImport(classFullName) {
        const moduleName = toModuleName(classFullName);
        const modulePackage = toModulePackage(classFullName);

        if (moduleName === this.packageName) return true;

        let conflict = false;
        for (let item of this.imports) {
            if (moduleName === toModuleName(item)) {
                conflict = true;
                break;
            }
        }
        return conflict;
    }

    addImport(classFullName) {
        const moduleName = toModuleName(classFullName);
        const modulePackage = toModulePackage(classFullName);

        if (moduleName === this.packageName) return true;

        let conflict = false;
        for (let item of this.imports) {
            if (moduleName === toModuleName(item)) {
                conflict = true;
                break;
            }
        }
        if (!conflict) {
            this.imports.push(classFullName);
        }
    }

    outputFile() {
        this.#parser.outputFile();
    }
}

class JavaFunctionInterface {
    imports = new Set();
    #parameters = [];
    #returnType = 'void';

    get returnType() {
        return this.#returnType;
    }

    set returnType(str) {
        this.#returnType = str;
        this.#type = null;
    }

    get parameters() {
        return this.#parameters;
    }

    set parameters(param) {
        this.#parameters = param;
        this.#type = null;
    }

    #type = null;
    get type() {
        if (this.#type) return this.#type;

        function _type() {
            let code = 'Function';
            for (let parameter of this.parameters) {
                code += parameter.replace('...', 'Dot');
            }
            code += `Return${toClassName(this.returnType)}`;
            this.#type = code;
            return this.#type;
        }

        if (typeof (this.returnType) === 'function' || this.parameters.some(param => typeof (param) === 'function')) {
            return () => {
                this.returnType = callFunction(this.returnType);
                return _type.call(this);
            }
        }
        return _type.call(this);
    }
}

class JavaContext {
    /// [javaModule, ...]
    modules = new ListMap();
    // FunctionXYReturnZ
    functionInterface = new Map();

    getModule(classFullName) {
        return this.modules.get(classFullName);
    }

    setModule(javaModule) {
        this.modules.set(javaModule.classFullName, javaModule);
    }

}

const javaContext = new JavaContext();
export default function JavaPlugin(serviceOptions) {
    const basePlugin = plugin(serviceOptions);
    basePlugin.name = 'java-plugin';
    basePlugin.transform = function (contents, id) {
        const pluginContext = this;

        const tsOptions = {
            ...basePlugin.tsOptions,
            fileName: id,
            transformers: {
                before: [compileContext => sourceFile => {
                    const parser = new Parser({
                        pluginContext,
                        serviceOptions,
                        pluginObject: basePlugin,
                        compileContext,
                    });
                    parser.parse(sourceFile);
                    return sourceFile;
                }]
            }
        };

        const transpileOutput = typescript.transpileModule(contents, tsOptions)

        return {
            code: transpileOutput.outputText, //moduleSideEffects: 'no-treeshake',
            map: transpileOutput.sourceMapText
        };
    }
    basePlugin.buildEnd = function (error) {
        if (error) return;
        for (let i = javaContext.modules.size - 1; i >= 0; i--) {
            const { _, value } = javaContext.modules.at(i);
            value.outputFile();
        }

        if (javaContext.functionInterface.size) {
            const printer = new Printer();
            const basePackage = config.java.package;

            printer.write(`package ${basePackage};`);
            printer.writeln();

            let importCode = '';
            let bodyCode = '';

            printer.writeln(() => importCode);

            printer.writeln('public interface FunctionInterface {');
            let importSet = new Set();
            for (let [interfaceName, functionInterface] of javaContext.functionInterface) {
                for (const importItem of functionInterface.imports) {
                    if (importSet.has(importItem)) continue;
                    importSet.add(importItem);
                    importCode += `import ${importItem};\n`;
                }
                let paramList = [];
                functionInterface.parameters.forEach((item, index) => {
                    paramList.push(`${item} param${index}`);
                });
                printer.enterClosure();
                printer.writeln(`interface ${interfaceName} {`);
                printer.enterClosure();
                printer.writeln(`${functionInterface.returnType} call(${paramList.join(', ')});`);
                printer.exitClosure();
                printer.writeln(`}\n`);
                printer.exitClosure();
            }
            printer.writeln('}');
            const baseDir = serviceOptions.output.dir;
            const outputDir = path.join(baseDir, 'src', 'main', 'java', basePackage.replace(/\./g, path.sep));
            if (!fs.existsSync(outputDir)) {
                fs.mkdirSync(outputDir, { recursive: true });
            }
            fs.writeFileSync(path.join(outputDir, `FunctionInterface.java`), printer.toString());
        }
    }
    return basePlugin;
}

