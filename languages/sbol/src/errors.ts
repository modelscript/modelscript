// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * @modelscript/sbol — Pre-flight Diagnostic Error Definitions.
 *
 * Conforms to OpenModelica-style diagnostic formatting (M9501 - M9510).
 */

import type { SbolRange } from "./types.js";

export type DiagnosticSeverity = "error" | "warning" | "info";

export interface DiagnosticItem {
  code: number;
  rule: string;
  severity: DiagnosticSeverity;
  message: string;
  range?: SbolRange | undefined;
}

export const SbolErrorCode = {
  INVALID_NUCLEOTIDE_SEQUENCE: {
    code: 9501,
    rule: "invalid-nucleotide-sequence",
    severity: "error" as DiagnosticSeverity,
    message: (seqId: string, invalidChar: string) =>
      `Sequence '${seqId}' contains characters outside the IUPAC nucleic acid alphabet ('${invalidChar}').`,
  },
  SEQUENCE_RANGE_OUT_OF_BOUNDS: {
    code: 9502,
    rule: "sequence-range-out-of-bounds",
    severity: "error" as DiagnosticSeverity,
    message: (featureId: string, start: number, end: number, seqId: string, seqLength: number) =>
      `Feature '${featureId}' location '[${start}..${end}]' exceeds sequence '${seqId}' length '${seqLength}'.`,
  },
  CDS_LENGTH_NOT_MULTIPLE_OF_THREE: {
    code: 9503,
    rule: "cds-length-not-multiple-of-three",
    severity: "warning" as DiagnosticSeverity,
    message: (cdsId: string, length: number) =>
      `Coding sequence (CDS) '${cdsId}' nucleotide length ('${length}') is not divisible by 3 or lacks a valid start/stop codon.`,
  },
  UNRESOLVED_SUBCOMPONENT_REFERENCE: {
    code: 9504,
    rule: "unresolved-subcomponent-reference",
    severity: "error" as DiagnosticSeverity,
    message: (subId: string, compId: string, instanceOf: string) =>
      `SubComponent '${subId}' in '${compId}' references undefined Component '${instanceOf}'.`,
  },
  INVALID_TRANSCRIPTIONAL_UNIT_ORDER: {
    code: 9505,
    rule: "invalid-transcriptional-unit-order",
    severity: "error" as DiagnosticSeverity,
    message: (compId: string, termId: string, promId: string) =>
      `Engineered region '${compId}' places terminator '${termId}' upstream of promoter '${promId}' without an intervening CDS.`,
  },
  DANGLING_INTERACTION_PARTICIPANT: {
    code: 9506,
    rule: "dangling-interaction-participant",
    severity: "error" as DiagnosticSeverity,
    message: (intId: string, participantId: string) =>
      `Interaction '${intId}' participant references undefined component '${participantId}'.`,
  },
  MISSING_INTERACTION_ROLE: {
    code: 9507,
    rule: "missing-interaction-role",
    severity: "warning" as DiagnosticSeverity,
    message: (participantId: string, intId: string) =>
      `Participant '${participantId}' in interaction '${intId}' lacks a Systems Biology Ontology (SBO) role (inhibitor, stimulator, template, product).`,
  },
  CIRCULAR_COMPONENT_HIERARCHY: {
    code: 9508,
    rule: "circular-component-hierarchy",
    severity: "error" as DiagnosticSeverity,
    message: (compId: string) =>
      `SubComponent hierarchy contains a circular containment reference involving '${compId}'.`,
  },
  DUPLICATE_DISPLAY_ID: {
    code: 9509,
    rule: "duplicate-display-id",
    severity: "error" as DiagnosticSeverity,
    message: (id: string, namespace = "default") =>
      `displayId '${id}' is declared multiple times within the '${namespace}' namespace.`,
  },
  MISSING_CDS_RIBOSOME_BINDING_SITE: {
    code: 9510,
    rule: "missing-cds-ribosome-binding-site",
    severity: "warning" as DiagnosticSeverity,
    message: (compId: string, cdsId: string) =>
      `Bacterial transcriptional unit '${compId}' contains CDS '${cdsId}' without an upstream RBS ('SO:0000139').`,
  },
} as const;
