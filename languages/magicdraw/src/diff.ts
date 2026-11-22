// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * @modelscript/magicdraw — Semantic `.mdzip` / XMI Model Diff Engine.
 *
 * Compares two MagicDraw / Cameo models by stable `xmi:id` and reports:
 * - Added / removed / modified Classifiers (Blocks, Ports, Properties, Constraints)
 * - Added / removed / modified Requirements (including text & traceability changes)
 * - Added / removed Relationships and Diagrams
 */

import { parseMagicDraw } from "./parser/index.js";
import type { MagicDrawDocument, UmlClassifier } from "./types.js";

export interface ClassifierFieldChange {
  field: string;
  before?: string | undefined;
  after?: string | undefined;
}

export interface ClassifierDiffEntry {
  xmiId: string;
  name: string;
  qualifiedName: string;
  kind: string;
  changeType: "added" | "removed" | "modified";
  changes?: ClassifierFieldChange[] | undefined;
}

export interface DiagramDiffEntry {
  xmiId: string;
  name: string;
  kind: string;
  changeType: "added" | "removed" | "renamed";
  previousName?: string | undefined;
}

export interface MagicDrawDiffResult {
  baseProject: string;
  targetProject: string;
  summary: {
    classifiersAdded: number;
    classifiersRemoved: number;
    classifiersModified: number;
    requirementsChanged: number;
    relationshipsAdded: number;
    relationshipsRemoved: number;
    diagramsAdded: number;
    diagramsRemoved: number;
    diagramsRenamed: number;
  };
  classifierDiffs: ClassifierDiffEntry[];
  diagramDiffs: DiagramDiffEntry[];
}

function compareClassifiers(a: UmlClassifier, b: UmlClassifier): ClassifierFieldChange[] {
  const changes: ClassifierFieldChange[] = [];
  if (a.name !== b.name) changes.push({ field: "name", before: a.name, after: b.name });
  if (a.kind !== b.kind) changes.push({ field: "kind", before: a.kind, after: b.kind });
  if (a.isAbstract !== b.isAbstract) {
    changes.push({ field: "isAbstract", before: String(a.isAbstract), after: String(b.isAbstract) });
  }
  if (a.requirementId !== b.requirementId) {
    changes.push({ field: "requirementId", before: a.requirementId, after: b.requirementId });
  }
  if (a.requirementText !== b.requirementText) {
    changes.push({ field: "requirementText", before: a.requirementText, after: b.requirementText });
  }

  const aProps = new Map(a.properties.map((p) => [p.id, p]));
  const bProps = new Map(b.properties.map((p) => [p.id, p]));
  for (const [pid, bp] of bProps) {
    const ap = aProps.get(pid);
    if (!ap) {
      changes.push({ field: `property:+${bp.name}`, after: bp.typeRef?.resolvedName ?? "Any" });
    } else if (ap.defaultValue !== bp.defaultValue || ap.typeRef?.resolvedName !== bp.typeRef?.resolvedName) {
      changes.push({
        field: `property:${bp.name}`,
        before: `${ap.typeRef?.resolvedName ?? "Any"}${ap.defaultValue ? ` = ${ap.defaultValue}` : ""}`,
        after: `${bp.typeRef?.resolvedName ?? "Any"}${bp.defaultValue ? ` = ${bp.defaultValue}` : ""}`,
      });
    }
  }
  for (const [pid, ap] of aProps) {
    if (!bProps.has(pid)) {
      changes.push({ field: `property:-${ap.name}`, before: ap.typeRef?.resolvedName ?? "Any" });
    }
  }

  const aPorts = new Set(a.ports.map((p) => p.id));
  const bPorts = new Set(b.ports.map((p) => p.id));
  for (const p of b.ports) {
    if (!aPorts.has(p.id)) changes.push({ field: `port:+${p.name}`, after: p.typeRef?.resolvedName ?? "Port" });
  }
  for (const p of a.ports) {
    if (!bPorts.has(p.id)) changes.push({ field: `port:-${p.name}`, before: p.typeRef?.resolvedName ?? "Port" });
  }

  return changes;
}

/**
 * Computes a semantic diff between two MagicDraw `.mdzip` / `.mdxml` / `.xmi` models by `xmi:id`.
 */
export function diffMagicDrawDocuments(
  baseInput: MagicDrawDocument | string | Uint8Array,
  targetInput: MagicDrawDocument | string | Uint8Array,
): MagicDrawDiffResult {
  const base = typeof baseInput === "string" || baseInput instanceof Uint8Array ? parseMagicDraw(baseInput) : baseInput;
  const target =
    typeof targetInput === "string" || targetInput instanceof Uint8Array ? parseMagicDraw(targetInput) : targetInput;

  const classifierDiffs: ClassifierDiffEntry[] = [];
  let classifiersAdded = 0;
  let classifiersRemoved = 0;
  let classifiersModified = 0;
  let requirementsChanged = 0;

  for (const [id, tCls] of target.classifiers) {
    const bCls = base.classifiers.get(id);
    if (!bCls) {
      classifiersAdded++;
      if (tCls.kind === "Requirement") requirementsChanged++;
      classifierDiffs.push({
        xmiId: id,
        name: tCls.name,
        qualifiedName: tCls.qualifiedName,
        kind: tCls.kind,
        changeType: "added",
      });
    } else {
      const changes = compareClassifiers(bCls, tCls);
      if (changes.length > 0) {
        classifiersModified++;
        if (tCls.kind === "Requirement" || bCls.kind === "Requirement") requirementsChanged++;
        classifierDiffs.push({
          xmiId: id,
          name: tCls.name,
          qualifiedName: tCls.qualifiedName,
          kind: tCls.kind,
          changeType: "modified",
          changes,
        });
      }
    }
  }

  for (const [id, bCls] of base.classifiers) {
    if (!target.classifiers.has(id)) {
      classifiersRemoved++;
      if (bCls.kind === "Requirement") requirementsChanged++;
      classifierDiffs.push({
        xmiId: id,
        name: bCls.name,
        qualifiedName: bCls.qualifiedName,
        kind: bCls.kind,
        changeType: "removed",
      });
    }
  }

  const baseRelIds = new Set(base.relationships.map((r) => r.id));
  const targetRelIds = new Set(target.relationships.map((r) => r.id));
  let relationshipsAdded = 0;
  let relationshipsRemoved = 0;
  for (const id of targetRelIds) if (!baseRelIds.has(id)) relationshipsAdded++;
  for (const id of baseRelIds) if (!targetRelIds.has(id)) relationshipsRemoved++;

  const baseDiagMap = new Map(base.diagrams.map((d) => [d.id, d]));
  const targetDiagMap = new Map(target.diagrams.map((d) => [d.id, d]));
  const diagramDiffs: DiagramDiffEntry[] = [];
  let diagramsAdded = 0;
  let diagramsRemoved = 0;
  let diagramsRenamed = 0;

  for (const [id, td] of targetDiagMap) {
    const bd = baseDiagMap.get(id);
    if (!bd) {
      diagramsAdded++;
      diagramDiffs.push({ xmiId: id, name: td.name, kind: td.kind, changeType: "added" });
    } else if (bd.name !== td.name) {
      diagramsRenamed++;
      diagramDiffs.push({
        xmiId: id,
        name: td.name,
        kind: td.kind,
        changeType: "renamed",
        previousName: bd.name,
      });
    }
  }
  for (const [id, bd] of baseDiagMap) {
    if (!targetDiagMap.has(id)) {
      diagramsRemoved++;
      diagramDiffs.push({ xmiId: id, name: bd.name, kind: bd.kind, changeType: "removed" });
    }
  }

  return {
    baseProject: base.metadata.projectName ?? "Base",
    targetProject: target.metadata.projectName ?? "Target",
    summary: {
      classifiersAdded,
      classifiersRemoved,
      classifiersModified,
      requirementsChanged,
      relationshipsAdded,
      relationshipsRemoved,
      diagramsAdded,
      diagramsRemoved,
      diagramsRenamed,
    },
    classifierDiffs,
    diagramDiffs,
  };
}

/**
 * Formats a `MagicDrawDiffResult` as a human-readable Markdown report.
 */
export function formatMagicDrawDiffMarkdown(diff: MagicDrawDiffResult): string {
  const s = diff.summary;
  const lines: string[] = [
    `# MagicDraw Semantic Diff: ${diff.baseProject} → ${diff.targetProject}`,
    "",
    `- **Classifiers:** +${s.classifiersAdded} added, -${s.classifiersRemoved} removed, ~${s.classifiersModified} modified`,
    `- **Requirements impacted:** ${s.requirementsChanged}`,
    `- **Relationships:** +${s.relationshipsAdded} added, -${s.relationshipsRemoved} removed`,
    `- **Diagrams:** +${s.diagramsAdded} added, -${s.diagramsRemoved} removed, ~${s.diagramsRenamed} renamed`,
    "",
  ];

  if (diff.classifierDiffs.length > 0) {
    lines.push("## Classifier Changes");
    for (const c of diff.classifierDiffs.slice(0, 50)) {
      const sym = c.changeType === "added" ? "+" : c.changeType === "removed" ? "-" : "~";
      lines.push(`- \`[${sym}]\` **«${c.kind}» ${c.qualifiedName}**`);
      for (const ch of c.changes ?? []) {
        lines.push(`  - \`${ch.field}\`: ${ch.before ?? "∅"} → ${ch.after ?? "∅"}`);
      }
    }
    if (diff.classifierDiffs.length > 50) {
      lines.push(`- ... and ${diff.classifierDiffs.length - 50} more classifier changes`);
    }
    lines.push("");
  }

  if (diff.diagramDiffs.length > 0) {
    lines.push("## Diagram Changes");
    for (const d of diff.diagramDiffs.slice(0, 30)) {
      const sym = d.changeType === "added" ? "+" : d.changeType === "removed" ? "-" : "~";
      const detail = d.previousName ? ` (was \`${d.previousName}\`)` : "";
      lines.push(`- \`[${sym}]\` [${d.kind}] **${d.name}**${detail}`);
    }
  }

  return `${lines.join("\n")}\n`;
}
