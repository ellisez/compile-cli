const ts = require("typescript");
const { toCamel } = require("./utils");


let ast;

class CompileUtils {
    program;
    constructor(program) {
        ast = require('./ast.js');
        this.program = program;
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

        const typeChecker = this.program.getTypeChecker();
        const type = typeChecker.getTypeAtLocation(tsNode);
        const typeToString = typeChecker.typeToString(type);
        return javaType(typeToString);
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
        const ClassName = getFunctionType(javaNode);
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
        return getClassFromNode(javaNode.parent);
    }

    getClosureFromNode(node) {
        if (node.closure) return node.closure;
        if (node.parent) return getClosureFromNode(node.parent);
        return undefined;
    }

    getVariable(closure, name) {
        if (closure instanceof ASTNode) {
            closure = getClosureFromNode(closure);
        }
        if (closure.has(name)) {
            return closure._variables[name];
        }
        if (!closure.isTop()) {
            const parent = closure.parent;
            return getVariable(parent, name);
        }
    }

    setVariable(closure, name, declaration) {
        if (closure instanceof ASTNode) {
            closure = getClosureFromNode(closure);
        }
        if (closure.has(name)) {
            closure._variables[name] = declaration;
        }
        if (!closure.isTop()) {
            const parent = closure.parent;
            setVariable(parent, name, declaration);
        }
    }

    newVariable(closure, name, declaration) {
        if (!closure) return;
        if (closure instanceof ASTNode) {
            closure = getClosureFromNode(closure);
        }
        closure._variables[name] = declaration;
    }

    getBlockFromNode(javaNode) {
        if (!javaNode) return;
        if (javaNode instanceof Block) {
            return javaNode;
        }
        return getBlockFromNode(javaNode.parent);
    }
}

module.exports = CompileUtils;
