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
    return basename.replace(/(^[a-z])|[._]([a-z])/g, ($1, $2) => {
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

class Printer {
    #level = 0;
    #indent = '';

    #seq = ' ';

    constructor(level = 0) {
        this.#level = level;
        for (let i = 1; i <= level; i++) {
            this.#indent += tabSpace;
        }
    }

    get level() {
        return this.#level;
    }

    enterClosure() {
        this.#level++;
        this.#indent += tabSpace;
    }

    exitClosure() {
        this.#level--;
        this.#indent = this.#indent.slice(0, -tabSpace.length);
    }

    #lines = [];

    write(text) {
        this.#lines.push(text);
    }

    writeln(text = '') {
        this.#lines.push('\n' + this.#indent);
        if (text) {
            this.#lines.push(text);
        }
    }

    toString() {
        let noSeq = false;
        let code = '';
        for (let line of this.#lines) {
            if (typeof (line) === 'function') {
                line = line();
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

    createAlias(alias, classFullName, identifier = 'default') {
        const hasLoad = this.addImport(classFullName);

        const importIdentifier = new ImportIdentifier();
        importIdentifier.isFull = !hasLoad;
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

        for (let javaImport of this.imports) {
            this.writeln(`import ${javaImport};`);
        }

        this.writeln(`public class ${this.className} {`);
        this.enterClosure();

        let initCode = this.#initPrinter.toString();
        if (initCode.length > 0) {
            this.writeln('static {');
            this.enterClosure();
            this.write(initCode);
            this.exitClosure();
            this.writeln('}');
        }

        let bodyCode = this.#codePrinter.toString();
        this.writeln(bodyCode);

        this.exitClosure();
        this.writeln('}');
        this.writeln();

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

        const statements = sourceFile.statements;
        for (const statement of statements) {
            switch (statement.kind) {
                /// import / export
                case typescript.SyntaxKind.ImportDeclaration:
                    this.ImportDeclaration(statement, this.#initPrinter);
                    break;
                case typescript.SyntaxKind.ExportAssignment:
                    this.ExportAssignment(statement, this.#initPrinter);
                    break;
                /// function declaration
                case typescript.SyntaxKind.FunctionDeclaration:
                    this.#codePrinter.writeln();
                    this.FunctionDeclaration(statement, this.#codePrinter);
                    break;
                /// const / let =
                case typescript.SyntaxKind.VariableStatement:
                    this.#codePrinter.writeln();
                    this.VariableStatement(statement, this.#codePrinter);
                    break;
                case typescript.SyntaxKind.ClassDeclaration:
                    this.#codePrinter.writeln();
                    this.ClassDeclaration(statement, this.#codePrinter);
                    break;
                /// call / new / operator
                case typescript.SyntaxKind.ExpressionStatement:
                    this.#initPrinter.writeln();
                    this.ExpressionStatement(statement, this.#initPrinter);
                    break;

                /// if / else if / else
                case typescript.SyntaxKind.IfStatement:
                    this.#initPrinter.writeln();
                    this.IfStatement(statement, this.#initPrinter);
                    break;
                /// for / do-while / while / break / continue
                case typescript.SyntaxKind.DoStatement:
                    this.#initPrinter.writeln();
                    this.DoStatement(statement, this.#initPrinter);
                    break;
                case typescript.SyntaxKind.WhileStatement:
                    this.#initPrinter.writeln();
                    this.WhileStatement(statement, this.#initPrinter);
                    break;
                case typescript.SyntaxKind.ForStatement:
                    this.#initPrinter.writeln();
                    this.ForStatement(statement, this.#initPrinter);
                    break;
                case typescript.SyntaxKind.ForInStatement:
                    this.#initPrinter.writeln();
                    this.ForInStatement(statement, this.#initPrinter);
                    break;
                case typescript.SyntaxKind.ForOfStatement:
                    this.#initPrinter.writeln();
                    this.ForOfStatement(statement, this.#initPrinter);
                    break;
                case typescript.SyntaxKind.ReturnStatement:
                    this.#initPrinter.writeln();
                    this.ReturnStatement(statement, this.#initPrinter);
                    break;
                /// with / switch
                case typescript.SyntaxKind.WithStatement:
                    this.#initPrinter.writeln();
                    this.WhileStatement(statement, this.#initPrinter);
                    break;
                case typescript.SyntaxKind.SwitchStatement:
                    this.#initPrinter.writeln();
                    this.SwitchStatement(statement, this.#initPrinter);
                    break;
                /// label : xxx
                case typescript.SyntaxKind.LabeledStatement:
                    this.#initPrinter.writeln();
                    this.LabeledStatement(statement, this.#initPrinter);
                    break;
                /// throw xxx
                case typescript.SyntaxKind.ThrowStatement:
                    this.#initPrinter.writeln();
                    this.ThrowStatement(statement, this.#initPrinter);
                    break;
                /// try catch finally
                case typescript.SyntaxKind.TryStatement:
                    this.#initPrinter.writeln();
                    this.TryStatement(statement, this.#initPrinter);
                    break;
                case typescript.SyntaxKind.CatchClause:
                    this.#initPrinter.writeln();
                    this.CatchClause(statement, this.#initPrinter);
                    break;

            }
        }
    }

    /// custom eval
    EvalTypeReference(astNode, rawType) {
        let type = rawType;
        let module = null;
        const typeDeclaration = this.EvalIdentifier(astNode, rawType);
        if (typeDeclaration) {
            module = typeDeclaration.module;
            type = typeDeclaration.identifier;
            if (type === 'default') {
                type = toModuleName(module);
            }
        } else if (type === 'Date') {
            this.addImport('java.util.Date');
            module = 'java.util.Date';
        }
        return { expression: type, module };
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
                    let elementExpression = elementType.expression ? elementType.expression : '';
                    expression = `${elementExpression}[]`;
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
        let rawType = 'Object';
        let type = 'Object';
        let module = null;
        if (typeNode) {
            switch (typeNode.kind) {
                case typescript.SyntaxKind.TypeReference:
                    rawType = typeNode.typeName.escapedText;
                    const typeReference = this.EvalTypeReference(astNode, rawType);
                    module = typeReference.module;
                    type = typeReference.expression;
                    break;
                case typescript.SyntaxKind.StringKeyword:
                    rawType = 'String';
                    type = rawType;
                    break;
                case typescript.SyntaxKind.NumberKeyword:
                    rawType = 'Number';
                    type = rawType;
                    break;
                case typescript.SyntaxKind.BooleanKeyword:
                    rawType = 'Boolean';
                    type = rawType;
                    break;
                case typescript.SyntaxKind.ArrayType:
                    let elementType = this.EvalJavaType(typeNode.elementType).expression;
                    if (astNode.dotDotDotToken) {
                        rawType = elementType || 'Object';
                        type = `${rawType}...`;
                        break;
                    } else {
                        elementType = elementType ? elementType : 'Object';
                        rawType = `${elementType}[]`;
                        type = rawType;
                        break;
                    }
                case typescript.SyntaxKind.TypeReference:
                    rawType = typeNode.escapedText;
                    type = rawType;
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
            rawType,
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
            return {
                identifier: identifierName,
                module: this.classFullName,
            }
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

    EvalValue(astNode, printer) {
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
            case typescript.SyntaxKind.Identifier:
                typeInference = this.Identifier(astNode, printer);
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
                    printer.write('\0,');
                }
                printer.writeln();
                itemTypeInference = this.EvalValue(element, printer);
                printer.exitClosure();
            } else {
                if (i !== 0) {
                    printer.write('\0,');
                }
                let element = elements[i];
                itemTypeInference = this.EvalValue(element, printer);
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

    Identifier(astNode, printer) {
        const identifierName = astNode.escapedText;
        const identifierObject = this.EvalIdentifier(astNode.parent, identifierName);
        astNode.eval = identifierObject;
        printer.write(() => identifierObject.expression);
        return () => identifierObject.type;
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
        let code = '';
        for (let parameter of parameters) {
            if (code.length) code += ', ';
            const parameterObject = this.EvalParameterType(parameter, printer);
            code += `${parameterObject.type} ${parameterObject.name}`;
            functionInterface.parameters.push(parameterObject.type);
            if (parameterObject.module) {
                functionInterface.imports.add(parameterObject.module);
            }
        }

        printer.functionInterface = functionInterface;
        const functionType = functionInterface.type;
        printer.type = functionType;
        printer.parameters = code;
    }

    ConstructorParameter(astNode, printer) {
        const parameters = astNode.parameters;
        let code = '';
        for (let parameter of parameters) {
            if (code.length) code += ', ';
            const parameterObject = this.EvalParameterType(parameter, printer);
            code += `${parameterObject.type} ${parameterObject.name}`;
        }
        printer.parameters = code;
    }

    Decorator(astNode, printer) {
    }

    PropertySignature(astNode, printer) {
    }

    PropertyDeclaration(astNode, printer) {
        const variableIdentifier = new VariableIdentifier(printer.level);
        astNode.eval = variableIdentifier;
        printer.write(variableIdentifier);

        variableIdentifier.accessor = 'public';

        const javaType = this.EvalJavaType(astNode.type, 'Object');
        variableIdentifier.rawType = javaType.expression;
        variableIdentifier.rawTypeModule = javaType.module;

        variableIdentifier.identifier = astNode.name.escapedText;

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
        // initializer
        const defaultType = 'Object';
        let typeInference = null;
        const initializer = astNode.initializer;
        if (initializer) {
            variableIdentifier.write(' =');
            typeInference = this.EvalValue(initializer, variableIdentifier);
        }
        variableIdentifier.type = variableIdentifier.rawType || typeInference || defaultType;
        variableIdentifier.write('\0;');
    }

    MethodSignature(astNode, printer) {
    }

    MethodDeclaration(astNode, printer) {
        debugger;
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
                this.Identifier(expression, printer);
        }
        printer.write('\0(');
        this.EvalMultiValue(argumentsList, printer);
        printer.write('\0);');
    }

    NewExpression(astNode, printer) {
        printer.write('new');
        const expression = astNode.expression;
        const typeReference = this.EvalTypeReference(astNode, expression.escapedText);
        const className = typeReference.expression;
        printer.write(className + '(');
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
    }

    PostfixUnaryExpression(astNode, printer) {
    }

    BinaryExpression(astNode, printer) {
        this.BinaryValuue(astNode.left, printer);
        this.BinaryOperation(astNode.operatorToken, printer);
        this.BinaryValuue(astNode.right, printer);
        printer.write('\0;');
    }

    BinaryOperation(astNode, printer) {
        switch (astNode.kind) {
            case typescript.SyntaxKind.EqualsToken:
                printer.write('=');
                break;
            case typescript.SyntaxKind.PlusToken:
                printer.write('+');
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

    BinaryValuue(astNode, printer) {
        switch (astNode.kind) {
            case typescript.SyntaxKind.PropertyAccessExpression:
                this.PropertyAccessExpression(astNode, printer);
                break;
            case typescript.SyntaxKind.Identifier:
                this.Identifier(astNode, printer);
                break;
        }
    }

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
        printer.write(variableIdentifier);

        variableIdentifier.module = this.classFullName;

        const fieldName = astNode.name.escapedText;

        let defaultType = canUseVarKeyword ? 'var' : 'Object';
        // accessor
        const astParent = astNode.parent.parent;
        if (isTopNode(astParent)) {
            variableIdentifier.accessor = 'private';
            const modifiers = astParent.modifiers;
            if (modifiers && modifiers[0].kind === typescript.SyntaxKind.ExportKeyword) {
                variableIdentifier.accessor = 'public';
                variableIdentifier.isStatic = true;
            }
            this.exports[fieldName] = variableIdentifier;
            defaultType = 'Object';
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
        let typeInference = null;
        const initializer = astNode.initializer;
        if (initializer) {
            variableIdentifier.write(' =');
            typeInference = this.EvalValue(initializer, variableIdentifier);
        }
        let type = defaultType;
        if (variableIdentifier.rawType) {
            type = variableIdentifier.rawType;
        } else if (typeInference) {
            type = typeInference;
            const initializerEval = initializer.eval;
            if (initializerEval instanceof FunctionIdentifier || initializerEval instanceof LambdaIdentifier) {
                const functionInterface = initializerEval.functionInterface;
                const functionType = functionInterface.type;
                javaContext.functionInterface.set(functionType, functionInterface);
                this.addImport(`${config.java.package}.FunctionInterface.${functionType}`);
            }
        }
        variableIdentifier.type = type;
        printer.write('\0;');
    }

    VariableDeclarationList(astNode, printer) {
        for (let declaration of astNode.declarations) {
            this.VariableDeclaration(declaration, printer);
        }
    }

    FunctionDeclaration(astNode, printer) {
        const functionIdentifier = new FunctionIdentifier(printer.level);
        astNode.eval = functionIdentifier;
        printer.write(functionIdentifier);

        functionIdentifier.module = this.classFullName;

        const methodName = astNode.name.escapedText;

        // accessor
        if (isTopNode(astNode)) {
            functionIdentifier.accessor = 'private';
            const modifiers = astNode.modifiers;
            if (modifiers && modifiers[0].kind === typescript.SyntaxKind.ExportKeyword) {
                functionIdentifier.accessor = 'public';
                functionIdentifier.isStatic = true;
            }
            this.exports[methodName] = functionIdentifier;
        }
        // returnType
        const returnType = this.EvalReturnType(astNode.type);
        functionIdentifier.returnType = returnType.expression;
        functionIdentifier.returnTypeModule = returnType.module;
        // methodName
        functionIdentifier.identifier = methodName;
        // parameter
        this.FunctionParameter(astNode, functionIdentifier);
        // function body
        functionIdentifier.write('{');
        functionIdentifier.enterClosure();
        this.Block(astNode.body, functionIdentifier);
        functionIdentifier.exitClosure();
        functionIdentifier.writeln('}');
    }

    ClassDeclaration(astNode, printer) {
        const className = astNode.name.escapedText;
        if (isTopNode(astNode) && this.className === className) {
            this.ClassMember(astNode.members, printer);
            return;
        }
        const classIdentifier = new ClassIdentifier(printer.level);
        astNode.eval = classIdentifier;
        printer.write(classIdentifier);

        classIdentifier.module = this.classFullName;

        classIdentifier.type = className;
        classIdentifier.identifier = className;

        for (let modifier of astNode.modifiers) {
            switch (modifier.kind) {
                case typescript.SyntaxKind.ExportKeyword:
                    classIdentifier.accessor = 'public';
                    break;
                case typescript.SyntaxKind.DefaultKeyword:
                    classIdentifier.isStatic = true;
                    break;
            }
        }

        classIdentifier.write(' {');
        classIdentifier.enterClosure();
        classIdentifier.writeln();
        this.ClassMember(astNode.members, printer);
        classIdentifier.exitClosure();
        classIdentifier.writeln('\0}');
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
    type;
    // 260 Variable, 262 Function, 263 Class, 264 Interface, 267 Module
    kind;

    get expression() {
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

    get expression() {
        return `${toModuleName(this.module)}::${this.identifier}`;
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
        if (returnType instanceof JavaIdentifier) {
            returnType = returnType.type;
        }
        code += `${returnType} ${this.identifier}(${this.parameters})${super.toString()}`;
        return code;
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

    get expression() {
        return this.toString();
    }

    toString() {
        return `(${this.parameters}) -> ${super.toString()}`;
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

    rawType = '';

    constructor(level) {
        super(level);
        this.kind = typescript.SyntaxKind.VariableDeclaration;
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
            type = type();
        } else {
            type = type.toString();
        }
        code += `${type} ${this.identifier}${super.toString()}`;
        return code;
    }
}

class ClassIdentifier extends JavaIdentifier {
    accessor = null;// private | public
    isStatic = false;

    modifier = null;// final
    constructor(level) {
        super(level);
        this.kind = typescript.SyntaxKind.ClassDeclaration;
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
        code += `class ${this.identifier}${super.toString()}`;
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
    isFull = false;

    get type() {
        return this.declaration.type;
    }

    get kind() {
        return this.declaration.kind;
    }

    get expression() {
        let code = this.isFull ? this.module : toModuleName(this.module);
        const declaration = this.declaration;
        switch (declaration.kind) {
            case typescript.SyntaxKind.FunctionDeclaration:
                code += '::' + this.identifier;
                break;
            case typescript.SyntaxKind.ModuleDeclaration:
                code += '';
                break;
            case typescript.SyntaxKind.VariableDeclaration:
            case typescript.SyntaxKind.ClassDeclaration:
                code += '.' + this.identifier;
                break;
        }
        return code;
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

    #parser;

    addImport(classFullName) {
        const moduleName = toModuleName(classFullName);
        const modulePackage = toModulePackage(classFullName);

        if (moduleName === this.packageName) return true;

        let hasLoad = false;
        let conflict = false;
        for (let item of this.imports) {
            if (item === classFullName) hasLoad = true;
            if (moduleName === toModuleName(item)) {
                conflict = true;
                break;
            }
        }
        if (!conflict) {
            this.imports.push(classFullName);
        }
        return hasLoad;
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
        let code = 'Function';
        for (let parameter of this.parameters) {
            code += parameter.replace('...', 'Dot');
        }
        code += `Return${toClassName(this.returnType)}`;
        this.#type = code;
        return this.#type;
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

        const transpileOutput = typescript.transpileModule(contents, {
            compilerOptions: {
                sourceMap: true, target: typescript.ScriptTarget.Latest
            }, fileName: id, transformers: {
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
        })

        return {
            code: transpileOutput.outputText, //moduleSideEffects: 'no-treeshake',
            map: transpileOutput.sourceMapText
        };
    }
    basePlugin.buildEnd = function (error) {
        if (error) return;
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

        for (let i = javaContext.modules.size - 1; i >= 0; i--) {
            const { _, value } = javaContext.modules.at(i);
            value.outputFile();
        }

    }
    return basePlugin;
}

