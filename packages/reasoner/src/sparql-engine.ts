// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * SPARQL-DL Query Engine
 *
 * Provides a simple query DSL for engineering-domain ontology queries
 * executed against the IOWLReasoner. This is NOT a full SPARQL engine —
 * it covers the subset of SPARQL-DL patterns needed for ModelScript:
 *
 * - Instance retrieval: "which components are of type ElectricalDevice?"
 * - Subsumption queries: "what is the domain hierarchy of this connector?"
 * - Property queries: "what is connected to componentA?"
 * - Reachability: "trace fault propagation from sensorX"
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

import type { DLQuery, DLQueryResult, IOWLReasoner } from "./reasoner.js";

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
 */
export function parseDLQuery(queryString: string): DLQuery | null {
  const trimmed = queryString.trim();

  // Match pattern: type(iri) or type(iri, fromIri)
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
  ];

  if (!validTypes.includes(type)) return null;

  const iri = args[0];
  if (!iri) return null;
  const fromIri = args[1]; // Only for "reachable" queries

  return { type, iri, fromIri };
}

// ---------------------------------------------------------------------------
// Query Executor
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// Batch Query Support
// ---------------------------------------------------------------------------

/**
 * Execute multiple queries and return all results.
 * Useful for MCP tool implementations that need multiple query results.
 */
export function executeBatchQueries(reasoner: IOWLReasoner, queries: readonly DLQuery[]): DLQueryResult[] {
  return queries.map((q) => executeDLQuery(reasoner, q));
}

// ---------------------------------------------------------------------------
// Query Result Formatting
// ---------------------------------------------------------------------------

/**
 * Format a DL query result as a human-readable string.
 * Used for CLI output and MCP tool responses.
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
