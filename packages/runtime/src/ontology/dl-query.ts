// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * SPARQL 1.1 Property Path Parser and DL / BGP Query Helpers.
 */

import type { BgpQuery, BgpQueryResult, DLQuery, DLQueryResult, IOWLReasoner, PropertyPathOp } from "./owl2-types.js";

// // ---------------------------------------------------------------------------
// SPARQL 1.1 Property Path Parser & DSL Query Helpers
// ---------------------------------------------------------------------------

/** Splits `expr` by single-character `delim` only outside `<...>` full IRI brackets. */
function splitOutsideAngleBrackets(expr: string, delim: string): string[] {
  const parts: string[] = [];
  let inAngle = false;
  let start = 0;
  for (let i = 0; i < expr.length; i++) {
    const ch = expr[i]!;
    if (ch === "<") {
      inAngle = true;
    } else if (ch === ">") {
      inAngle = false;
    } else if (ch === delim && !inAngle) {
      parts.push(expr.slice(start, i).trim());
      start = i + 1;
    }
  }
  parts.push(expr.slice(start).trim());
  return parts;
}

/**
 * Parses a SPARQL 1.1 property path expression into an IRI, path operator, and optional second step IRI.
 */
export function parsePropertyPathExpression(expr: string): {
  iri: string;
  pathOp: PropertyPathOp;
  stepPropertyIri2?: string | undefined;
} {
  const trimmed = expr.trim();

  const seqParts = splitOutsideAngleBrackets(trimmed, "/");
  if (seqParts.length > 1) {
    return {
      iri: seqParts[0] || trimmed,
      pathOp: "sequence",
      stepPropertyIri2: seqParts[1] || "",
    };
  }

  const altParts = splitOutsideAngleBrackets(trimmed, "|");
  if (altParts.length > 1) {
    return {
      iri: altParts[0] || trimmed,
      pathOp: "alternation",
      stepPropertyIri2: altParts[1] || "",
    };
  }

  if (trimmed.startsWith("^") && trimmed.endsWith("+")) {
    return {
      iri: trimmed.slice(1, -1).trim(),
      pathOp: "inverse-plus",
    };
  }

  if (trimmed.startsWith("^")) {
    return {
      iri: trimmed.slice(1).trim(),
      pathOp: "inverse",
    };
  }

  if (trimmed.endsWith("+")) {
    return {
      iri: trimmed.slice(0, -1).trim(),
      pathOp: "plus",
    };
  }

  if (trimmed.endsWith("*")) {
    return {
      iri: trimmed.slice(0, -1).trim(),
      pathOp: "star",
    };
  }

  return {
    iri: trimmed,
    pathOp: "direct",
  };
}

/**
 * Parses a textual DL query string (e.g., `subclasses(mo:Resistor)`) into a structured `DLQuery`.
 */
export function parseDLQuery(queryString: string): DLQuery | null {
  const trimmed = queryString.trim();

  const match = trimmed.match(/^(\w[\w-]*)\(([^)]+)\)$/);
  if (!match) return null;

  const type = match[1] as DLQuery["type"];
  const argsStr = match[2];
  if (!type || !argsStr) return null;
  const args = argsStr.split(",").map((s) => s.trim());

  const validTypes = [
    "instances",
    "subclasses",
    "superclasses",
    "equivalents",
    "disjoint",
    "property-values",
    "reachable",
    "path",
  ];

  if (!validTypes.includes(type)) return null;

  if (type === "path") {
    const rawPath = args[0];
    if (!rawPath) return null;
    const fromIri = args[1];
    const parsed = parsePropertyPathExpression(rawPath);
    return {
      type: "path",
      iri: parsed.iri,
      pathOp: parsed.pathOp,
      stepPropertyIri2: parsed.stepPropertyIri2,
      fromIri,
    };
  }

  const iri = args[0];
  if (!iri) return null;
  const fromIri = args[1];

  return { type, iri, fromIri };
}

/**
 * Executes a structured `DLQuery` against the given OWL 2 reasoner.
 */
export function executeDLQuery(reasoner: IOWLReasoner, query: DLQuery): DLQueryResult {
  return reasoner.query(query);
}

/**
 * Parses and executes a textual DL query string against the given OWL 2 reasoner.
 */
export function executeQueryString(reasoner: IOWLReasoner, queryString: string): DLQueryResult | null {
  const query = parseDLQuery(queryString);
  if (!query) return null;
  return executeDLQuery(reasoner, query);
}

/**
 * Executes a Basic Graph Pattern (BGP) conjunctive query against the given OWL 2 reasoner.
 */
export function executeBgpQuery(reasoner: IOWLReasoner, query: BgpQuery): BgpQueryResult {
  if (reasoner.queryBgp) {
    return reasoner.queryBgp(query);
  }
  return {
    variables: [],
    bindings: [],
    executionTimeMs: 0,
  };
}

/**
 * Executes a batch of DL queries sequentially against the given OWL 2 reasoner.
 */
export function executeBatchQueries(reasoner: IOWLReasoner, queries: readonly DLQuery[]): DLQueryResult[] {
  return queries.map((q) => executeDLQuery(reasoner, q));
}

/**
 * Formats a `DLQueryResult` as a human-readable multi-line string.
 */
export function formatQueryResult(result: DLQueryResult): string {
  const lines: string[] = [];

  lines.push(
    `Query: ${result.query.type}(${result.query.iri}${result.query.fromIri ? `, ${result.query.fromIri}` : ""})`,
  );
  lines.push(`Results: ${result.bindings.length} binding(s) in ${result.executionTimeMs.toFixed(2)}ms`);

  if (result.bindings.length > 0) {
    lines.push("");
    for (const binding of result.bindings) {
      lines.push(`  - ${binding}`);
    }
  }

  if (result.pairs && result.pairs.length > 0) {
    lines.push("");
    lines.push("Pairs:");
    for (const pair of result.pairs) {
      lines.push(`  ${pair.subject} → ${pair.object}`);
    }
  }

  return lines.join("\n");
}

/**
 * Formats a `BgpQueryResult` as a human-readable multi-line string.
 */
export function formatBgpQueryResult(result: BgpQueryResult): string {
  const lines: string[] = [];
  lines.push(`BGP Query Results: ${result.bindings.length} row(s) in ${result.executionTimeMs.toFixed(2)}ms`);
  lines.push(`Variables: ${result.variables.join(", ")}`);

  if (result.bindings.length > 0) {
    lines.push("");
    for (const row of result.bindings) {
      const entries = Object.entries(row)
        .map(([k, v]) => `${k}=${v}`)
        .join(", ");
      lines.push(`  { ${entries} }`);
    }
  }

  return lines.join("\n");
}
