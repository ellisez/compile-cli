const ts = require('typescript');

class TSUtils {
    tsProgram;

    constructor(tsProgram) {
        this.tsProgram = tsProgram;
    }

    parseModifiers(tsNode) {
        const modifiers = tsNode.modifiers;
        if (!modifiers) return {};
        const result = {};
        result.isDeclare = false;
        result.isExport = false;
        result.isDefault = false;
        for (let modifier of modifiers) {
            switch (modifier.kind) {
                case ts.SyntaxKind.DeclareKeyword:
                    result.isDeclare = true;
                    break;
                case ts.SyntaxKind.ExportKeyword:
                    result.accessor = 'public';
                    result.isExport = true;
                    result.isStatic = true;
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
        return typeChecker.getTypeAtLocation(tsNode);
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
                // return '===';
                return '==';
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

    /// Identifier | PropertyAccessExpression
    equalsExpression(code, tsNode) {
        let chain = code;
        if (typeof code === 'string') {
            chain = code.split('.');
        }
        if (chain.length === 1 && tsNode.kind === ts.SyntaxKind.Identifier && tsNode.escapedText === code) {
            return true;
        }
        if (tsNode.kind === ts.SyntaxKind.PropertyAccessExpression) {
            if (tsNode.name.escapedText === chain.pop()) {
                return this.equalsExpression(chain, tsNode.expression);
            }
        }
        return false;
    }

    /// Identifier | PropertyAccessExpression
    executeExpression(code) {
        let chain = code;
        if (typeof code === 'string') {
            chain = code.split('.');
        }
        if (chain.length === 1) {
            return ts.createIdentifier(code);
        }
        const name = ts.createIdentifier(chain.pop());
        const expression = this.executeExpression(chain);
        return ts.createPropertyAccessExpression(expression, name);
    }

    /// Identifier | PropertyAccessExpression
    replaceByExpression(code, tsNode) {
        const expression = this.createAccessExpression(code);
        if (!expression) return;

        const parent = tsNode.parent;
        let name, exp, argumentsArray;
        switch (parent.kind) {
            case ts.SyntaxKind.CallExpression:
                exp = parent.expression;
                if (exp === tsNode) {
                    exp = expression;
                }
                argumentsArray = parent.argumentsArray;
                for (let i=0; i<argumentsArray.length; i++) {
                    let argument = argumentsArray[i];
                    if (argument === tsNode) {
                        argumentsArray[i] = expression;
                    }
                }
                ts.updateCallExpression(parent, exp, parent.typeArguments, argumentsArray);
                break;
            case ts.SyntaxKind.ParameterDeclaration:
                name = parent.name;
                let initializer = parent.initializer;
                if (name === tsNode) {
                    name = expression;
                } else if (initializer === tsNode) {
                    initializer = expression;
                }
                ts.updateParameterDeclaration(parent, parent.modifiers, parent.dotDotDotToken, name, parent.questionToken, parent.type, initializer);
                break;
            case ts.SyntaxKind.TypeParameterDeclaration:
                name = parent.name;
                let constraint = parent.constraint;
                if (name === tsNode) {
                    name = expression;
                } else if (constraint === tsNode) {
                    constraint = expression;
                }
                ts.updateTypeParameterDeclaration(parent, parent.modifiers, name, constraint, parent.defaultType);
                break;
            case ts.SyntaxKind.TypeReference:
                ts.updateTypeReferenceNode(parent, expression, parent.typeArguments);
                break;
            case ts.SyntaxKind.NewExpression:
                exp = parent.expression;
                if (exp === tsNode) {
                    exp = expression;
                }
                argumentsArray = parent.argumentsArray;
                for (let i=0; i<argumentsArray.length; i++) {
                    let argument = argumentsArray[i];
                    if (argument === tsNode) {
                        argumentsArray[i] = expression;
                    }
                }
                ts.updateNewExpression(parent, exp, parent.typeArguments, argumentsArray);
                break;
            case ts.SyntaxKind.BinaryExpression:
                let left = parent.left;
                let right = parent.right;
                if (left === tsNode) {
                    left = expression;
                } else if (right === tsNode) {
                    right = expression;
                }
                ts.updateBinaryExpression(parent, left, parent.operator, right);
                break;
            case ts.SyntaxKind.ReturnStatement:
                ts.updateReturnStatement(parent, expression);
                break;
            case ts.SyntaxKind.IfStatement:
                ts.updateIfStatement(parent, expression, parent.thenStatement, parent.elseStatement);
                break;
            case ts.SyntaxKind.VariableDeclaration:
                ts.updateVariableDeclaration(parent, parent.name, parent.exclamationToken, parent.type, expression);
                break;
            case ts.SyntaxKind.PropertyDeclaration:
                ts.updatePropertyDeclaration(parent, parent.modifiers, parent.name, parent.questionOrExclamationToken, parent.type, expression);
                break;
            case ts.SyntaxKind.ExportAssignment:
                ts.updateExportAssignment(parent, parent.modifiers, expression);
                break;
            case ts.SyntaxKind.SwitchStatement:
                ts.updateSwitchStatement(parent, expression, parent.caseBlock);
                break;
            case ts.SyntaxKind.CaseClause:
                ts.updateCaseClause(parent, expression, parent.statements);
                break;
            case ts.SyntaxKind.PrefixUnaryExpression:
                ts.updatePrefixUnaryExpression(parent, expression);
                break;
            case ts.SyntaxKind.PostfixUnaryExpression:
                ts.updatePostfixUnaryExpression(parent, expression);
                break;
            case ts.SyntaxKind.ForStatement:
                ts.updateForStatement(parent, parent.initializer, expression, parent.incrementor, parent.statement);
                break;
            case ts.SyntaxKind.ForInStatement:
                ts.updateForInStatement(parent, parent.initializer, expression, parent.statement);
                break;
            case ts.SyntaxKind.ForOfStatement:
                ts.updateForOfStatement(parent, parent.awaitModifier, parent.initializer, expression, parent.statement);
                break;
            case ts.SyntaxKind.WhileStatement:
                ts.SyntaxKind.updateWhileStatement(parent, expression, parent.statement);
                break;
            case ts.SyntaxKind.ConditionalExpression:
                let condition = parent.condition;
                let whenTrue = parent.whenTrue;
                let whenFalse = parent.whenFalse;
                if (condition === tsNode) {
                    condition = expression;
                } else if (whenTrue === tsNode) {
                    whenTrue = expression;
                } else if (whenFalse === tsNode) {
                    whenFalse = expression;
                }
                ts.updateConditionalExpression(parent, condition, parent.questionToken, whenTrue, parent.colonToken, whenFalse);
                break;
            case ts.SyntaxKind.PropertyAccessExpression:
                name = parent.name;
                if (name === tsNode) {
                    name = expression
                }
                exp = parent.expression;
                if (exp === tsNode) {
                    exp = expression;
                }
                ts.updatePropertyAccessExpression(parent, exp, name);
                break;
            case ts.SyntaxKind.ElementAccessExpression:
                exp = parent.expression;
                let argumentExpression = parent.argumentExpression;
                if (exp === tsNode) {
                    exp = expression;
                } else if (argumentExpression === tsNode) {
                    argumentExpression = expression;
                }
                ts.updateElementAccessExpression(parent, exp, argumentExpression);
                break;
            default:
                break;
        }
    }

    ///
    equalsType(code) {
        let chain = code;
        if (typeof code === 'string') {
            chain = code.split('.');
        }
        if (chain.length === 1) {
            return ts.createIdentifier(code);
        }
    }
}
module.exports = TSUtils;
