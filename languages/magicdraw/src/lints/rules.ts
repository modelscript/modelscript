// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * @modelscript/magicdraw — Semantic & Structural Lint Rules (M9921–M9934).
 *
 * Validates MagicDraw / Cameo `.mdzip`, `.mdxml`, and `.xmi` archives and models:
 * - Archive integrity, encryption, and Teamwork Cloud proxy stub detection (M9921–M9923)
 * - XMI identity, stereotype attachment, and external href resolution (M9924–M9926)
 * - Block/Property typing, connector integrity, and cyclic composition (M9927–M9929)
 * - SysML 1.x Requirement completeness and traceability (M9930–M9933)
 * - Parametric binding type compatibility (M9934)
 */

import type { MagicDrawDocument, SourceSpan } from "../types.js";

export type MagicDrawLintSeverity = "error" | "warning" | "info";

export interface MagicDrawLintDiagnostic {
  code: string;
  rule: string;
  severity: MagicDrawLintSeverity;
  message: string;
  elementId?: string | undefined;
  span?: SourceSpan | undefined;
}

export const MAGICDRAW_LINT_RULES = {
  CORRUPT_ARCHIVE: {
    code: "M9921",
    rule: "magicdraw-corrupt-archive",
    severity: "error" as const,
  },
  ENCRYPTED_ARCHIVE: {
    code: "M9922",
    rule: "magicdraw-encrypted-archive",
    severity: "error" as const,
  },
  TWC_STUB: {
    code: "M9923",
    rule: "magicdraw-twc-stub",
    severity: "error" as const,
  },
  DUPLICATE_XMI_ID: {
    code: "M9924",
    rule: "magicdraw-duplicate-xmi-id",
    severity: "error" as const,
  },
  ORPHAN_STEREOTYPE: {
    code: "M9925",
    rule: "magicdraw-orphan-stereotype",
    severity: "warning" as const,
  },
  UNRESOLVED_HREF: {
    code: "M9926",
    rule: "magicdraw-unresolved-href",
    severity: "warning" as const,
  },
  UNTYPED_PROPERTY: {
    code: "M9927",
    rule: "magicdraw-untyped-property",
    severity: "warning" as const,
  },
  DANGLING_CONNECTOR: {
    code: "M9928",
    rule: "magicdraw-dangling-connector",
    severity: "error" as const,
  },
  CYCLIC_COMPOSITION: {
    code: "M9929",
    rule: "magicdraw-cyclic-composition",
    severity: "error" as const,
  },
  REQUIREMENT_MISSING_ID: {
    code: "M9930",
    rule: "magicdraw-requirement-missing-id",
    severity: "warning" as const,
  },
  REQUIREMENT_MISSING_TEXT: {
    code: "M9931",
    rule: "magicdraw-requirement-missing-text",
    severity: "warning" as const,
  },
  UNSATISFIED_REQUIREMENT: {
    code: "M9932",
    rule: "magicdraw-unsatisfied-requirement",
    severity: "warning" as const,
  },
  UNVERIFIED_REQUIREMENT: {
    code: "M9933",
    rule: "magicdraw-unverified-requirement",
    severity: "info" as const,
  },
  INVALID_PARAMETRIC_BINDING: {
    code: "M9934",
    rule: "magicdraw-invalid-parametric-binding",
    severity: "error" as const,
  },
} as const;

export function lintMagicDrawDocument(doc: MagicDrawDocument): MagicDrawLintDiagnostic[] {
  const diagnostics: MagicDrawLintDiagnostic[] = [];

  // M9921–M9923: Archive status diagnostics
  if (doc.metadata.status === "corrupt" || doc.metadata.status === "empty") {
    diagnostics.push({
      ...MAGICDRAW_LINT_RULES.CORRUPT_ARCHIVE,
      message: doc.metadata.statusMessage ?? "MagicDraw archive is corrupt or contains no UML/SysML model payload.",
    });
    return diagnostics;
  }
  if (doc.metadata.status === "encrypted") {
    diagnostics.push({
      ...MAGICDRAW_LINT_RULES.ENCRYPTED_ARCHIVE,
      message: doc.metadata.statusMessage ?? "Password-protected MagicDraw .mdzip archive cannot be unpacked.",
    });
    return diagnostics;
  }
  if (doc.metadata.status === "twc-stub") {
    diagnostics.push({
      ...MAGICDRAW_LINT_RULES.TWC_STUB,
      message: doc.metadata.statusMessage ?? "Teamwork Cloud (TWC) proxy stub contains no local UML/SysML model.",
    });
    return diagnostics;
  }

  // M9924: Duplicate xmi:id
  for (const dup of doc.duplicateIds) {
    diagnostics.push({
      ...MAGICDRAW_LINT_RULES.DUPLICATE_XMI_ID,
      message: `Duplicate xmi:id '${dup.id}' detected in MagicDraw XMI model.`,
      elementId: dup.id,
      span: dup.span,
    });
  }

  // M9925: Orphan stereotypes
  for (const st of doc.orphanStereotypes) {
    diagnostics.push({
      ...MAGICDRAW_LINT_RULES.ORPHAN_STEREOTYPE,
      message: `Stereotype application '«${st.name}»' references missing target element '${st.targetId}'.`,
      elementId: st.id,
      span: st.span,
    });
  }

  // M9926: Unresolved external hrefs
  for (const ref of doc.unresolvedHrefs) {
    diagnostics.push({
      ...MAGICDRAW_LINT_RULES.UNRESOLVED_HREF,
      message: `Unresolved external href '${ref.href}' (mount the referenced .mdzip module in the workspace).`,
      elementId: ref.ownerId,
      span: ref.span,
    });
  }

  // Build adjacency for cyclic composition check (M9929)
  const compAdj = new Map<string, string[]>();
  for (const rel of doc.relationships) {
    if (rel.kind === "composition") {
      const list = compAdj.get(rel.sourceId) ?? [];
      list.push(rel.targetId);
      compAdj.set(rel.sourceId, list);
    }
  }

  const visited = new Set<string>();
  const inStack = new Set<string>();
  const reportedCycles = new Set<string>();
  const dfsCycle = (nodeId: string) => {
    visited.add(nodeId);
    inStack.add(nodeId);
    for (const next of compAdj.get(nodeId) ?? []) {
      if (inStack.has(next)) {
        const key = [nodeId, next].sort().join("->");
        if (!reportedCycles.has(key)) {
          reportedCycles.add(key);
          const srcName = doc.classifiers.get(nodeId)?.name ?? nodeId;
          const dstName = doc.classifiers.get(next)?.name ?? next;
          diagnostics.push({
            ...MAGICDRAW_LINT_RULES.CYCLIC_COMPOSITION,
            message: `Cyclic composite block ownership detected between '${srcName}' and '${dstName}'.`,
            elementId: nodeId,
            span: doc.classifiers.get(nodeId)?.span,
          });
        }
      } else if (!visited.has(next)) {
        dfsCycle(next);
      }
    }
    inStack.delete(nodeId);
  };
  for (const id of compAdj.keys()) {
    if (!visited.has(id)) dfsCycle(id);
  }

  // Requirement satisfaction / verification index
  const satisfiedReqs = new Set<string>();
  const verifiedReqs = new Set<string>();
  const parentReqs = new Set<string>();
  for (const rel of doc.relationships) {
    if (rel.kind === "satisfy") satisfiedReqs.add(rel.targetId);
    else if (rel.kind === "verify") verifiedReqs.add(rel.targetId);
    else if (rel.kind === "containment") parentReqs.add(rel.sourceId);
  }

  // Inspect classifiers, properties, ports, connectors, requirements
  for (const cls of doc.classifiers.values()) {
    // M9927: Untyped properties & ports
    for (const prop of cls.properties) {
      if (!prop.typeRef || (!prop.typeRef.resolvedName && !prop.typeRef.isExternalUnresolved)) {
        diagnostics.push({
          ...MAGICDRAW_LINT_RULES.UNTYPED_PROPERTY,
          message: `Property '${cls.name}.${prop.name}' has no resolved type.`,
          elementId: prop.id,
          span: prop.span,
        });
      }
    }
    for (const port of cls.ports) {
      if (!port.typeRef || (!port.typeRef.resolvedName && !port.typeRef.isExternalUnresolved)) {
        diagnostics.push({
          ...MAGICDRAW_LINT_RULES.UNTYPED_PROPERTY,
          message: `Port '${cls.name}.${port.name}' has no resolved interface/block type.`,
          elementId: port.id,
          span: port.span,
        });
      }
    }

    // M9928 & M9934: Connector ends & parametric bindings
    for (const conn of cls.connectors) {
      if (conn.ends.length < 2) {
        diagnostics.push({
          ...MAGICDRAW_LINT_RULES.DANGLING_CONNECTOR,
          message: `Connector '${conn.name || conn.id}' in '${cls.name}' has fewer than 2 ends.`,
          elementId: conn.id,
          span: conn.span,
        });
        continue;
      }
      const endTypeNames: Array<string | undefined> = [];
      for (const end of conn.ends) {
        if (!end.roleId || !doc.elementsById.has(end.roleId)) {
          diagnostics.push({
            ...MAGICDRAW_LINT_RULES.DANGLING_CONNECTOR,
            message: `Connector '${conn.name || conn.id}' in '${cls.name}' references missing role '${end.roleId ?? "<none>"}'.`,
            elementId: conn.id,
            span: conn.span,
          });
        } else {
          // Find property type if role is a property
          const ownerProp =
            cls.properties.find((p) => p.id === end.roleId) ??
            Array.from(doc.classifiers.values())
              .flatMap((c) => c.properties)
              .find((p) => p.id === end.roleId);
          endTypeNames.push(ownerProp?.typeRef?.resolvedName);
        }
        if (end.partWithPortId && !doc.elementsById.has(end.partWithPortId)) {
          diagnostics.push({
            ...MAGICDRAW_LINT_RULES.DANGLING_CONNECTOR,
            message: `Connector '${conn.name || conn.id}' in '${cls.name}' references missing partWithPort '${end.partWithPortId}'.`,
            elementId: conn.id,
            span: conn.span,
          });
        }
      }

      if (conn.kind === "binding" && endTypeNames.length >= 2) {
        const t0 = endTypeNames[0];
        const t1 = endTypeNames[1];
        if (t0 && t1 && t0 !== t1) {
          const numericSet = new Set(["Real", "Integer", "Number"]);
          const bothNumeric = numericSet.has(t0) && numericSet.has(t1);
          if (!bothNumeric) {
            diagnostics.push({
              ...MAGICDRAW_LINT_RULES.INVALID_PARAMETRIC_BINDING,
              message: `Parametric binding connector '${conn.name || conn.id}' links incompatible types '${t0}' and '${t1}'.`,
              elementId: conn.id,
              span: conn.span,
            });
          }
        }
      }
    }

    // M9930–M9933: Requirements checks
    if (cls.kind === "Requirement") {
      if (!cls.requirementId || !cls.requirementId.trim()) {
        diagnostics.push({
          ...MAGICDRAW_LINT_RULES.REQUIREMENT_MISSING_ID,
          message: `Requirement '${cls.name}' is missing a non-empty 'id' tag.`,
          elementId: cls.id,
          span: cls.span,
        });
      }
      if (!cls.requirementText || !cls.requirementText.trim()) {
        diagnostics.push({
          ...MAGICDRAW_LINT_RULES.REQUIREMENT_MISSING_TEXT,
          message: `Requirement '${cls.name}' is missing a non-empty 'text' specification.`,
          elementId: cls.id,
          span: cls.span,
        });
      }
      if (!parentReqs.has(cls.id)) {
        if (!satisfiedReqs.has(cls.id)) {
          diagnostics.push({
            ...MAGICDRAW_LINT_RULES.UNSATISFIED_REQUIREMENT,
            message: `Leaf requirement '${cls.requirementId ?? cls.name}' has no incoming «satisfy» relationship.`,
            elementId: cls.id,
            span: cls.span,
          });
        }
        if (!verifiedReqs.has(cls.id)) {
          diagnostics.push({
            ...MAGICDRAW_LINT_RULES.UNVERIFIED_REQUIREMENT,
            message: `Leaf requirement '${cls.requirementId ?? cls.name}' has no incoming «verify» relationship.`,
            elementId: cls.id,
            span: cls.span,
          });
        }
      }
    }
  }

  return diagnostics;
}
