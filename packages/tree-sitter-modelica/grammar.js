/**
 * @file Modelica grammar for tree-sitter
 * @author Mohamad Omar Nachawati <mnachawa@gmail.com>
 * @license AGPL-3.0-or-later
 */

/// <reference types="tree-sitter-cli/dsl" />
// @ts-check

module.exports = grammar({
  name: "modelica",

  rules: {
    // TODO: add the actual grammar rules
    source_file: ($) => "hello",
  },
});
