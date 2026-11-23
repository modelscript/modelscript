// SPDX-License-Identifier: AGPL-3.0-or-later

import type { ActionExecutionContext } from "@modelscript/dsl";
import type { OWL2Axiom } from "@modelscript/runtime";
import { getOwl2DiagramData, type OWL2DiagramData } from "./lsp-queries.js";
import { reasonOwl2Ontology, type Owl2ReasoningResult } from "./reasoner/tableau.js";
import { executeOwl2SparqlQuery } from "./sparql-kb.js";

function mapOfSetsToRecord(map: ReadonlyMap<string, ReadonlySet<string>>): Record<string, string[]> {
  const out: Record<string, string[]> = {};
  for (const [key, set] of map.entries()) {
    if (key.startsWith("__aux_")) continue;
    const items = Array.from(set).filter((v) => !v.startsWith("__aux_"));
    if (items.length > 0) {
      out[key] = items;
    }
  }
  return out;
}

function resolveStoreAxioms(ctx: ActionExecutionContext): OWL2Axiom[] | undefined {
  const wm = ctx?.workspaceManager as { unifiedWorkspace?: { owl2Store?: { axioms?: OWL2Axiom[] } } } | undefined;
  const axioms = wm?.unifiedWorkspace?.owl2Store?.axioms;
  return Array.isArray(axioms) && axioms.length > 0 ? axioms : undefined;
}

function runReasonerForContext(
  ctx: ActionExecutionContext,
  documentText?: string,
): { result: Owl2ReasoningResult } | { error: string } {
  const text = documentText ?? ctx?.documentText;
  if (typeof text === "string" && text.trim().length > 0) {
    return { result: reasonOwl2Ontology(text) };
  }
  const storeAxioms = resolveStoreAxioms(ctx);
  if (storeAxioms) {
    return { result: reasonOwl2Ontology(storeAxioms) };
  }
  return { error: "No OWL 2 ontology document or workspace axioms available to reason over." };
}

export interface ValidateConsistencyResult {
  consistent: boolean;
  passed: boolean;
  truncated: boolean;
  unsatisfiableClasses: string[];
  clashes: string[];
  inferredSubClasses: Record<string, string[]>;
  inferredTypes: Record<string, string[]>;
  inferredRoleAssertions: Array<{ property: string; subject: string; object: string }>;
  sameIndividuals: Record<string, string[]>;
  formattedSummary: string;
  report: string;
}

/**
 * Executes the `validate_consistency` action using the SROIQ(D) tableau reasoner.
 */
export async function executeValidateConsistency(
  ctx: ActionExecutionContext,
  params?: { documentText?: string | undefined },
): Promise<ValidateConsistencyResult> {
  const run = runReasonerForContext(ctx, params?.documentText);
  if ("error" in run) {
    return {
      consistent: false,
      passed: false,
      truncated: false,
      unsatisfiableClasses: [],
      clashes: [run.error],
      inferredSubClasses: {},
      inferredTypes: {},
      inferredRoleAssertions: [],
      sameIndividuals: {},
      formattedSummary: run.error,
      report: run.error,
    };
  }

  const res = run.result;
  const unsatisfiableClasses = res.unsatisfiableClasses.filter((c) => c !== "owl:Nothing" && !c.startsWith("__aux_"));
  const inferredSubClasses = mapOfSetsToRecord(res.inferredSubClasses);
  const inferredTypes = mapOfSetsToRecord(res.inferredTypes);
  const sameIndividuals = mapOfSetsToRecord(res.sameIndividuals);

  const subSumCount = Object.values(inferredSubClasses).reduce((sum, arr) => sum + arr.length, 0);
  const passed = res.consistent && unsatisfiableClasses.length === 0;

  let formattedSummary: string;
  if (!res.consistent) {
    formattedSummary = `✗ Ontology is inconsistent: ${res.clashes[0] ?? "Logical contradiction detected."}`;
  } else if (unsatisfiableClasses.length > 0) {
    const preview = unsatisfiableClasses.slice(0, 5).join(", ");
    const suffix = unsatisfiableClasses.length > 5 ? ` (+${unsatisfiableClasses.length - 5} more)` : "";
    formattedSummary = `⚠ Ontology is consistent, but ${unsatisfiableClasses.length} class(es) are unsatisfiable: ${preview}${suffix}.`;
  } else {
    formattedSummary = `✓ Ontology is consistent (${subSumCount} inferred subsumption(s), ${Object.keys(inferredTypes).length} classified individual(s)).`;
  }

  const reportLines: string[] = [
    "OWL 2 SROIQ(D) Tableau Reasoner Report",
    "======================================",
    formattedSummary,
    "",
  ];
  if (res.clashes.length > 0) {
    reportLines.push("Clashes:");
    for (const c of res.clashes) reportLines.push(`  - ${c}`);
    reportLines.push("");
  }
  if (unsatisfiableClasses.length > 0) {
    reportLines.push("Unsatisfiable Classes (≡ owl:Nothing):");
    for (const u of unsatisfiableClasses) reportLines.push(`  - ${u}`);
    reportLines.push("");
  }
  const subEntries = Object.entries(inferredSubClasses);
  if (subEntries.length > 0) {
    reportLines.push("Inferred Class Hierarchy (SubClassOf):");
    for (const [sub, sups] of subEntries) {
      reportLines.push(`  ${sub} ⊑ ${sups.join(", ")}`);
    }
    reportLines.push("");
  }
  const typeEntries = Object.entries(inferredTypes);
  if (typeEntries.length > 0) {
    reportLines.push("Classified Individuals:");
    for (const [ind, types] of typeEntries) {
      reportLines.push(`  ${ind} ∈ ${types.join(", ")}`);
    }
  }

  return {
    consistent: res.consistent,
    passed,
    truncated: Boolean(res.truncated),
    unsatisfiableClasses,
    clashes: [...res.clashes],
    inferredSubClasses,
    inferredTypes,
    inferredRoleAssertions: [...res.inferredRoleAssertions],
    sameIndividuals,
    formattedSummary,
    report: reportLines.join("\n"),
  };
}

/**
 * Executes the `open_ontology_diagram` action by returning the current ontology diagram graph data.
 */
export async function executeOpenOntologyDiagram(
  ctx: ActionExecutionContext,
  _params?: { documentText?: string | undefined },
): Promise<OWL2DiagramData> {
  const wm = ctx?.workspaceManager as
    { unifiedWorkspace?: { owl2Store?: Parameters<typeof getOwl2DiagramData>[0] } } | undefined;
  return getOwl2DiagramData(wm?.unifiedWorkspace?.owl2Store);
}

/**
 * Executes the `explain_inferences` action by computing inferred subsumptions or checking a target pair.
 */
export async function executeExplainInferences(
  ctx: ActionExecutionContext,
  params?: { subClass?: string | undefined; superClass?: string | undefined; documentText?: string | undefined },
): Promise<{
  consistent: boolean;
  entailed?: boolean | undefined;
  subClass?: string | undefined;
  superClass?: string | undefined;
  inferredSubClasses: Record<string, string[]>;
  formattedSummary: string;
}> {
  const run = runReasonerForContext(ctx, params?.documentText);
  if ("error" in run) {
    return {
      consistent: false,
      inferredSubClasses: {},
      formattedSummary: run.error,
    };
  }

  const res = run.result;
  const inferredSubClasses = mapOfSetsToRecord(res.inferredSubClasses);
  const sub = params?.subClass?.trim();
  const sup = params?.superClass?.trim();

  if (sub && sup) {
    const supers = res.inferredSubClasses.get(sub);
    const entailed = sub === sup || Boolean(supers?.has(sup));
    return {
      consistent: res.consistent,
      entailed,
      subClass: sub,
      superClass: sup,
      inferredSubClasses,
      formattedSummary: entailed
        ? `✓ Entailed: '${sub}' is a subclass of '${sup}'.`
        : `✗ Not entailed: '${sub}' is not an inferred subclass of '${sup}'.`,
    };
  }

  const total = Object.values(inferredSubClasses).reduce((acc, arr) => acc + arr.length, 0);
  return {
    consistent: res.consistent,
    inferredSubClasses,
    formattedSummary: `Computed ${total} inferred subclass relationship(s) across ${Object.keys(inferredSubClasses).length} class(es).`,
  };
}

/**
 * Executes the `query_sparql` action against the reasoned OWL 2 ontology.
 * Supports full W3C SPARQL 1.1 (`SELECT`, `ASK`, `CONSTRUCT`, `DESCRIBE`) via `@modelscript/sparql`
 * as well as concise DL shortcuts (`subclasses(...)`, `instances(...)`).
 */
export async function executeQuerySparql(
  ctx: ActionExecutionContext,
  params?: { query?: string | undefined; documentText?: string | undefined; includeInferred?: boolean | undefined },
): Promise<{
  query: string;
  queryType?: string | undefined;
  variables?: string[] | undefined;
  results: unknown[];
  boolean?: boolean | undefined;
  formattedSummary: string;
}> {
  const query = params?.query?.trim() ?? "";
  const docText = params?.documentText ?? ctx?.documentText;

  // Full SPARQL 1.1 execution via @modelscript/sparql
  if (query && /^(?:PREFIX|BASE|SELECT|ASK|CONSTRUCT|DESCRIBE)\b/i.test(query)) {
    if (!docText || !docText.trim()) {
      return { query, results: [], formattedSummary: "No OWL 2 ontology document provided for SPARQL execution." };
    }
    const out = await executeOwl2SparqlQuery(docText, query, {
      includeInferred: params?.includeInferred ?? true,
    });
    return {
      query,
      queryType: out.queryType,
      variables: out.variables,
      results: out.rows,
      boolean: out.boolean,
      formattedSummary: out.formattedSummary,
    };
  }

  const run = runReasonerForContext(ctx, params?.documentText);
  if ("error" in run) {
    return { query, results: [], formattedSummary: run.error };
  }

  const res = run.result;
  const subCall = query.match(/^subclasses\(\s*([^)]+)\s*\)$/i);
  if (subCall?.[1]) {
    const target = subCall[1].trim();
    const matches: string[] = [];
    for (const [sub, sups] of res.inferredSubClasses.entries()) {
      if (!sub.startsWith("__aux_") && sups.has(target)) {
        matches.push(sub);
      }
    }
    return {
      query,
      results: matches,
      formattedSummary: `Found ${matches.length} subclass(es) of '${target}'.`,
    };
  }

  const instCall = query.match(/^instances\(\s*([^)]+)\s*\)$/i);
  if (instCall?.[1]) {
    const target = instCall[1].trim();
    const matches: string[] = [];
    for (const [ind, types] of res.inferredTypes.entries()) {
      if (types.has(target)) {
        matches.push(ind);
      }
    }
    return {
      query,
      results: matches,
      formattedSummary: `Found ${matches.length} instance(s) of '${target}'.`,
    };
  }

  const inferredSubClasses = mapOfSetsToRecord(res.inferredSubClasses);
  const results = Object.entries(inferredSubClasses).flatMap(([sub, sups]) =>
    sups.map((sup) => ({ subClass: sub, superClass: sup })),
  );
  return {
    query,
    results,
    formattedSummary: `Evaluated ontology query (${results.length} inferred subsumption triple(s)).`,
  };
}
