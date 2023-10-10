"use strict";
/* eslint-disable */
module.exports = {
  meta: {
    type: 'problem',
    docs: {
      description: 'Require explicit numerical types such as int, double.',
      recommended: 'recommended',
      url: null,
    },
    hasSuggestions: true,
    messages: {
      numberType: 'Require explicit numerical types.',
      useInt: 'use int.',
      useDouble: 'use double.'
    },
    fixable: 'code',
    schema: [],
  },

  create(context) {
    return {
      'TSNumberKeyword'(node) {
        context.report({
          node,
          messageId: 'numberType',
          suggest: [
            {
              messageId: 'useDouble',
              fix: (fixer) => fixer.replaceText(node, 'double'),
            },
            {
              messageId: 'useInt',
              fix: (fixer) => fixer.replaceText(node, 'int'),
            }
          ]
        });
      }
    };
  },
};
