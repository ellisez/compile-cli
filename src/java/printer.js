const { ASTNode } = require('./ast.js');

class PrintOptions {
    tabSpace = '  ';
    indent = '';
}
exports.PrintOptions = PrintOptions;

class Printer {
    #text = '';

    options;

    constructor(options) {
        this.options = options;
    }

    newLine() {
        return `\n${this.options.indent}`;
    }

    increaseIndent() {
        this.options.indent += this.options.tabSpace;
        return this.options.indent;
    }

    decreaseIndent() {
        this.options.indent = this.options.indent.slice(0, -this.options.tabSpace.length);
        return this.options.indent;
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
        const newLine = this.options.newLine();
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
            this.increaseIndent();
            const bodySegment = body.getText();
            if (body.statements.length) {
                this.writeln(bodySegment);
                this.decreaseIndent();
                this.writeln('}');
            } else {
                this.decreaseIndent();
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
exports.Printer = Printer;
