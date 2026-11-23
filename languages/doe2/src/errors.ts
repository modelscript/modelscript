// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * @modelscript/doe2 — Diagnostic Error Codes (DOE1001–DOE5006).
 */

import type { Doe2DiagnosticSeverity } from "./types.js";

export interface Doe2ErrorSpec {
  code: string;
  rule: string;
  severity: Doe2DiagnosticSeverity;
}

export const Doe2ErrorCode = {
  // 1xxx — Syntax & Structure
  SYNTAX_ERROR: {
    code: "DOE1001",
    rule: "syntax-error",
    severity: "error" as Doe2DiagnosticSeverity,
    message: (detail: string) => `BDL syntax error: ${detail}.`,
  },
  MISSING_TERMINATOR: {
    code: "DOE1002",
    rule: "missing-terminator",
    severity: "error" as Doe2DiagnosticSeverity,
    message: (command: string) => `Command '${command}' is missing its required '..' terminator.`,
  },

  // 2xxx — Name Resolution & Duplicates
  DUPLICATE_OBJECT_NAME: {
    code: "DOE2001",
    rule: "duplicate-object-name",
    severity: "error" as Doe2DiagnosticSeverity,
    message: (kind: string, name: string) => `Duplicate ${kind} object name '${name}' in BDL deck.`,
  },
  UNDEFINED_CONSTRUCTION_REF: {
    code: "DOE2002",
    rule: "undefined-construction-ref",
    severity: "error" as Doe2DiagnosticSeverity,
    message: (construction: string, refKind: string, refName: string) =>
      `CONSTRUCTION '${construction}' references undefined ${refKind} '${refName}'.`,
  },
  UNDEFINED_SURFACE_CONSTRUCTION: {
    code: "DOE2003",
    rule: "undefined-surface-construction",
    severity: "error" as Doe2DiagnosticSeverity,
    message: (surfaceKind: string, surfaceName: string, constructionName: string) =>
      `${surfaceKind} '${surfaceName}' references undefined CONSTRUCTION '${constructionName}'.`,
  },
  UNDEFINED_GLASS_TYPE: {
    code: "DOE2004",
    rule: "undefined-glass-type",
    severity: "error" as Doe2DiagnosticSeverity,
    message: (windowName: string, glassTypeName: string) =>
      `WINDOW '${windowName}' references undefined GLASS-TYPE '${glassTypeName}'.`,
  },
  UNDEFINED_ZONE_SPACE: {
    code: "DOE2005",
    rule: "undefined-zone-space",
    severity: "error" as Doe2DiagnosticSeverity,
    message: (zoneName: string, spaceName: string) => `ZONE '${zoneName}' references undefined SPACE '${spaceName}'.`,
  },
  UNDEFINED_LAYERS_MATERIAL: {
    code: "DOE2006",
    rule: "undefined-layers-material",
    severity: "error" as Doe2DiagnosticSeverity,
    message: (layersName: string, materialName: string) =>
      `LAYERS '${layersName}' references undefined MATERIAL '${materialName}'.`,
  },

  // 3xxx — Physical Property & Range Validation
  NON_POSITIVE_THICKNESS: {
    code: "DOE3001",
    rule: "non-positive-thickness",
    severity: "error" as Doe2DiagnosticSeverity,
    message: (materialName: string, value: number) =>
      `MATERIAL '${materialName}' has non-positive THICKNESS '${value}'.`,
  },
  NON_POSITIVE_CONDUCTIVITY: {
    code: "DOE3002",
    rule: "non-positive-conductivity",
    severity: "error" as Doe2DiagnosticSeverity,
    message: (materialName: string, prop: string, value: number) =>
      `MATERIAL '${materialName}' has non-positive ${prop} '${value}'.`,
  },
  NON_POSITIVE_AREA: {
    code: "DOE3003",
    rule: "non-positive-area",
    severity: "error" as Doe2DiagnosticSeverity,
    message: (kind: string, name: string, prop: string, value: number) =>
      `${kind} '${name}' has non-positive ${prop} '${value}'.`,
  },
  INVALID_SCHEDULE_VALUE: {
    code: "DOE3004",
    rule: "invalid-schedule-value",
    severity: "error" as Doe2DiagnosticSeverity,
    message: (scheduleName: string, detail: string) => `Schedule '${scheduleName}' contains invalid value: ${detail}.`,
  },

  // 4xxx — Structural Hierarchy
  ORPHAN_OPENING: {
    code: "DOE4001",
    rule: "orphan-opening",
    severity: "warning" as Doe2DiagnosticSeverity,
    message: (kind: string, name: string) =>
      `${kind} '${name}' is not preceded by a parent EXTERIOR-WALL or ROOF surface.`,
  },

  // 5xxx — Deck Completeness & Simulation Control
  MISSING_STOP: {
    code: "DOE5001",
    rule: "missing-stop",
    severity: "warning" as Doe2DiagnosticSeverity,
    message: () => "BDL input deck is missing a terminating 'STOP ..' command.",
  },
  UNLINKED_SPACE: {
    code: "DOE5006",
    rule: "unlinked-space",
    severity: "info" as Doe2DiagnosticSeverity,
    message: (spaceName: string) => `SPACE '${spaceName}' is not assigned to any SYSTEMS ZONE.`,
  },
} as const;
