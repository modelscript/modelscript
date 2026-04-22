/**
 * Requirements Management & Traceability — LSP query layer.
 *
 * Builds spreadsheet-friendly data structures from the unified SysML/Modelica
 * symbol index, enabling the Requirements Editor webview and the Traceability
 * Matrix panel.
 *
 * Uses language-agnostic predicates (ruleName.includes("Requirement"), etc.)
 * so the same logic works for any grammar that follows the SysML v2 naming
 * convention.
 */

import type { SymbolEntry, SymbolIndex } from "@modelscript/polyglot";

// ---------------------------------------------------------------------------
// Public data types
// ---------------------------------------------------------------------------

/** A single requirement row for the Requirements Editor grid. */
export interface RequirementRow {
  /** Symbol ID in the unified index. */
  id: number;
  /** Human-readable ID extracted from metadata (e.g., "REQ-001") or generated. */
  reqId: string;
  /** The rule that produced this entry (e.g., "RequirementDefinition"). */
  type: string;
  /** Symbol name. */
  name: string;
  /** Requirement text / doc attribute, if any. */
  text: string;
  /** "Definition" or "Usage". */
  kind: string;
  /** URI of the document containing this requirement. */
  uri: string;
  /** Start byte in the source text (for go-to-source). */
  startByte: number;
  /** End byte in the source text. */
  endByte: number;
  /** IDs of child constraint symbols. */
  constraintIds: number[];
  /** Verification status placeholder. */
  status: "Pending" | "Passed" | "Failed";
}

/** A single cell in the traceability matrix. */
export interface TraceabilityLink {
  /** Symbol ID of the satisfy/verify entry. */
  linkId: number;
  /** Kind of link: "satisfy" or "verify". */
  linkKind: "satisfy" | "verify";
  /** Symbol ID of the source (block, part, etc.). */
  sourceId: number;
  /** Name of the source symbol. */
  sourceName: string;
  /** Symbol ID of the target requirement. */
  targetId: number;
  /** Name of the target requirement. */
  targetName: string;
}

export interface TraceabilityMatrix {
  /** All distinct source (implementer) names. */
  sources: string[];
  /** All distinct target (requirement) names. */
  targets: string[];
  /** The link entries. */
  links: TraceabilityLink[];
}

// ---------------------------------------------------------------------------
// Language-agnostic predicates (mirrors verifier.ts)
// ---------------------------------------------------------------------------

function isRequirementEntry(entry: SymbolEntry): boolean {
  return (
    entry.ruleName.includes("Requirement") &&
    (entry.kind === "Usage" || entry.kind === "Definition" || entry.kind === "Def" || entry.kind === "Class")
  );
}

function isConstraintEntry(entry: SymbolEntry): boolean {
  return (
    entry.ruleName.includes("Constraint") &&
    (entry.kind === "Usage" || entry.kind === "Definition" || entry.kind === "Def")
  );
}

function isSatisfyEntry(entry: SymbolEntry): boolean {
  return entry.ruleName.includes("Satisfy");
}

function isVerifyEntry(entry: SymbolEntry): boolean {
  return entry.ruleName.includes("Verify");
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Extract all requirement rows visible in a given document.
 *
 * @param index   The unified symbol index (merged Modelica + SysML).
 * @param uri     The document URI to scope results to (or null for all).
 * @returns       Array of RequirementRow objects.
 */
export function getRequirements(
  index: SymbolIndex,
  uri?: string,
  verificationResults?: { requirementId: number; constraintId?: number; isSatisfied: boolean }[],
): RequirementRow[] {
  const rows: RequirementRow[] = [];
  let seqId = 1;

  for (const entry of index.symbols.values()) {
    if (uri && entry.resourceId !== uri) continue;
    if (!isRequirementEntry(entry)) continue;

    // Find constraint children
    const constraintIds: number[] = [];
    const childIds = index.childrenOf.get(entry.id);
    if (childIds) {
      for (const cid of childIds) {
        const child = index.symbols.get(cid);
        if (child && isConstraintEntry(child)) {
          constraintIds.push(cid);
        }
      }
    }

    // Extract text from metadata (doc, description, text)
    const text =
      (entry.metadata?.doc as string) ??
      (entry.metadata?.description as string) ??
      (entry.metadata?.text as string) ??
      "";

    // Extract a human-readable ID from metadata or generate one
    const reqId =
      (entry.metadata?.id as string) ?? (entry.metadata?.reqId as string) ?? `REQ-${String(seqId++).padStart(3, "0")}`;

    let status: "Passed" | "Failed" | "Pending" = "Pending";
    if (verificationResults && verificationResults.length > 0) {
      let hasCheckedConstraint = false;
      let hasFailure = false;
      const reqResults = verificationResults.filter(
        (r) => r.requirementId === entry.id || (r.constraintId !== undefined && constraintIds.includes(r.constraintId)),
      );
      for (const res of reqResults) {
        hasCheckedConstraint = true;
        if (!res.isSatisfied) hasFailure = true;
      }
      if (hasCheckedConstraint) {
        status = hasFailure ? "Failed" : "Passed";
      }
    }

    rows.push({
      id: entry.id,
      reqId,
      type: entry.ruleName,
      name: entry.name,
      text,
      kind: entry.kind,
      uri: entry.resourceId ?? "",
      startByte: entry.startByte,
      endByte: entry.endByte,
      constraintIds,
      status,
    });
  }

  return rows;
}

/**
 * Build a traceability matrix from satisfy/verify usage entries.
 *
 * Scans the unified index for `SatisfyRequirementUsage` and
 * `VerifyRequirementUsage` entries, then resolves their names
 * to the target requirement definitions.
 *
 * @param index   The unified symbol index.
 * @param uri     Optional document URI to scope results.
 * @returns       A TraceabilityMatrix with source/target name lists and links.
 */
export function getTraceabilityMatrix(index: SymbolIndex, uri?: string): TraceabilityMatrix {
  const links: TraceabilityLink[] = [];
  const sourceSet = new Set<string>();
  const targetSet = new Set<string>();

  for (const entry of index.symbols.values()) {
    if (uri && entry.resourceId !== uri) continue;

    const isSatisfy = isSatisfyEntry(entry);
    const isVerify = isVerifyEntry(entry);
    if (!isSatisfy && !isVerify) continue;

    // The entry's name is typically the referenced requirement name
    const targetName = entry.name;
    if (!targetName) continue;

    // Resolve the target requirement
    const targetIds = index.byName.get(targetName);
    let targetId: number | undefined;
    if (targetIds) {
      for (const tid of targetIds) {
        const t = index.symbols.get(tid);
        if (t && isRequirementEntry(t)) {
          targetId = tid;
          break;
        }
      }
    }

    // Find the source (parent of this satisfy/verify usage)
    let sourceName = "<unknown>";
    let sourceId = -1;
    if (entry.parentId !== null) {
      const parent = index.symbols.get(entry.parentId);
      if (parent) {
        sourceName = parent.name;
        sourceId = parent.id;
      }
    }

    sourceSet.add(sourceName);
    targetSet.add(targetName);

    links.push({
      linkId: entry.id,
      linkKind: isSatisfy ? "satisfy" : "verify",
      sourceId,
      sourceName,
      targetId: targetId ?? -1,
      targetName,
    });
  }

  return {
    sources: Array.from(sourceSet).sort(),
    targets: Array.from(targetSet).sort(),
    links,
  };
}
