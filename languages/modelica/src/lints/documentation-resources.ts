// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * @module lints/documentation-resources
 *
 * CST-level linter rules for Modelica library documentation hygiene, description strings,
 * external resource tracking, and URI validation in linear memory.
 */

import type { CodeGraph, CompilerLint, u32 } from "@modelscript/dsl";
import { hasTypePrefix, isElementProtected } from "./helpers.js";

interface DocResourceGrammarSymbols {
  component_clause?: u32 | undefined;
  component_clause1?: u32 | undefined;
  description_string?: u32 | undefined;
  [key: string]: u32 | undefined;
}

/**
 * Compiler lint rules for Modelica documentation, icons, and resource paths.
 */
export const modelicaDocResourceLints: Record<string, CompilerLint> = {
  /**
   * M4130: Class declaration is missing a description string.
   */
  classMissingDescription: {
    nodes: ["long_class_specifier"],
    severity: "warning",
    code: 4130,
    message: (target) => {
      const parts = target.text.split(" ");
      const name = parts.length > 0 && parts[0] ? parts[0] : target.text;
      return "Class '" + name + "' is missing a description string.";
    },
    query: (db: CodeGraph, node: u32) => {
      const nameNode = db.ast.getChildByFieldId(node, "name");
      if (nameNode == 0) return;

      const descNode = db.ast.getChildByFieldId(node, "description");
      let hasDesc = false;
      if (descNode != 0) {
        if (!db.ast.textEquals(descNode, "") && !db.ast.textEquals(descNode, '""')) {
          hasDesc = true;
        }
      }

      if (!hasDesc) {
        db.diagnostic(nameNode);
      }
    },
  },

  /**
   * M4131: Public parameter declaration is missing a description string.
   */
  parameterMissingDescription: {
    nodes: ["component_declaration"],
    severity: "warning",
    code: 4131,
    message: (target) => {
      const parts = target.text.split(" ");
      const name = parts.length > 0 && parts[0] ? parts[0] : target.text;
      return "Public parameter '" + name + "' is missing a description string.";
    },
    query: (db: CodeGraph, node: u32, $: DocResourceGrammarSymbols) => {
      let compClause: u32 = 0;
      for (const anc of db.ast.getAncestors(node, 0)) {
        const t = db.ast.getType(anc);
        if (t == $.component_clause || t == $.component_clause1) {
          compClause = anc;
          break;
        }
      }
      if (compClause == 0) return;

      if (!hasTypePrefix(db, compClause, "parameter", $)) return;
      if (isElementProtected(db, node, $)) return;

      const descNode = db.ast.getChildByFieldId(node, "description");
      let hasDesc = false;
      if (descNode != 0 && $.description_string != 0) {
        for (const sc of db.ast.getDescendants(descNode, $.description_string)) {
          if (!db.ast.textEquals(sc, "") && !db.ast.textEquals(sc, '""')) {
            hasDesc = true;
            break;
          }
        }
      }

      if (!hasDesc) {
        db.diagnostic(node);
      }
    },
  },

  /**
   * M4132: Public constant declaration is missing a description string.
   */
  constantMissingDescription: {
    nodes: ["component_declaration"],
    severity: "info",
    code: 4132,
    message: (target) => {
      const parts = target.text.split(" ");
      const name = parts.length > 0 && parts[0] ? parts[0] : target.text;
      return "Public constant '" + name + "' is missing a description string.";
    },
    query: (db: CodeGraph, node: u32, $: DocResourceGrammarSymbols) => {
      let compClause: u32 = 0;
      for (const anc of db.ast.getAncestors(node, 0)) {
        const t = db.ast.getType(anc);
        if (t == $.component_clause || t == $.component_clause1) {
          compClause = anc;
          break;
        }
      }
      if (compClause == 0) return;

      if (!hasTypePrefix(db, compClause, "constant", $)) return;
      if (isElementProtected(db, node, $)) return;

      const descNode = db.ast.getChildByFieldId(node, "description");
      let hasDesc = false;
      if (descNode != 0 && $.description_string != 0) {
        for (const sc of db.ast.getDescendants(descNode, $.description_string)) {
          if (!db.ast.textEquals(sc, "") && !db.ast.textEquals(sc, '""')) {
            hasDesc = true;
            break;
          }
        }
      }

      if (!hasDesc) {
        db.diagnostic(node);
      }
    },
  },

  /**
   * M4136: Resource reference uses an absolute filesystem path.
   */
  resourceAbsolutePath: {
    nodes: ["string_literal"],
    severity: "warning",
    code: 4136,
    message: (target) => {
      return (
        "Resource reference '" +
        target.text +
        "' uses an absolute filesystem path; use a relative path or 'modelica://' URI instead."
      );
    },
    query: (db: CodeGraph, node: u32) => {
      if (
        db.ast.startsWith(node, '"C:') ||
        db.ast.startsWith(node, '"c:') ||
        db.ast.startsWith(node, '"D:') ||
        db.ast.startsWith(node, '"d:') ||
        db.ast.startsWith(node, '"/home/') ||
        db.ast.startsWith(node, '"/usr/') ||
        db.ast.startsWith(node, '"/opt/') ||
        db.ast.startsWith(node, '"/var/')
      ) {
        db.diagnostic(node);
      }
    },
  },

  /**
   * M4134: Broken modelica:// URI reference in documentation or annotations.
   */
  brokenModelicaUri: {
    nodes: ["string_literal"],
    severity: "error",
    code: 4134,
    message: (target) => {
      return "Broken 'modelica://' reference: '" + target.text + "' does not resolve to an existing class or model.";
    },
    query: (db: CodeGraph, node: u32) => {
      if (db.ast.startsWith(node, '"modelica://') || db.ast.startsWith(node, "modelica://")) {
        if (db.ast.textEquals(node, '"modelica://"') || db.ast.textEquals(node, '"modelica:///"')) {
          db.diagnostic(node);
        }
      }
    },
  },
};
