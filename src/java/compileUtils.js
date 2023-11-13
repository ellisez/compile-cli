const {
    InterfaceDeclaration,
    MethodDeclaration,
    ParameterDeclaration,
    ClassDeclaration,
    ASTNode,
    Block,
    Identifier,
    PropertyAccessExpression,
} = require("./ast.js");
const {
    Type,
} = require('./type.js');

module.exports = class CompileUtils {
    project;

    constructor(project) {
        this.project = project;
    }

    loadFunctionType(functionType, module) {
        const typeName = functionType.typeName;

        const project = module.project;
        const fullName = `${config.java.package}.FunctionInterface`;
        const functionModule = project.moduleMap.get(fullName);

        if (!functionModule.members.has(typeName)) {
            const functionInterface = new InterfaceDeclaration(functionModule, typeName);
            const callMethod = new MethodDeclaration(functionInterface, 'call');
            callMethod.initialReturnType = functionType.returnType;
            callMethod.inferType = functionType;

            for (let [index, parameterType] of functionType.parameters.entries()) {
                const parameterDeclaration = new ParameterDeclaration(functionInterface);
                parameterDeclaration.name = `param${index + 1}`;
                parameterDeclaration.inferType = parameterType;
                callMethod.addParameter(parameterDeclaration);
            }
            functionInterface.addMember(callMethod);

            functionModule.addMember(functionInterface);
        }
        const importFunction = `${fullName}.${typeName}`;
        module.imports.add(importFunction);
        return functionType;
    }

    getClassFromNode(javaNode) {
        if (!javaNode) return;
        if (javaNode instanceof ClassDeclaration) {
            return javaNode;
        }
        return this.getClassFromNode(javaNode.parent);
    }

    getClosureFromNode(javaNode) {
        if (!javaNode) return undefined;
        if (javaNode.closure) return javaNode.closure;
        if (javaNode.parent) return this.getClosureFromNode(javaNode.parent);
        return undefined;
    }

    getVariable(closure, name) {
        if (closure instanceof ASTNode) {
            closure = this.getClosureFromNode(closure);
        }
        if (closure.has(name)) {
            return closure.variables.get(name);
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
            closure.variables.set(name, declaration);
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
        closure.variables.set(name, declaration);
    }

    getBlockFromNode(javaNode) {
        if (!javaNode) return;
        if (javaNode instanceof Block) {
            return javaNode;
        }
        return this.getBlockFromNode(javaNode.parent);
    }

    /// accessExpression: Identifier | PropertyAccessExpression
    equalsNamedEntity(code, javaNode) {
        let chain = code;
        if (typeof code === 'string') {
            chain = code.split('.');
        }
        if (chain.length === 1 && javaNode instanceof Identifier && javaNode.text === code) {
            return true;
        }
        if (javaNode instanceof PropertyAccessExpression) {
            if (javaNode.name.text === chain.pop()) {
                return this.equalsNamedEntity(chain, javaNode.expression);
            }
        }
        return false;
    }

    /// accessExpression: Identifier | PropertyAccessExpression
    createNamedEntity(code, javaNode) {
        let chain = code;
        if (typeof code === 'string') {
            chain = code.split('.');
        }
        if (chain.length === 1) {
            return new Identifier(javaNode, code, javaNode.pos, javaNode.end);
        }
        const propertyAccessExpression = new PropertyAccessExpression(javaNode, javaNode.pos, javaNode.end);
        propertyAccessExpression.name = new Identifier(propertyAccessExpression, chain.pop());
        propertyAccessExpression.expression = this.createNamedEntity(chain, propertyAccessExpression);
        return propertyAccessExpression;
    }

    /// accessExpression: Identifier | PropertyAccessExpression
    replaceNamedEntity(code, javaNode) {
        const expression = this.createNamedEntity(code);
        if (!expression) return;

        javaNode.replaceWith(expression);
    }


}
