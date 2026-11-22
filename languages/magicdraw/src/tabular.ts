// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * @modelscript/magicdraw — Tabular & Requirements Traceability Matrix (RTM) View Adapter.
 *
 * Extracts structured requirement and block tables from MagicDraw `.mdzip`/`.mdxml`/`.xmi`
 * documents for ModelScript's tabular explorer and RTM panels.
 */

import { parseMagicDraw } from "./parser/index.js";
import type { MagicDrawDocument } from "./types.js";

export interface MagicDrawRequirementRow {
  xmiId: string;
  id: string;
  name: string;
  qualifiedName: string;
  text: string;
  stereotypes: string[];
  satisfiedBy: string[];
  verifiedBy: string[];
  derivedFrom: string[];
}

export interface MagicDrawBlockRow {
  xmiId: string;
  name: string;
  qualifiedName: string;
  kind: string;
  stereotypes: string[];
  partsCount: number;
  valuesCount: number;
  portsCount: number;
  constraintsCount: number;
}

export interface MagicDrawTabularResult {
  requirements: MagicDrawRequirementRow[];
  blocks: MagicDrawBlockRow[];
}

export function extractMagicDrawTables(docOrText: MagicDrawDocument | string): MagicDrawTabularResult {
  const doc = typeof docOrText === "string" ? parseMagicDraw(docOrText) : docOrText;

  const satisfiedByMap = new Map<string, string[]>();
  const verifiedByMap = new Map<string, string[]>();
  const derivedFromMap = new Map<string, string[]>();

  for (const rel of doc.relationships) {
    const srcName = doc.elementsById.get(rel.sourceId)?.name ?? rel.sourceId;
    const dstName = doc.elementsById.get(rel.targetId)?.name ?? rel.targetId;
    if (rel.kind === "satisfy") {
      const list = satisfiedByMap.get(rel.targetId) ?? [];
      list.push(srcName);
      satisfiedByMap.set(rel.targetId, list);
    } else if (rel.kind === "verify") {
      const list = verifiedByMap.get(rel.targetId) ?? [];
      list.push(srcName);
      verifiedByMap.set(rel.targetId, list);
    } else if (rel.kind === "deriveReqt") {
      const list = derivedFromMap.get(rel.sourceId) ?? [];
      list.push(dstName);
      derivedFromMap.set(rel.sourceId, list);
    }
  }

  const requirements: MagicDrawRequirementRow[] = [];
  const blocks: MagicDrawBlockRow[] = [];

  for (const cls of doc.classifiers.values()) {
    if (cls.kind === "Requirement") {
      requirements.push({
        xmiId: cls.id,
        id: cls.requirementId ?? cls.name,
        name: cls.name,
        qualifiedName: cls.qualifiedName,
        text: cls.requirementText ?? cls.documentation ?? "",
        stereotypes: cls.stereotypes.map((s) => s.name),
        satisfiedBy: satisfiedByMap.get(cls.id) ?? [],
        verifiedBy: verifiedByMap.get(cls.id) ?? [],
        derivedFrom: derivedFromMap.get(cls.id) ?? [],
      });
    } else if (
      cls.kind === "Block" ||
      cls.kind === "InterfaceBlock" ||
      cls.kind === "ConstraintBlock" ||
      cls.kind === "ValueType"
    ) {
      blocks.push({
        xmiId: cls.id,
        name: cls.name,
        qualifiedName: cls.qualifiedName,
        kind: cls.kind,
        stereotypes: cls.stereotypes.map((s) => s.name),
        partsCount: cls.properties.filter((p) => p.compartment === "parts").length,
        valuesCount: cls.properties.filter((p) => p.compartment === "values").length,
        portsCount: cls.ports.length,
        constraintsCount: cls.constraints.length + cls.properties.filter((p) => p.compartment === "constraints").length,
      });
    }
  }

  return { requirements, blocks };
}

export interface MagicDrawMatrixResult {
  relationKind: "satisfy" | "verify" | "deriveReqt" | "allocate";
  rows: Array<{ id: string; name: string }>;
  columns: Array<{ id: string; name: string }>;
  cells: Array<{ rowId: string; columnId: string; label: string }>;
}

/**
 * Builds a Cameo-compatible Dependency / Traceability Matrix (rows × columns)
 * for `satisfy`, `verify`, `deriveReqt`, or `allocate` relationships.
 */
export function buildMagicDrawMatrix(
  docOrText: MagicDrawDocument | string,
  relationKind: MagicDrawMatrixResult["relationKind"] = "satisfy",
): MagicDrawMatrixResult {
  const doc = typeof docOrText === "string" ? parseMagicDraw(docOrText) : docOrText;
  const rowMap = new Map<string, string>();
  const colMap = new Map<string, string>();
  const cells: MagicDrawMatrixResult["cells"] = [];

  for (const rel of doc.relationships) {
    if (rel.kind !== relationKind) continue;
    const srcName = doc.elementsById.get(rel.sourceId)?.name ?? rel.sourceId;
    const dstName = doc.elementsById.get(rel.targetId)?.name ?? rel.targetId;
    rowMap.set(rel.sourceId, srcName);
    colMap.set(rel.targetId, dstName);
    cells.push({ rowId: rel.sourceId, columnId: rel.targetId, label: `«${relationKind}»` });
  }

  return {
    relationKind,
    rows: Array.from(rowMap.entries()).map(([id, name]) => ({ id, name })),
    columns: Array.from(colMap.entries()).map(([id, name]) => ({ id, name })),
    cells,
  };
}
