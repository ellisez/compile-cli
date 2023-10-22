const plugin = require("../plugin.js");
const Parser = require('./parse.js');


module.exports = function (serviceOptions) {
    const basePlugin = plugin(serviceOptions);

    const tsOptions = basePlugin.tsOptions;


    const parser = new Parser(tsOptions);
    parser.parse();
    // let moduleResolution = compilerOptions.moduleResolution;
    // compilerOptions.moduleResolution = ts.ModuleResolutionKind[moduleResolution];
    //
    // const program = ts.createProgram([entryFile], compilerOptions);
    //
    // function visitNode(node) {
    //     if (node.kind === ts.SyntaxKind.TypeReference) {
    //         const type = typeChecker.getTypeFromTypeNode(node);
    //         typeChecker.typeToString(type);
    //         debugger;
    //     }
    //
    //     node.forEachChild(child =>
    //         visitNode(child)
    //     );
    // }
    //
    // const typeChecker = program.getTypeChecker();
    // for (const sourceFile of program.getSourceFiles()) {
    //     visitNode(sourceFile);
    // }

    /*

    return {
        ...basePlugin,
        //////////////
        name = 'java-plugin',
        transform(contents, id) {
            const program = typescript.createProgram(include, compilerOptions);

            parser.parse(contents, id);

            const tsOptions = {
                ...tsOptions,
                fileName: id,
                transformers: {
                    before: [
                        function Transformer(compileContext) {
                            return function Visitor(sourceFile) {
                                const parser = new Parser({
                                    pluginContext,
                                    serviceOptions,
                                    pluginObject: basePlugin,
                                    compileContext,
                                });
                                parser.parse(sourceFile);
                                return sourceFile;
                            }
                        },
                    ]
                }
            };

            const transpileOutput = typescript.transpileModule(contents, tsOptions)

            return {
                code: transpileOutput.outputText, //moduleSideEffects: 'no-treeshake',
                map: transpileOutput.sourceMapText
            };
        }
    };



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

            let constCode = '';
            let bodyCode = '';

            printer.writeln(() => constCode);

            printer.writeln('public interface FunctionInterface {');
            let constSet = new Set();
            for (let [interfaceName, functionInterface] of javaContext.functionInterface) {
                for (const constItem of functionInterface.consts) {
                    if (constSet.has(constItem)) continue;
                    constSet.add(constItem);
                    constCode += `const ${constItem};\n`;
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
    */
}

