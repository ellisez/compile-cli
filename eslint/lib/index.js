"use strict";
/* eslint-disable */
const requireIndex = require("requireindex");

// import all rules in lib/rules
module.exports = {
    configs: requireIndex(__dirname + "/configs"),
    rules: requireIndex(__dirname + "/rules"),
}



