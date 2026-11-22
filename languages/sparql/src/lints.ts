// SPDX-License-Identifier: AGPL-3.0-or-later

import { getChildren, getText, type GenericSyntaxNode } from "./ast.js";

export interface SparqlLintDiagnostic {
  readonly code: number;
  readonly rule: string;
  readonly severity: "error" | "warning" | "info";
  readonly message: string;
  readonly startOffset: number;
  readonly endOffset: number;
}

export interface SparqlLintOptions {
  /** Emit an error (S4001) when federated `SERVICE` clauses are present (default: false). */
  disallowService?: boolean | undefined;
}

/**
 * Runs static semantic lints over a parsed `@modelscript/sparql` WASM GLR CST:
 * - `S1001`: Syntax / parse error
 * - `S2001`: Undeclared prefix used in prefixed name
 * - `S2002`: Duplicate `PREFIX` declaration
 * - `S3001`: Projected `SELECT` variable not bound in `WHERE` clause
 * - `S4001`: Disallowed federated `SERVICE` clause
 */
export function lintSparqlDocument(
  rootNode: GenericSyntaxNode,
  sourceText?: string,
  options: SparqlLintOptions = {},
): SparqlLintDiagnostic[] {
  const diagnostics: SparqlLintDiagnostic[] = [];
  const spanOf = (n: GenericSyntaxNode) => ({
    startOffset: n.startOffset ?? n.startIndex ?? 0,
    endOffset: n.endOffset ?? n.endIndex ?? 0,
  });

  const declaredPrefixes = new Set<string>();
  const boundVars = new Set<string>();
  const projectedVars: Array<{ name: string; node: GenericSyntaxNode }> = [];

  const pass1 = (n: GenericSyntaxNode): void => {
    if (n.type === "ERROR" || n.isError) {
      diagnostics.push({
        code: 1001,
        rule: "parse-error",
        severity: "error",
        message: `SPARQL syntax error near '${getText(n, sourceText).slice(0, 32)}'.`,
        ...spanOf(n),
      });
    }
    if (n.type === "PrefixDecl") {
      const pNode = getChildren(n).find((c) => c.type === "PNAME_NS");
      if (pNode) {
        const pfx = getText(pNode, sourceText);
        if (declaredPrefixes.has(pfx)) {
          diagnostics.push({
            code: 2002,
            rule: "duplicate-prefix",
            severity: "warning",
            message: `Prefix '${pfx}' is declared more than once.`,
            ...spanOf(pNode),
          });
        }
        declaredPrefixes.add(pfx);
      }
      return;
    }
    if (n.type === "ServiceGraphPattern" && options.disallowService) {
      diagnostics.push({
        code: 4001,
        rule: "disallowed-service",
        severity: "error",
        message: "Federated SPARQL SERVICE clauses are not permitted.",
        ...spanOf(n),
      });
    }
    for (const c of getChildren(n)) pass1(c);
  };
  pass1(rootNode);

  const rootHasErr = typeof rootNode.hasError === "function" ? rootNode.hasError() : Boolean(rootNode.hasError);
  if (rootHasErr && !diagnostics.some((d) => d.code === 1001)) {
    diagnostics.push({
      code: 1001,
      rule: "parse-error",
      severity: "error",
      message: "SPARQL syntax error in query.",
      ...spanOf(rootNode),
    });
  }

  const pass2 = (n: GenericSyntaxNode, inWhere: boolean, inSelect: boolean): void => {
    if (n.type === "PNAME_LN") {
      const raw = getText(n, sourceText);
      const pfx = raw.slice(0, raw.indexOf(":") + 1);
      if (!declaredPrefixes.has(pfx)) {
        diagnostics.push({
          code: 2001,
          rule: "undeclared-prefix",
          severity: "error",
          message: `Undeclared prefix '${pfx}' in '${raw}'.`,
          ...spanOf(n),
        });
      }
    }
    if (n.type === "SelectProjection" && inSelect) {
      const ch = getChildren(n);
      const hasExpr = ch.some((c) => c.type === "Expression");
      const varNode = ch.find((c) => c.type === "VAR");
      if (!hasExpr && varNode) {
        projectedVars.push({ name: getText(varNode, sourceText).slice(1), node: varNode });
      }
    }
    if (n.type === "VAR" && inWhere) {
      boundVars.add(getText(n, sourceText).slice(1));
    }
    const nextInWhere = inWhere || n.type === "WhereClause" || n.type === "ValuesClause";
    const nextInSelect = (inSelect || n.type === "SelectClause") && n.type !== "WhereClause";
    for (const c of getChildren(n)) pass2(c, nextInWhere, nextInSelect);
  };
  pass2(rootNode, false, false);

  for (const pv of projectedVars) {
    if (!boundVars.has(pv.name)) {
      diagnostics.push({
        code: 3001,
        rule: "unbound-select-variable",
        severity: "warning",
        message: `Projected variable '?${pv.name}' is never bound in the WHERE clause.`,
        ...spanOf(pv.node),
      });
    }
  }

  return diagnostics;
}
