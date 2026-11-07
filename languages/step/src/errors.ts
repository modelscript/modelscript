// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * @modelscript/step — Standard Diagnostic Error Codes (T1001–T1010).
 */

export const StepErrorCode = {
  STEP_SYNTAX_ERROR: {
    code: 1001,
    rule: "step-syntax-error",
    severity: "error" as const,
    message: (detail: string) => `STEP file syntax error: ${detail}.`,
  },
  MISSING_HEADER_SECTION: {
    code: 1002,
    rule: "missing-header-section",
    severity: "error" as const,
    message: () => `STEP exchange file is missing mandatory 'HEADER;' section.`,
  },
  MISSING_SCHEMA_DECLARATION: {
    code: 1003,
    rule: "missing-schema-declaration",
    severity: "warning" as const,
    message: () => `STEP header lacks a recognized 'FILE_SCHEMA' declaration (e.g. AP203, AP214, AP242).`,
  },
  MISSING_DATA_SECTION: {
    code: 1004,
    rule: "missing-data-section",
    severity: "error" as const,
    message: () => `STEP exchange file is missing mandatory 'DATA;' section.`,
  },
  UNRESOLVED_ENTITY_REFERENCE: {
    code: 1005,
    rule: "unresolved-entity-reference",
    severity: "error" as const,
    message: (entityId: number | string) => `Referenced STEP entity '#${entityId}' is not defined in the DATA section.`,
  },
  DUPLICATE_ENTITY_ID: {
    code: 1006,
    rule: "duplicate-entity-id",
    severity: "error" as const,
    message: (entityId: number | string) => `Entity ID '#${entityId}' is declared more than once in the DATA section.`,
  },
  EMPTY_DATA_SECTION: {
    code: 1007,
    rule: "empty-data-section",
    severity: "warning" as const,
    message: () => `STEP DATA section contains no entity records.`,
  },
  UNSUPPORTED_AP_SCHEMA: {
    code: 1008,
    rule: "unsupported-ap-schema",
    severity: "warning" as const,
    message: (schema: string) =>
      `Application Protocol schema '${schema}' may not support complete PMI or B-Rep extraction.`,
  },
  NON_MANIFOLD_EDGE: {
    code: 1009,
    rule: "non-manifold-edge",
    severity: "error" as const,
    message: (edgeId: number | string) =>
      `Edge '#${edgeId}' is shared by more than two faces without a manifold partition.`,
  },
  OPEN_SOLID_SHELL: {
    code: 1010,
    rule: "open-solid-shell",
    severity: "error" as const,
    message: (shellId: number | string) =>
      `Manifold solid Brep shell '#${shellId}' is open (not watertight).`,
  },
  DEGENERATE_FACE_NORMAL: {
    code: 1011,
    rule: "degenerate-face-normal",
    severity: "error" as const,
    message: (surfaceId: number | string) =>
      `Face surface '#${surfaceId}' normal vector has zero magnitude.`,
  },
  VERTEX_TOLERANCE_GAP: {
    code: 1012,
    rule: "vertex-tolerance-gap",
    severity: "warning" as const,
    message: (v1: number | string, v2: number | string, gap: number) =>
      `Distance between vertices '#${v1}' and '#${v2}' (${gap}m) exceeds AP242 tolerance.`,
  },
  SELF_INTERSECTING_WIRE: {
    code: 1013,
    rule: "self-intersecting-wire",
    severity: "error" as const,
    message: (wireId: number | string) =>
      `Face boundary loop wire '#${wireId}' intersects itself.`,
  },
  UNREFERENCED_PRESENTATION_ITEM: {
    code: 1014,
    rule: "unreferenced-presentation-item",
    severity: "warning" as const,
    message: (styleId: number | string) =>
      `Geometric presentation style assignment '#${styleId}' references unlinked item.`,
  },
} as const;

export type StepErrorCodeKey = keyof typeof StepErrorCode;
