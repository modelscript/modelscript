// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * SPARQL-DL Query Engine
 *
 * Provides a query DSL for engineering-domain ontology queries
 * executed against an IOWLReasoner.
 *
 * ## Query Syntax (string-based)
 *
 * ```
 * instances(mo:ElectricalDevice)
 * subclasses(mo:Connector)
 * superclasses(mo:Motor)
 * equivalents(mo:TwoPin)
 * disjoint(mo:ElectricalDomain)
 * property-values(mo:isConnectedTo)
 * reachable(mo:isConnectedTo, mo:sensorX)
 * ```
 */

import type { BgpQuery, BgpQueryResult, DLQuery, DLQueryResult, IOWLReasoner, PropertyPathOp } from "./types.js";

// ---------------------------------------------------------------------------
// Property Path Parser
// ---------------------------------------------------------------------------

/**
 * Parses a SPARQL 1.1 property path string expression into an operator and components.
 * Supports: `prop+`, `prop*`, `^prop`, `^prop+`, `prop1 / prop2`, `prop1 | prop2`.
 */
export function parsePropertyPathExpression(expr: string): {
  iri: string;
  pathOp: PropertyPathOp;
  stepPropertyIri2?: string;
} {
  const trimmed = expr.trim();

  // Sequence: prop1 / prop2
  if (trimmed.includes("/")) {
    const parts = trimmed.split("/").map((s) => s.trim());
    return {
      iri: parts[0] || trimmed,
      pathOp: "sequence",
      stepPropertyIri2: parts[1] || "",
    };
  }

  // Alternation: prop1 | prop2
  if (trimmed.includes("|")) {
    const parts = trimmed.split("|").map((s) => s.trim());
    return {
      iri: parts[0] || trimmed,
      pathOp: "alternation",
      stepPropertyIri2: parts[1] || "",
    };
  }

  // Inverse plus: ^prop+
  if (trimmed.startsWith("^") && trimmed.endsWith("+")) {
    return {
      iri: trimmed.slice(1, -1).trim(),
      pathOp: "inverse-plus",
    };
  }

  // Inverse: ^prop
  if (trimmed.startsWith("^")) {
    return {
      iri: trimmed.slice(1).trim(),
      pathOp: "inverse",
    };
  }

  // Plus: prop+
  if (trimmed.endsWith("+")) {
    return {
      iri: trimmed.slice(0, -1).trim(),
      pathOp: "plus",
    };
  }

  // Star: prop*
  if (trimmed.endsWith("*")) {
    return {
      iri: trimmed.slice(0, -1).trim(),
      pathOp: "star",
    };
  }

  // Direct: prop
  return {
    iri: trimmed,
    pathOp: "direct",
  };
}

// ---------------------------------------------------------------------------
// Query Parser
// ---------------------------------------------------------------------------

/**
 * Parse a string query into a DLQuery object.
 *
 * Supported syntax:
 * - `instances(<iri>)`
 * - `subclasses(<iri>)`
 * - `superclasses(<iri>)`
 * - `equivalents(<iri>)`
 * - `disjoint(<iri>)`
 * - `property-values(<iri>)`
 * - `reachable(<propertyIri>, <fromIri>)`
 * - `path(<pathExpression>, <fromIri>)`
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
 * Execute a parsed DL query against a reasoner instance.
 */
export function executeDLQuery(reasoner: IOWLReasoner, query: DLQuery): DLQueryResult {
  return reasoner.query(query);
}

/**
 * Execute a string-based DL query against a reasoner.
 * Returns null if the query string cannot be parsed.
 */
export function executeQueryString(reasoner: IOWLReasoner, queryString: string): DLQueryResult | null {
  const query = parseDLQuery(queryString);
  if (!query) return null;
  return executeDLQuery(reasoner, query);
}

/**
 * Execute a Basic Graph Pattern (BGP) query using Leapfrog Triejoin (WCOJ).
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

// ---------------------------------------------------------------------------
// Batch Query Support
// ---------------------------------------------------------------------------

/**
 * Execute multiple queries and return all results.
 */
export function executeBatchQueries(reasoner: IOWLReasoner, queries: readonly DLQuery[]): DLQueryResult[] {
  return queries.map((q) => executeDLQuery(reasoner, q));
}

// ---------------------------------------------------------------------------
// Query Result Formatting
// ---------------------------------------------------------------------------

/**
 * Format a DL query result as a human-readable string.
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
 * Format a BGP query result as a human-readable table string.
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
