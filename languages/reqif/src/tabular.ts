// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * @modelscript/reqif — World-Class Bidirectional Tabular View & Spreadsheet Editor Engine.
 *
 * Implements multi-sheet tabular projections and lossless bidirectional XML writeback
 * for OMG ReqIF 1.2 (`.reqif` / `.reqifz`) specifications powered by `@modelscript/dsl`'s
 * `TabularConfig` architecture:
 *  - Sheet 1 (`requirements`): Hierarchical Requirements Catalog & Formal Contracts tree-table
 *  - Sheet 2 (`matrix`): Interactive 2D Requirements Traceability Matrix (RTM)
 *  - Sheet 3 (`traceability`): Editable `SPEC-RELATIONS` Traceability Links table
 *  - Sheet 4 (`types`): `SPEC-TYPES` & `DATATYPES` Schema Definitions table
 */

import {
  applyTabularMutation,
  completeTabularCell,
  executeTabularSheet,
  exportTabularSheetToCsv,
  exportTabularSheetToTsv,
  validateTabularCell,
  type CompiledTabularPayload,
  type TabularBadgeStyle,
  type TabularColumnConfig,
  type TabularColumnType,
  type TabularCompletionItem,
  type TabularConfig,
  type TabularMatrixCell,
  type TabularMatrixData,
  type TabularMatrixLinkKind,
  type TabularMutationRequest,
  type TabularMutationResult,
  type TabularRow,
  type TabularValidationResult,
  type WritebackEdit,
} from "@modelscript/dsl";
import { extractAsilLevel, extractFormalContract, parseReqIf, serializeReqIf } from "./parser/reqif-parser.js";
import type {
  ReqIfDataTypeKind,
  ReqIfDocument,
  ReqIfEntailmentResult,
  ReqIfRelationKind,
  ReqIfSpecHierarchy,
  ReqIfSpecObject,
} from "./types.js";

export interface LightweightEntailmentSummary {
  totalQueries: number;
  certifiedCount: number;
  gapCount: number;
  results: ReqIfEntailmentResult[];
}

/**
 * Pure-TypeScript browser-safe V-Model requirement contract entailment evaluator.
 * Checks parent-child `SPEC-HIERARCHY` decompositions and `SPEC-RELATIONS` (`refines`, `derives`, `satisfies`)
 * to verify whether child quantitative bounds mathematically entail parent bounds.
 */
export function evaluateReqIfDecompositionEntailment(doc: ReqIfDocument): LightweightEntailmentSummary {
  const queries: { parentId: string; childIds: string[] }[] = [];

  function collectHierarchicalQueries(h: ReqIfSpecHierarchy): void {
    if (h.children.length > 0) {
      const parentId = h.objectRef;
      const childIds = h.children.map((c) => c.objectRef).filter((id) => doc.specObjects.has(id));
      if (parentId && childIds.length > 0) {
        queries.push({ parentId, childIds });
      }
      for (const child of h.children) {
        collectHierarchicalQueries(child);
      }
    }
  }

  for (const spec of doc.specifications) {
    for (const h of spec.children) {
      collectHierarchicalQueries(h);
    }
  }

  const relationChildren = new Map<string, string[]>();
  for (const rel of doc.specRelations) {
    if (rel.relationType === "refines" || rel.relationType === "derives" || rel.relationType === "satisfies") {
      const parentId = rel.targetId;
      const childId = rel.sourceId;
      if (parentId && childId && doc.specObjects.has(parentId) && doc.specObjects.has(childId)) {
        const list = relationChildren.get(parentId) ?? [];
        if (!list.includes(childId)) list.push(childId);
        relationChildren.set(parentId, list);
      }
    }
  }

  for (const [parentId, childIds] of relationChildren.entries()) {
    if (!queries.some((q) => q.parentId === parentId)) {
      queries.push({ parentId, childIds });
    }
  }

  const results: ReqIfEntailmentResult[] = [];
  for (const q of queries) {
    const parentObj = doc.specObjects.get(q.parentId);
    const pContract = parentObj?.contract;
    if (!parentObj || !pContract) continue;

    const matchingChildren = q.childIds
      .map((cid) => doc.specObjects.get(cid))
      .filter((c): c is ReqIfSpecObject => Boolean(c && c.contract && c.contract.variable === pContract.variable));

    if (matchingChildren.length === 0) continue;

    let isEntailed = true;
    for (const child of matchingChildren) {
      const cContract = child.contract;
      if (!cContract) continue;
      if (pContract.comparator === "<=" || pContract.comparator === "<") {
        if (
          (cContract.comparator !== "<=" && cContract.comparator !== "<" && cContract.comparator !== "==") ||
          cContract.limitValue > pContract.limitValue
        ) {
          isEntailed = false;
        }
      } else if (pContract.comparator === ">=" || pContract.comparator === ">") {
        if (
          (cContract.comparator !== ">=" && cContract.comparator !== ">" && cContract.comparator !== "==") ||
          cContract.limitValue < pContract.limitValue
        ) {
          isEntailed = false;
        }
      } else if (pContract.comparator === "==") {
        if (cContract.comparator !== "==" || cContract.limitValue !== pContract.limitValue) {
          isEntailed = false;
        }
      }
    }

    results.push({
      parentReqId: q.parentId,
      childReqIds: matchingChildren.map((c) => c.identifier),
      isEntailed,
      diagnosticMessage: isEntailed
        ? `Sub-requirements (${matchingChildren.map((c) => c.identifier).join(", ")}) formally entail parent '${q.parentId}' (${pContract.variable} ${pContract.comparator} ${pContract.limitValue}).`
        : `Requirement gap: sub-requirements (${matchingChildren.map((c) => c.identifier).join(", ")}) do not guarantee parent '${q.parentId}' bound (${pContract.variable} ${pContract.comparator} ${pContract.limitValue}).`,
    });
  }

  const certifiedCount = results.filter((r) => r.isEntailed).length;
  return {
    totalQueries: results.length,
    certifiedCount,
    gapCount: results.length - certifiedCount,
    results,
  };
}

/**
 * Visual badge palette for ISO 26262 / DO-178C ASIL & DAL safety levels.
 */
export const REQIF_ASIL_BADGE_MAP: Record<string, TabularBadgeStyle> = {
  "ASIL-D": {
    background: "rgba(239, 68, 68, 0.16)",
    color: "#f87171",
    borderColor: "rgba(239, 68, 68, 0.45)",
  },
  "ASIL-C": {
    background: "rgba(249, 115, 22, 0.16)",
    color: "#fb923c",
    borderColor: "rgba(249, 115, 22, 0.45)",
  },
  "ASIL-B": {
    background: "rgba(234, 179, 8, 0.16)",
    color: "#facc15",
    borderColor: "rgba(234, 179, 8, 0.45)",
  },
  "ASIL-A": {
    background: "rgba(59, 130, 246, 0.16)",
    color: "#60a5fa",
    borderColor: "rgba(59, 130, 246, 0.45)",
  },
  QM: {
    background: "rgba(148, 163, 184, 0.16)",
    color: "#94a3b8",
    borderColor: "rgba(148, 163, 184, 0.35)",
  },
};

/**
 * Visual badge palette for requirement lifecycle & verification status.
 */
export const REQIF_STATUS_BADGE_MAP: Record<string, TabularBadgeStyle> = {
  Verified: {
    background: "rgba(16, 185, 129, 0.16)",
    color: "#34d399",
    borderColor: "rgba(16, 185, 129, 0.45)",
  },
  Approved: {
    background: "rgba(59, 130, 246, 0.16)",
    color: "#60a5fa",
    borderColor: "rgba(59, 130, 246, 0.45)",
  },
  Review: {
    background: "rgba(245, 158, 11, 0.16)",
    color: "#fbbf24",
    borderColor: "rgba(245, 158, 11, 0.45)",
  },
  Draft: {
    background: "rgba(148, 163, 184, 0.14)",
    color: "#94a3b8",
    borderColor: "rgba(148, 163, 184, 0.35)",
  },
  Violated: {
    background: "rgba(239, 68, 68, 0.18)",
    color: "#f87171",
    borderColor: "rgba(239, 68, 68, 0.5)",
  },
};

/**
 * Visual badge palette for Nelson-Oppen formal entailment status.
 */
export const REQIF_ENTAILMENT_BADGE_MAP: Record<string, TabularBadgeStyle> = {
  Certified: {
    background: "rgba(16, 185, 129, 0.16)",
    color: "#34d399",
    borderColor: "rgba(16, 185, 129, 0.45)",
  },
  Contracted: {
    background: "rgba(6, 182, 212, 0.15)",
    color: "#22d3ee",
    borderColor: "rgba(6, 182, 212, 0.4)",
  },
  Gap: {
    background: "rgba(239, 68, 68, 0.18)",
    color: "#f87171",
    borderColor: "rgba(239, 68, 68, 0.5)",
  },
  Prose: {
    background: "rgba(148, 163, 184, 0.12)",
    color: "#94a3b8",
    borderColor: "rgba(148, 163, 184, 0.3)",
  },
};

/**
 * Available `SPEC-RELATION` traceability link stereotypes for RTM and relation tables.
 */
export const REQIF_MATRIX_LINK_KINDS: TabularMatrixLinkKind[] = [
  {
    id: "satisfies",
    label: "satisfies",
    shortLabel: "SAT",
    description: "Source requirement/design element satisfies target requirement",
    badge: {
      background: "rgba(16, 185, 129, 0.18)",
      color: "#34d399",
      borderColor: "rgba(16, 185, 129, 0.45)",
    },
  },
  {
    id: "verifies",
    label: "verifies",
    shortLabel: "VER",
    description: "Source test case or proof verifies target requirement",
    badge: {
      background: "rgba(59, 130, 246, 0.18)",
      color: "#60a5fa",
      borderColor: "rgba(59, 130, 246, 0.45)",
    },
  },
  {
    id: "refines",
    label: "refines",
    shortLabel: "REF",
    description: "Source sub-requirement quantitatively refines target parent requirement",
    badge: {
      background: "rgba(139, 92, 246, 0.18)",
      color: "#a78bfa",
      borderColor: "rgba(139, 92, 246, 0.45)",
    },
  },
  {
    id: "allocates",
    label: "allocates",
    shortLabel: "ALC",
    description: "Source requirement is allocated to target architectural block",
    badge: {
      background: "rgba(245, 158, 11, 0.18)",
      color: "#fbbf24",
      borderColor: "rgba(245, 158, 11, 0.45)",
    },
  },
  {
    id: "derives",
    label: "derives",
    shortLabel: "DRV",
    description: "Source requirement is derived from target hazard or parent requirement",
    badge: {
      background: "rgba(6, 182, 212, 0.18)",
      color: "#22d3ee",
      borderColor: "rgba(6, 182, 212, 0.45)",
    },
  },
  {
    id: "conflicts",
    label: "conflicts",
    shortLabel: "CNF",
    description: "Source requirement conflicts with target requirement",
    badge: {
      background: "rgba(239, 68, 68, 0.2)",
      color: "#f87171",
      borderColor: "rgba(239, 68, 68, 0.5)",
    },
  },
];

const CORE_ATTRIBUTE_NAMES = new Set([
  "reqif.text",
  "text",
  "description",
  "summary",
  "requirement text",
  "asil",
  "asil-level",
  "status",
  "state",
]);

/**
 * Formats an extracted `ReqIfContract` into a clean mathematical string.
 */
export function formatReqIfContract(so: ReqIfSpecObject): string {
  if (!so.contract) return "";
  const unitSuffix = so.contract.unit ? ` ${so.contract.unit}` : "";
  return `${so.contract.variable} ${so.contract.comparator} ${so.contract.limitValue}${unitSuffix}`;
}

/**
 * Updates or embeds a formal contract expression (`variable comparator value [unit]`)
 * inside a requirement's prose statement so round-trip ReqIF XML remains 100% standards-compliant.
 */
export function applyContractToRequirementText(currentText: string, contractExpr: string): string {
  const trimmed = contractExpr.trim();
  if (!trimmed) return currentText;

  const normalized = trimmed.replace(/≤/g, "<=").replace(/≥/g, ">=").replace(/≠/g, "!=");

  const existingPattern =
    /\b([a-zA-Z_][a-zA-Z0-9_.]*)\s*(<=|>=|==|!=|<|>)\s*([-+]?\d+(?:\.\d+)?(?:[eE][-+]?\d+)?)(?:\s*([a-zA-Z%/°Ωμ]+))?/;
  if (existingPattern.test(currentText)) {
    return currentText.replace(existingPattern, normalized);
  }

  const base = currentText.trim().replace(/\.$/, "");
  return base ? `${base} (${normalized}).` : `The system shall satisfy ${normalized}.`;
}

/**
 * Updates a primary text attribute on a `ReqIfSpecObject`.
 */
function setSpecObjectText(so: ReqIfSpecObject, newText: string): void {
  so.text = newText;
  so.contract = extractFormalContract(newText);
  const detectedAsil = extractAsilLevel(`${so.longName || ""} ${newText}`);
  if (detectedAsil) {
    so.asilLevel = detectedAsil;
  }

  let updatedAttr = false;
  for (const attr of so.attributes.values()) {
    const lower = `${attr.definitionRef} ${attr.name}`.toLowerCase();
    if (
      lower.includes("text") ||
      lower.includes("description") ||
      lower.includes("summary") ||
      so.attributes.size === 1
    ) {
      attr.value = newText;
      updatedAttr = true;
      break;
    }
  }

  if (!updatedAttr) {
    so.attributes.set("ReqIF.Text", {
      definitionRef: "AD-TEXT",
      name: "ReqIF.Text",
      kind: "STRING",
      value: newText,
    });
  }
}

/**
 * Extracts hierarchical + flat rows for Sheet 1 (`requirements`).
 */
export function extractReqIfRequirementRows(xmlContent: string): TabularRow[] {
  const doc = parseReqIf(xmlContent);
  const entailmentReport = evaluateReqIfDecompositionEntailment(doc);
  const entailmentByParent = new Map<string, { entailed: boolean; explanation: string }>();
  for (const res of entailmentReport.results) {
    entailmentByParent.set(res.parentReqId, {
      entailed: res.isEntailed,
      explanation: res.diagnosticMessage ?? "",
    });
  }

  const relationsByObject = new Map<string, string[]>();
  for (const rel of doc.specRelations) {
    if (rel.sourceId) {
      const list = relationsByObject.get(rel.sourceId) ?? [];
      list.push(`${rel.relationType} → ${rel.targetId}`);
      relationsByObject.set(rel.sourceId, list);
    }
    if (rel.targetId) {
      const list = relationsByObject.get(rel.targetId) ?? [];
      list.push(`← ${rel.relationType} (${rel.sourceId})`);
      relationsByObject.set(rel.targetId, list);
    }
  }

  const rows: TabularRow[] = [];
  const visitedIds = new Set<string>();

  function buildRow(
    so: ReqIfSpecObject,
    sectionNumber: string,
    depth: number,
    parentId: string | null,
    childIds: string[],
    specId?: string,
  ): TabularRow {
    const ent = entailmentByParent.get(so.identifier);
    const entailmentBadge = ent ? (ent.entailed ? "Certified" : "Gap") : so.contract ? "Contracted" : "Prose";

    const cells: Record<string, unknown> = {
      section: sectionNumber,
      identifier: so.identifier,
      longName: so.longName || so.identifier,
      text: so.text,
      asilLevel: so.asilLevel || "QM",
      status: so.status || (so.contract ? "Approved" : "Draft"),
      contract: formatReqIfContract(so),
      relations: (relationsByObject.get(so.identifier) ?? []).join(", "),
      entailment: entailmentBadge,
      typeRef: so.typeRef || "",
    };

    for (const [key, attr] of so.attributes.entries()) {
      const normName = (attr.name || key).toLowerCase();
      if (!CORE_ATTRIBUTE_NAMES.has(normName)) {
        cells[`attr:${attr.definitionRef || key}`] = attr.value;
      }
    }

    return {
      id: so.identifier,
      kind: "SPEC-OBJECT",
      sectionNumber,
      depth,
      parentId,
      childIds,
      cells,
      span: so.span,
      metadata: {
        specificationId: specId,
        typeRef: so.typeRef,
        contractDetail: so.contract,
        entailmentExplanation: ent?.explanation,
      },
    };
  }

  function walkHierarchy(
    nodes: ReqIfSpecHierarchy[],
    prefix: string,
    depth: number,
    parentObjId: string | null,
    specId: string,
  ): void {
    nodes.forEach((h, idx) => {
      const secNum = prefix ? `${prefix}.${idx + 1}` : `${idx + 1}`;
      const so = doc.specObjects.get(h.objectRef);
      const childObjIds = h.children.map((c) => c.objectRef).filter((cid) => doc.specObjects.has(cid));

      if (so && !visitedIds.has(so.identifier)) {
        visitedIds.add(so.identifier);
        rows.push(buildRow(so, secNum, depth, parentObjId, childObjIds, specId));
      }
      if (h.children.length > 0) {
        walkHierarchy(h.children, secNum, depth + 1, so ? so.identifier : parentObjId, specId);
      }
    });
  }

  for (const spec of doc.specifications) {
    walkHierarchy(spec.children, "", 0, null, spec.identifier);
  }

  let fallbackIndex = rows.length + 1;
  for (const so of doc.specObjects.values()) {
    if (!visitedIds.has(so.identifier)) {
      visitedIds.add(so.identifier);
      rows.push(buildRow(so, `${fallbackIndex++}`, 0, null, []));
    }
  }

  return rows;
}

/**
 * Dynamically discovers custom `SPEC-OBJECT-TYPE` attribute columns defined in the ReqIF document.
 */
export function discoverReqIfDynamicColumns(xmlContent: string): TabularColumnConfig[] {
  const doc = parseReqIf(xmlContent);
  const dynamicCols: TabularColumnConfig[] = [];
  const seenIds = new Set<string>();

  for (const st of doc.specTypes.values()) {
    if (st.kind !== "SPEC-OBJECT-TYPE") continue;
    for (const ad of st.attributeDefinitions.values()) {
      const lowerName = (ad.longName || ad.identifier).toLowerCase();
      if (CORE_ATTRIBUTE_NAMES.has(lowerName)) continue;

      const colId = `attr:${ad.identifier}`;
      if (seenIds.has(colId)) continue;
      seenIds.add(colId);

      let colType: TabularColumnType = "string";
      let options: string[] | undefined;
      if (ad.kind === "INTEGER" || ad.kind === "REAL") {
        colType = "number";
      } else if (ad.kind === "BOOLEAN") {
        colType = "boolean";
      } else if (ad.kind === "DATE") {
        colType = "date";
      } else if (ad.kind === "XHTML") {
        colType = "xhtml";
      } else if (ad.kind === "ENUMERATION") {
        colType = "enum";
        const dt = ad.dataTypeRef ? doc.dataTypes.get(ad.dataTypeRef) : undefined;
        if (dt?.enumValues) {
          options = dt.enumValues.map((ev) => ev.longName || ev.identifier);
        }
      }

      dynamicCols.push({
        id: colId,
        header: ad.longName || ad.identifier,
        description: `ReqIF ${ad.kind} attribute (${ad.identifier}) from ${st.longName || st.identifier}`,
        type: colType,
        width: 140,
        editable: true,
        isDynamic: true,
        options,
      });
    }
  }

  return dynamicCols;
}

/**
 * Extracts rows for Sheet 3 (`traceability` — `SPEC-RELATIONS`).
 */
export function extractReqIfRelationRows(xmlContent: string): TabularRow[] {
  const doc = parseReqIf(xmlContent);
  return doc.specRelations.map((rel, index) => {
    const sourceObj = doc.specObjects.get(rel.sourceId);
    const targetObj = doc.specObjects.get(rel.targetId);

    let linkCheck = "Valid";
    if (sourceObj?.contract && targetObj?.contract && sourceObj.contract.variable === targetObj.contract.variable) {
      const sLimit = sourceObj.contract.limitValue;
      const tLimit = targetObj.contract.limitValue;
      if ((targetObj.contract.comparator === "<=" || targetObj.contract.comparator === "<") && sLimit > tLimit) {
        linkCheck = "Contract Violation";
      } else if ((targetObj.contract.comparator === ">=" || targetObj.contract.comparator === ">") && sLimit < tLimit) {
        linkCheck = "Contract Violation";
      } else {
        linkCheck = "Contract Entailed";
      }
    }

    return {
      id: rel.identifier,
      kind: "SPEC-RELATION",
      sectionNumber: `${index + 1}`,
      cells: {
        identifier: rel.identifier,
        relationType: rel.relationType,
        sourceId: rel.sourceId,
        sourceTitle: sourceObj?.longName || sourceObj?.text?.slice(0, 48) || rel.sourceId,
        targetId: rel.targetId,
        targetTitle: targetObj?.longName || targetObj?.text?.slice(0, 48) || rel.targetId,
        verification: linkCheck,
      },
      span: rel.span,
    };
  });
}

/**
 * Extracts rows for Sheet 4 (`types` — `SPEC-TYPES` & `DATATYPES` schema).
 */
export function extractReqIfTypeRows(xmlContent: string): TabularRow[] {
  const doc = parseReqIf(xmlContent);
  const rows: TabularRow[] = [];

  for (const dt of doc.dataTypes.values()) {
    rows.push({
      id: dt.identifier,
      kind: `DATATYPE-DEFINITION-${dt.kind}`,
      cells: {
        identifier: dt.identifier,
        category: "DATATYPE",
        longName: dt.longName || dt.identifier,
        dataKind: dt.kind,
        parentType: "DATATYPES",
        isMandatory: false,
        constraints: dt.enumValues
          ? dt.enumValues.map((e) => e.longName || e.identifier).join(" | ")
          : dt.min !== undefined || dt.max !== undefined
            ? `[${dt.min ?? "-∞"}, ${dt.max ?? "+∞"}]`
            : "",
      },
    });
  }

  for (const st of doc.specTypes.values()) {
    for (const ad of st.attributeDefinitions.values()) {
      rows.push({
        id: ad.identifier,
        kind: `ATTRIBUTE-DEFINITION-${ad.kind}`,
        cells: {
          identifier: ad.identifier,
          category: "ATTRIBUTE-DEFINITION",
          longName: ad.longName || ad.identifier,
          dataKind: ad.kind,
          parentType: `${st.longName || st.identifier} (${st.kind})`,
          isMandatory: Boolean(ad.isMandatory),
          constraints: ad.dataTypeRef ? `→ ${ad.dataTypeRef}` : "",
        },
      });
    }
  }

  return rows;
}

/**
 * Extracts the 2D Requirements Traceability Matrix (`TabularMatrixData`) for Sheet 2 (`matrix`).
 */
export function extractReqIfMatrix(xmlContent: string): TabularMatrixData {
  const doc = parseReqIf(xmlContent);
  const headers = Array.from(doc.specObjects.values()).map((so) => ({
    id: so.identifier,
    label: so.identifier,
    subtitle: so.longName || so.text.slice(0, 40),
    badge: so.asilLevel || "QM",
  }));

  const cells: Record<string, TabularMatrixCell> = {};
  const linkedRequirementIds = new Set<string>();

  for (const rel of doc.specRelations) {
    if (!rel.sourceId || !rel.targetId) continue;
    const key = `${rel.sourceId}::${rel.targetId}`;
    cells[key] = {
      rowId: rel.sourceId,
      colId: rel.targetId,
      relationId: rel.identifier,
      kind: rel.relationType,
      label: rel.longName || rel.relationType,
      span: rel.span,
    };
    linkedRequirementIds.add(rel.sourceId);
    linkedRequirementIds.add(rel.targetId);
  }

  const totalReqs = headers.length;
  const coveragePercent = totalReqs > 0 ? Math.round((linkedRequirementIds.size / totalReqs) * 100) : 100;

  return {
    rowHeaders: headers,
    colHeaders: headers,
    linkKinds: REQIF_MATRIX_LINK_KINDS,
    cells,
    coveragePercent,
  };
}

/**
 * Builds a full-document `TabularMutationResult` from a mutated `ReqIfDocument`.
 */
function buildSerializedMutationResult(
  originalXml: string,
  doc: ReqIfDocument,
  affectedRowId?: string,
): TabularMutationResult {
  const newText = serializeReqIf(doc);
  const edit: WritebackEdit = {
    startOffset: 0,
    endOffset: originalXml.length,
    newText,
  };
  return {
    success: true,
    edits: [edit],
    newText,
    affectedRowId,
  };
}

/**
 * Updates a cell on a `SPEC-OBJECT` row in Sheet 1 (`requirements`) and writes back to ReqIF XML.
 */
export function updateReqIfRequirementCell(
  xmlContent: string,
  rowId: string,
  columnId: string,
  newValue: unknown,
): TabularMutationResult {
  const doc = parseReqIf(xmlContent);
  const so = doc.specObjects.get(rowId);
  if (!so) {
    return {
      success: false,
      edits: [],
      newText: xmlContent,
      error: `SPEC-OBJECT '${rowId}' not found in ReqIF document.`,
    };
  }

  const strVal = newValue === null || newValue === undefined ? "" : String(newValue);

  switch (columnId) {
    case "longName": {
      so.longName = strVal.trim();
      break;
    }
    case "text": {
      setSpecObjectText(so, strVal);
      break;
    }
    case "asilLevel": {
      const parsedAsil = extractAsilLevel(strVal) ?? (strVal.toUpperCase() as ReqIfSpecObject["asilLevel"]);
      so.asilLevel = parsedAsil;
      for (const attr of so.attributes.values()) {
        if (`${attr.definitionRef} ${attr.name}`.toLowerCase().includes("asil")) {
          attr.value = strVal;
        }
      }
      break;
    }
    case "status": {
      so.status = strVal as ReqIfSpecObject["status"];
      for (const attr of so.attributes.values()) {
        if (`${attr.definitionRef} ${attr.name}`.toLowerCase().includes("status")) {
          attr.value = strVal;
        }
      }
      break;
    }
    case "contract": {
      const updatedText = applyContractToRequirementText(so.text, strVal);
      setSpecObjectText(so, updatedText);
      break;
    }
    default: {
      if (columnId.startsWith("attr:")) {
        const attrId = columnId.slice("attr:".length);
        const existing = so.attributes.get(attrId);
        const valToSet: string | number | boolean =
          typeof newValue === "boolean" || typeof newValue === "number" ? newValue : String(newValue ?? "");
        if (existing) {
          existing.value = valToSet;
        } else {
          let kind: ReqIfDataTypeKind = "STRING";
          let attrName = attrId;
          for (const st of doc.specTypes.values()) {
            const ad = st.attributeDefinitions.get(attrId);
            if (ad) {
              kind = ad.kind;
              attrName = ad.longName || attrId;
              break;
            }
          }
          so.attributes.set(attrId, {
            definitionRef: attrId,
            name: attrName,
            kind,
            value: valToSet,
          });
        }
      } else {
        return {
          success: false,
          edits: [],
          newText: xmlContent,
          error: `Column '${columnId}' cannot be modified directly.`,
        };
      }
    }
  }

  return buildSerializedMutationResult(xmlContent, doc, rowId);
}

/**
 * Inserts a new `SPEC-OBJECT` requirement (and adds it to `SPECIFICATIONS` hierarchy) in the ReqIF document.
 */
export function insertReqIfRequirement(
  xmlContent: string,
  options: {
    afterRowId?: string | undefined;
    parentId?: string | undefined;
    initialCells?: Record<string, unknown> | undefined;
  } = {},
): TabularMutationResult {
  const doc = parseReqIf(xmlContent);
  const init = options.initialCells ?? {};

  let nextIdx = doc.specObjects.size + 1;
  const rawInitId = init["identifier"];
  let newId =
    typeof rawInitId === "string" && rawInitId.trim() ? rawInitId.trim() : `REQ-${String(nextIdx).padStart(3, "0")}`;
  while (doc.specObjects.has(newId)) {
    nextIdx++;
    newId = `REQ-${String(nextIdx).padStart(3, "0")}`;
  }

  let defaultTypeRef: string | undefined;
  let defaultTextDefRef = "AD-TEXT";
  for (const st of doc.specTypes.values()) {
    if (st.kind === "SPEC-OBJECT-TYPE") {
      defaultTypeRef = st.identifier;
      for (const ad of st.attributeDefinitions.values()) {
        if (ad.kind === "STRING" || ad.kind === "XHTML" || (ad.longName || "").toLowerCase().includes("text")) {
          defaultTextDefRef = ad.identifier;
          break;
        }
      }
      break;
    }
  }

  const rawText = init["text"];
  const textValue =
    typeof rawText === "string" && rawText.trim()
      ? rawText.trim()
      : "The system shall satisfy nominal operating bounds.";
  const rawLongName = init["longName"];
  const longName =
    typeof rawLongName === "string" && rawLongName.trim() ? rawLongName.trim() : `New Requirement ${newId}`;
  const asilLevel = extractAsilLevel(String(init["asilLevel"] ?? "")) || extractAsilLevel(textValue) || "ASIL-B";
  const status = (init["status"] as ReqIfSpecObject["status"]) || "Draft";

  const attributes = new Map();
  attributes.set(defaultTextDefRef, {
    definitionRef: defaultTextDefRef,
    name: "ReqIF.Text",
    kind: "STRING" as ReqIfDataTypeKind,
    value: textValue,
  });

  const newSpecObj: ReqIfSpecObject = {
    identifier: newId,
    longName,
    typeRef: defaultTypeRef,
    attributes,
    text: textValue,
    contract: extractFormalContract(textValue),
    asilLevel,
    status,
  };

  doc.specObjects.set(newId, newSpecObj);

  if (doc.specifications.length > 0) {
    const newHierNode: ReqIfSpecHierarchy = {
      identifier: `SH-${newId}`,
      objectRef: newId,
      children: [],
    };
    const spec = doc.specifications[0];
    if (spec) {
      const insertIntoTree = (nodes: ReqIfSpecHierarchy[]): boolean => {
        for (let i = 0; i < nodes.length; i++) {
          const node = nodes[i];
          if (!node) continue;
          if (options.parentId && node.objectRef === options.parentId) {
            node.children.push(newHierNode);
            return true;
          }
          if (options.afterRowId && node.objectRef === options.afterRowId) {
            nodes.splice(i + 1, 0, newHierNode);
            return true;
          }
          if (node.children.length > 0 && insertIntoTree(node.children)) {
            return true;
          }
        }
        return false;
      };

      if (!insertIntoTree(spec.children)) {
        spec.children.push(newHierNode);
      }
    }
  }

  return buildSerializedMutationResult(xmlContent, doc, newId);
}

/**
 * Deletes a `SPEC-OBJECT` requirement, its `SPEC-HIERARCHY` references, and any incident `SPEC-RELATIONS`.
 */
export function deleteReqIfRequirement(xmlContent: string, rowId: string): TabularMutationResult {
  const doc = parseReqIf(xmlContent);
  if (!doc.specObjects.has(rowId)) {
    return {
      success: false,
      edits: [],
      newText: xmlContent,
      error: `SPEC-OBJECT '${rowId}' not found.`,
    };
  }

  doc.specObjects.delete(rowId);
  doc.specRelations = doc.specRelations.filter((rel) => rel.sourceId !== rowId && rel.targetId !== rowId);

  const pruneHierarchy = (nodes: ReqIfSpecHierarchy[]): ReqIfSpecHierarchy[] =>
    nodes
      .filter((n) => n.objectRef !== rowId)
      .map((n) => ({
        ...n,
        children: pruneHierarchy(n.children),
      }));

  for (const spec of doc.specifications) {
    spec.children = pruneHierarchy(spec.children);
  }

  return buildSerializedMutationResult(xmlContent, doc, rowId);
}

/**
 * Moves/reorders a `SPEC-OBJECT` within the `SPECIFICATIONS` hierarchy.
 */
export function moveReqIfRequirement(
  xmlContent: string,
  rowId: string,
  targetParentId?: string | null,
  targetIndex?: number,
): TabularMutationResult {
  const doc = parseReqIf(xmlContent);
  const spec = doc.specifications[0];
  if (!spec) {
    return buildSerializedMutationResult(xmlContent, doc, rowId);
  }
  let extractedNode: ReqIfSpecHierarchy | null = null;

  const removeFromTree = (nodes: ReqIfSpecHierarchy[]): ReqIfSpecHierarchy[] => {
    const kept: ReqIfSpecHierarchy[] = [];
    for (const n of nodes) {
      if (n.objectRef === rowId) {
        extractedNode = n;
      } else {
        kept.push({
          ...n,
          children: removeFromTree(n.children),
        });
      }
    }
    return kept;
  };

  spec.children = removeFromTree(spec.children);
  const nodeToInsert: ReqIfSpecHierarchy = extractedNode ?? {
    identifier: `SH-${rowId}`,
    objectRef: rowId,
    children: [],
  };

  if (targetParentId) {
    const insertUnderParent = (nodes: ReqIfSpecHierarchy[]): boolean => {
      for (const n of nodes) {
        if (n.objectRef === targetParentId) {
          const idx =
            targetIndex !== undefined ? Math.max(0, Math.min(targetIndex, n.children.length)) : n.children.length;
          n.children.splice(idx, 0, nodeToInsert);
          return true;
        }
        if (insertUnderParent(n.children)) return true;
      }
      return false;
    };
    if (!insertUnderParent(spec.children)) {
      spec.children.push(nodeToInsert);
    }
  } else {
    const idx =
      targetIndex !== undefined ? Math.max(0, Math.min(targetIndex, spec.children.length)) : spec.children.length;
    spec.children.splice(idx, 0, nodeToInsert);
  }

  return buildSerializedMutationResult(xmlContent, doc, rowId);
}

/**
 * Updates a cell on a `SPEC-RELATION` row in Sheet 3 (`traceability`).
 */
export function updateReqIfRelationCell(
  xmlContent: string,
  relationId: string,
  columnId: string,
  newValue: unknown,
): TabularMutationResult {
  const doc = parseReqIf(xmlContent);
  const rel = doc.specRelations.find((r) => r.identifier === relationId);
  if (!rel) {
    return {
      success: false,
      edits: [],
      newText: xmlContent,
      error: `SPEC-RELATION '${relationId}' not found.`,
    };
  }

  const strVal = String(newValue ?? "").trim();
  if (columnId === "relationType") {
    rel.relationType = strVal as ReqIfRelationKind;
    rel.longName = strVal;
  } else if (columnId === "sourceId") {
    rel.sourceId = strVal;
  } else if (columnId === "targetId") {
    rel.targetId = strVal;
  } else {
    return {
      success: false,
      edits: [],
      newText: xmlContent,
      error: `Column '${columnId}' on SPEC-RELATION is read-only.`,
    };
  }

  return buildSerializedMutationResult(xmlContent, doc, relationId);
}

/**
 * Inserts a new `SPEC-RELATION` traceability link into the ReqIF document.
 */
export function insertReqIfRelation(
  xmlContent: string,
  options: {
    afterRowId?: string | undefined;
    initialCells?: Record<string, unknown> | undefined;
  } = {},
): TabularMutationResult {
  const doc = parseReqIf(xmlContent);
  const init = options.initialCells ?? {};
  const objIds = Array.from(doc.specObjects.keys());

  let nextIdx = doc.specRelations.length + 1;
  const rawId = init["identifier"];
  let newRelId = typeof rawId === "string" && rawId.trim() ? rawId.trim() : `REL-${String(nextIdx).padStart(2, "0")}`;
  while (doc.specRelations.some((r) => r.identifier === newRelId)) {
    nextIdx++;
    newRelId = `REL-${String(nextIdx).padStart(2, "0")}`;
  }

  const rawSource = init["sourceId"];
  const sourceId =
    typeof rawSource === "string" && rawSource.trim() ? rawSource.trim() : (objIds[1] ?? objIds[0] ?? "");
  const rawTarget = init["targetId"];
  const targetId = typeof rawTarget === "string" && rawTarget.trim() ? rawTarget.trim() : (objIds[0] ?? "");
  const relationType = (init["relationType"] as ReqIfRelationKind) || "satisfies";

  doc.specRelations.push({
    identifier: newRelId,
    longName: relationType,
    relationType,
    sourceId,
    targetId,
  });

  return buildSerializedMutationResult(xmlContent, doc, newRelId);
}

/**
 * Deletes a `SPEC-RELATION` traceability link by identifier.
 */
export function deleteReqIfRelation(xmlContent: string, relationId: string): TabularMutationResult {
  const doc = parseReqIf(xmlContent);
  const before = doc.specRelations.length;
  doc.specRelations = doc.specRelations.filter((r) => r.identifier !== relationId);
  if (doc.specRelations.length === before) {
    return {
      success: false,
      edits: [],
      newText: xmlContent,
      error: `SPEC-RELATION '${relationId}' not found.`,
    };
  }
  return buildSerializedMutationResult(xmlContent, doc, relationId);
}

/**
 * Creates, updates, or deletes a `SPEC-RELATION` cell in the 2D Traceability Matrix (RTM).
 */
export function mutateReqIfMatrixCell(
  xmlContent: string,
  sourceId: string,
  targetId: string,
  newKind: string | null,
): TabularMutationResult {
  const doc = parseReqIf(xmlContent);
  const existingIdx = doc.specRelations.findIndex((r) => r.sourceId === sourceId && r.targetId === targetId);

  if (!newKind || newKind === "none" || newKind === "") {
    if (existingIdx >= 0) {
      doc.specRelations.splice(existingIdx, 1);
    }
    return buildSerializedMutationResult(xmlContent, doc, `${sourceId}::${targetId}`);
  }

  const validKind = newKind as ReqIfRelationKind;
  if (existingIdx >= 0) {
    const rel = doc.specRelations[existingIdx];
    if (rel) {
      rel.relationType = validKind;
      rel.longName = validKind;
      return buildSerializedMutationResult(xmlContent, doc, rel.identifier);
    }
  }

  let nextIdx = doc.specRelations.length + 1;
  let newRelId = `REL-${String(nextIdx).padStart(2, "0")}`;
  while (doc.specRelations.some((r) => r.identifier === newRelId)) {
    nextIdx++;
    newRelId = `REL-${String(nextIdx).padStart(2, "0")}`;
  }

  doc.specRelations.push({
    identifier: newRelId,
    longName: validKind,
    relationType: validKind,
    sourceId,
    targetId,
  });

  return buildSerializedMutationResult(xmlContent, doc, newRelId);
}

/**
 * Declarative & Programmatic `TabularConfig` for `@modelscript/reqif`.
 */
export const reqifTabularConfig: TabularConfig = {
  defaultSheet: "requirements",
  enableSearch: true,
  enableDenseMode: true,
  enableColumnPinning: true,
  enableRowSelection: true,
  enableBatchActions: true,
  enableCsvExport: true,
  enableClipboardTsv: true,
  enableUndoRedo: true,
  enableSourceNavigation: true,
  sheets: {
    requirements: {
      id: "requirements",
      label: "Requirements Catalog",
      icon: "list-tree",
      description:
        "Hierarchical OMG ReqIF 1.2 SPEC-OBJECTS specification table with formal contracts, ISO 26262 ASIL badges, and Nelson-Oppen entailment status",
      kind: "tree",
      rowRules: ["SPEC-OBJECT"],
      hierarchy: {
        parentField: "parentId",
        childrenField: "childIds",
        sectionColumn: "section",
        indentColumn: "identifier",
        collapsible: true,
        allowReorder: true,
      },
      columns: [
        {
          id: "section",
          header: "#",
          description: "Hierarchical specification section number (SPEC-HIERARCHY)",
          type: "string",
          width: 64,
          pinned: "left",
          editable: false,
          sortable: true,
        },
        {
          id: "identifier",
          header: "Req ID",
          description: "Unique ReqIF SPEC-OBJECT IDENTIFIER",
          type: "string",
          width: 136,
          pinned: "left",
          editable: false,
          sortable: true,
        },
        {
          id: "longName",
          header: "Title / Summary",
          description: "SPEC-OBJECT LONG-NAME attribute",
          type: "string",
          width: 210,
          editable: true,
          sortable: true,
        },
        {
          id: "text",
          header: "Requirement Statement (ReqIF.Text)",
          description: "Normative requirement prose and embedded formal contract",
          type: "xhtml",
          width: 380,
          editable: true,
          sortable: true,
        },
        {
          id: "contract",
          header: "Formal Contract",
          description:
            "Extracted mathematical constraint (variable comparator limit [unit]) verified by the Nelson-Oppen oracle",
          type: "contract",
          width: 190,
          editable: true,
          sortable: true,
          validate: (value) => {
            const str = String(value ?? "").trim();
            if (!str) return { valid: true };
            const normalized = str.replace(/≤/g, "<=").replace(/≥/g, ">=").replace(/≠/g, "!=");
            const contract = extractFormalContract(normalized);
            if (!contract) {
              return {
                valid: false,
                severity: "error",
                message: "Contract must follow '<variable> <=|>=|<|>|== <number> [unit]' (e.g. 'overshoot <= 2.5 %').",
              };
            }
            return { valid: true };
          },
          complete: (prefix) => {
            const suggestions: TabularCompletionItem[] = [
              { label: "<=", kind: "operator", detail: "Upper bound inequality (≤)" },
              { label: ">=", kind: "operator", detail: "Lower bound inequality (≥)" },
              { label: "==", kind: "operator", detail: "Exact equality (=)" },
              { label: "<", kind: "operator", detail: "Strict upper bound (<)" },
              { label: ">", kind: "operator", detail: "Strict lower bound (>)" },
              { label: "ms", kind: "unit", detail: "Milliseconds (latency / settling time)" },
              { label: "s", kind: "unit", detail: "Seconds" },
              { label: "%", kind: "unit", detail: "Percentage (overshoot / margin)" },
              { label: "deg", kind: "unit", detail: "Angular degrees (phase margin)" },
              { label: "V", kind: "unit", detail: "Volts" },
              { label: "Nm", kind: "unit", detail: "Newton-meters (torque)" },
            ];
            const lower = prefix.toLowerCase();
            return suggestions.filter((s) => !lower || s.label.toLowerCase().includes(lower));
          },
        },
        {
          id: "asilLevel",
          header: "Safety / ASIL",
          description: "ISO 26262 / DO-178C Safety Integrity Level",
          type: "enum",
          width: 118,
          editable: true,
          sortable: true,
          groupable: true,
          options: ["QM", "ASIL-A", "ASIL-B", "ASIL-C", "ASIL-D"],
          badgeMap: REQIF_ASIL_BADGE_MAP,
        },
        {
          id: "status",
          header: "Status",
          description: "Requirement lifecycle and verification status",
          type: "enum",
          width: 118,
          editable: true,
          sortable: true,
          groupable: true,
          options: ["Draft", "Review", "Approved", "Verified", "Violated"],
          badgeMap: REQIF_STATUS_BADGE_MAP,
        },
        {
          id: "entailment",
          header: "Proof / Entailment",
          description: "Nelson-Oppen V-Model decomposition proof status",
          type: "badge",
          width: 136,
          editable: false,
          sortable: true,
          badgeMap: REQIF_ENTAILMENT_BADGE_MAP,
        },
        {
          id: "relations",
          header: "Traceability Links",
          description: "Incoming and outgoing SPEC-RELATION links",
          type: "reference",
          width: 200,
          editable: false,
          sortable: false,
        },
      ],
      dynamicColumns: (docText) => discoverReqIfDynamicColumns(docText),
      extractRows: (docText) => extractReqIfRequirementRows(docText),
      mutations: {
        updateCell: (docText, rowId, colId, newVal) => updateReqIfRequirementCell(docText, rowId, colId, newVal),
        insertRow: (docText, options) => insertReqIfRequirement(docText, options),
        deleteRow: (docText, rowId) => deleteReqIfRequirement(docText, rowId),
        moveRow: (docText, rowId, targetParentId, targetIndex) =>
          moveReqIfRequirement(docText, rowId, targetParentId, targetIndex),
      },
      kpis: [
        {
          id: "total",
          label: "Requirements",
          description: "Total SPEC-OBJECT requirements in specification",
          icon: "list-ordered",
          accentColor: "#38bdf8",
          compute: (rows) => ({
            value: rows.length,
            sublabel: "SPEC-OBJECTS",
            status: "neutral",
          }),
        },
        {
          id: "contracts",
          label: "Formal Contracts",
          description: "Requirements with machine-verifiable quantitative constraints",
          icon: "symbol-operator",
          accentColor: "#22d3ee",
          compute: (rows) => {
            const withContract = rows.filter((r) => Boolean(r.cells["contract"])).length;
            const pct = rows.length > 0 ? Math.round((withContract / rows.length) * 100) : 0;
            return {
              value: `${withContract} / ${rows.length}`,
              sublabel: `${pct}% formalized`,
              status: withContract > 0 ? "ok" : "neutral",
            };
          },
          filterPredicate: (row) => Boolean(row.cells["contract"]),
        },
        {
          id: "coverage",
          label: "Traceability Coverage",
          description: "Percentage of requirements linked via SPEC-RELATIONS",
          icon: "references",
          accentColor: "#34d399",
          compute: (rows) => {
            const linked = rows.filter((r) => Boolean(r.cells["relations"])).length;
            const pct = rows.length > 0 ? Math.round((linked / rows.length) * 100) : 100;
            return {
              value: `${pct}%`,
              sublabel: `${linked}/${rows.length} linked`,
              status: pct === 100 ? "ok" : pct >= 60 ? "warn" : "error",
            };
          },
          filterPredicate: (row) => Boolean(row.cells["relations"]),
        },
        {
          id: "entailment",
          label: "Nelson-Oppen Proof",
          description: "Formal V-Model parent-child requirement entailment verification",
          icon: "shield",
          accentColor: "#a78bfa",
          compute: (rows, docText) => {
            if (!docText) {
              return { value: "Ready", sublabel: "0 gaps", status: "ok" };
            }
            const doc = parseReqIf(docText);
            const report = evaluateReqIfDecompositionEntailment(doc);
            if (report.gapCount > 0) {
              return {
                value: `${report.gapCount} Gap${report.gapCount > 1 ? "s" : ""}`,
                sublabel: `${report.certifiedCount}/${report.totalQueries} certified`,
                status: "error",
              };
            }
            const highAsil = rows.filter(
              (r) => r.cells["asilLevel"] === "ASIL-D" || r.cells["asilLevel"] === "ASIL-C",
            ).length;
            return {
              value: report.totalQueries > 0 ? "Certified" : "Consistent",
              sublabel:
                report.totalQueries > 0
                  ? `${report.certifiedCount}/${report.totalQueries} entailed`
                  : `${highAsil} ASIL-C/D items`,
              status: "ok",
            };
          },
          filterPredicate: (row) => row.cells["entailment"] === "Certified" || row.cells["entailment"] === "Gap",
        },
      ],
      exportFormats: ["csv", "tsv", "reqif", "markdown"],
    },

    matrix: {
      id: "matrix",
      label: "Traceability Matrix (RTM)",
      icon: "table",
      description:
        "Interactive 2D Requirements × Requirements Traceability Matrix where clicking any cell cycles SPEC-RELATION links",
      kind: "matrix",
      rowRules: ["SPEC-RELATION"],
      columns: [],
      matrix: {
        rowSheet: "requirements",
        colSheet: "requirements",
        cellRule: "SPEC-RELATION",
        linkKinds: REQIF_MATRIX_LINK_KINDS,
        extractMatrix: (docText) => extractReqIfMatrix(docText),
        mutateCell: (docText, rowId, colId, newKind) => mutateReqIfMatrixCell(docText, rowId, colId, newKind),
      },
      extractRows: (docText) => extractReqIfRelationRows(docText),
    },

    traceability: {
      id: "traceability",
      label: "Spec Relations (Links)",
      icon: "git-compare",
      description: "Editable table of all directed SPEC-RELATION traceability links",
      kind: "flat",
      rowRules: ["SPEC-RELATION"],
      columns: [
        {
          id: "identifier",
          header: "Relation ID",
          type: "string",
          width: 130,
          pinned: "left",
          editable: false,
        },
        {
          id: "relationType",
          header: "Relation Stereotype",
          type: "enum",
          width: 150,
          editable: true,
          options: ["satisfies", "verifies", "refines", "allocates", "derives", "conflicts"],
          badgeMap: Object.fromEntries(REQIF_MATRIX_LINK_KINDS.flatMap((k) => (k.badge ? [[k.id, k.badge]] : []))),
        },
        {
          id: "sourceId",
          header: "Source Req ID",
          type: "reference",
          width: 150,
          editable: true,
        },
        {
          id: "sourceTitle",
          header: "Source Summary",
          type: "string",
          width: 240,
          editable: false,
        },
        {
          id: "targetId",
          header: "Target Req ID",
          type: "reference",
          width: 150,
          editable: true,
        },
        {
          id: "targetTitle",
          header: "Target Summary",
          type: "string",
          width: 240,
          editable: false,
        },
        {
          id: "verification",
          header: "Contract Consistency",
          type: "badge",
          width: 160,
          editable: false,
          badgeMap: {
            ...(REQIF_ENTAILMENT_BADGE_MAP["Certified"] && {
              "Contract Entailed": REQIF_ENTAILMENT_BADGE_MAP["Certified"],
            }),
            ...(REQIF_STATUS_BADGE_MAP["Approved"] && {
              Valid: REQIF_STATUS_BADGE_MAP["Approved"],
            }),
            ...(REQIF_ENTAILMENT_BADGE_MAP["Gap"] && {
              "Contract Violation": REQIF_ENTAILMENT_BADGE_MAP["Gap"],
            }),
          },
        },
      ],
      extractRows: (docText) => extractReqIfRelationRows(docText),
      mutations: {
        updateCell: (docText, rowId, colId, newVal) => updateReqIfRelationCell(docText, rowId, colId, newVal),
        insertRow: (docText, options) => insertReqIfRelation(docText, options),
        deleteRow: (docText, rowId) => deleteReqIfRelation(docText, rowId),
      },
    },

    types: {
      id: "types",
      label: "Types & Schema",
      icon: "symbol-struct",
      description: "OMG ReqIF DATATYPES and SPEC-TYPES attribute definitions",
      kind: "flat",
      rowRules: ["SPEC-OBJECT-TYPE", "DATATYPE-DEFINITION"],
      columns: [
        {
          id: "identifier",
          header: "Type / Attr ID",
          type: "string",
          width: 150,
          pinned: "left",
          editable: false,
        },
        {
          id: "category",
          header: "Schema Kind",
          type: "badge",
          width: 170,
          editable: false,
        },
        {
          id: "longName",
          header: "Long Name",
          type: "string",
          width: 200,
          editable: false,
        },
        {
          id: "dataKind",
          header: "Base Type",
          type: "badge",
          width: 130,
          editable: false,
        },
        {
          id: "parentType",
          header: "Enclosing Spec Type",
          type: "string",
          width: 220,
          editable: false,
        },
        {
          id: "isMandatory",
          header: "Mandatory",
          type: "boolean",
          width: 100,
          editable: false,
        },
        {
          id: "constraints",
          header: "Range / Enum / Ref",
          type: "string",
          width: 220,
          editable: false,
        },
      ],
      extractRows: (docText) => extractReqIfTypeRows(docText),
    },
  },
};

/**
 * Executes a sheet of the ReqIF Tabular Engine and returns the compiled payload.
 */
export function executeReqIfTabular(xmlContent: string, sheetId = "requirements"): CompiledTabularPayload {
  return executeTabularSheet(reqifTabularConfig, xmlContent, sheetId);
}

/**
 * Applies a bidirectional mutation (cell edit, row insert/delete/move, or RTM matrix link toggle)
 * to a ReqIF XML document.
 */
export function applyReqIfTabularMutation(xmlContent: string, mutation: TabularMutationRequest): TabularMutationResult {
  return applyTabularMutation(reqifTabularConfig, xmlContent, mutation);
}

/**
 * Validates a cell edit in a ReqIF tabular sheet.
 */
export function validateReqIfTabularCell(
  xmlContent: string,
  sheetId: string,
  rowId: string,
  columnId: string,
  value: unknown,
): TabularValidationResult {
  return validateTabularCell(reqifTabularConfig, xmlContent, sheetId, rowId, columnId, value);
}

/**
 * Computes context-aware completions for a cell in a ReqIF tabular sheet.
 */
export function completeReqIfTabularCell(
  xmlContent: string,
  sheetId: string,
  rowId: string,
  columnId: string,
  prefix: string,
): TabularCompletionItem[] {
  if (sheetId === "traceability" && (columnId === "sourceId" || columnId === "targetId")) {
    const doc = parseReqIf(xmlContent);
    const lower = prefix.toLowerCase();
    return Array.from(doc.specObjects.values())
      .map((so) => ({
        label: so.identifier,
        kind: "reference",
        detail: so.longName || so.text.slice(0, 50),
      }))
      .filter((item) => !lower || item.label.toLowerCase().includes(lower));
  }
  return completeTabularCell(reqifTabularConfig, xmlContent, sheetId, rowId, columnId, prefix);
}

export { exportTabularSheetToCsv, exportTabularSheetToTsv };
