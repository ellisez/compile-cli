import path from "node:path";
/**
 * @fileoverview number type inexplicit
 * @author ellis
 */
"use strict";
/* eslint-disable */


const rule = require("../../../lib/rules/explicit-number-type");
const { RuleTester } = require("eslint");

const parser = path.resolve("../../../node_modules/@typescript-eslint/parser/dist/index.js");

const ruleTester = new RuleTester({
  parser,
  parserOptions: { ecmaVersion: 2018 }
});
ruleTester.run("explicit-number-type", rule, {
  valid: [
    {
      code: "let a: int = 1",
    }
  ],

  invalid: [
    {
      code: "let a: number = 1",
      errors: [{ message: "Require explicit numerical types." }],
    },
  ],
});
