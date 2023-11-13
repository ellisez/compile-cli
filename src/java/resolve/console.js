const { PropertyAccessExpression, ParameterDeclaration, Identifier } = require("../ast");
const { getType, FunctionType } = require("../type");

module.exports = {
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

            const systemIdentifier = new Identifier(outAccess, name.pos, name.end);
            systemIdentifier.text = 'System';
            systemIdentifier.inferType = 'System';

            outAccess.expression = systemIdentifier;

            return systemAccess;
        }
    },
}
