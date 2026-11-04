// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * @modelscript/genbank — Pre-flight Diagnostic Error Definitions.
 *
 * Conforms to OpenModelica-style diagnostic formatting (M9351 - M9360).
 */

import type { GenbankRange } from "./types.js";

export type DiagnosticSeverity = "error" | "warning" | "info";

export interface DiagnosticItem {
  code: number;
  rule: string;
  severity: DiagnosticSeverity;
  message: string;
  range?: GenbankRange | undefined;
}

export const GenbankErrorCode = {
  LOCUS_LENGTH_MISMATCH: {
    code: 9351,
    rule: "locus-length-mismatch",
    severity: "error" as DiagnosticSeverity,
    message: (locus: string, declaredLength: number, actualLength: number) =>
      `LOCUS '${locus}' declares length '${declaredLength}' bp, but ORIGIN sequence has '${actualLength}' bp.`,
  },
  INVALID_SEQUENCE_CHARACTER: {
    code: 9352,
    rule: "invalid-sequence-character",
    severity: "error" as DiagnosticSeverity,
    message: (locus: string, invalidChar: string, position: number) =>
      `Sequence '${locus}' contains non-IUPAC character '${invalidChar}' at position '${position}'.`,
  },
  FEATURE_LOCATION_OUT_OF_BOUNDS: {
    code: 9353,
    rule: "feature-location-out-of-bounds",
    severity: "error" as DiagnosticSeverity,
    message: (featureName: string, start: number, end: number, locus: string, seqLength: number) =>
      `Feature '${featureName}' location '[${start}..${end}]' is out of bounds for sequence '${locus}' of length '${seqLength}' bp.`,
  },
  CDS_MISSING_START_CODON: {
    code: 9354,
    rule: "cds-missing-start-codon",
    severity: "warning" as DiagnosticSeverity,
    message: (cdsName: string, actualCodon: string) =>
      `Coding sequence (CDS) '${cdsName}' begins with '${actualCodon}' instead of a valid start codon ('ATG', 'GTG', or 'TTG').`,
  },
  CDS_MISSING_STOP_CODON: {
    code: 9355,
    rule: "cds-missing-stop-codon",
    severity: "warning" as DiagnosticSeverity,
    message: (cdsName: string, actualCodon: string) =>
      `Coding sequence (CDS) '${cdsName}' ends with '${actualCodon}' instead of a valid stop codon ('TAA', 'TAG', or 'TGA').`,
  },
  CDS_INTERNAL_PREMATURE_STOP: {
    code: 9356,
    rule: "cds-internal-premature-stop",
    severity: "error" as DiagnosticSeverity,
    message: (cdsName: string, stopCodon: string, codonIndex: number) =>
      `Coding sequence (CDS) '${cdsName}' contains an internal premature stop codon '${stopCodon}' at codon '${codonIndex}'.`,
  },
  CDS_TRANSLATION_MISMATCH: {
    code: 9357,
    rule: "cds-translation-mismatch",
    severity: "error" as DiagnosticSeverity,
    message: (cdsName: string, expectedTranslation: string, actualTranslation: string) =>
      `Coding sequence (CDS) '${cdsName}' /translation qualifier '${actualTranslation}' does not match translated sequence '${expectedTranslation}'.`,
  },
  EMPTY_GENBANK_ORIGIN: {
    code: 9358,
    rule: "empty-genbank-origin",
    severity: "error" as DiagnosticSeverity,
    message: (locus: string) => `GenBank record '${locus}' has an empty or missing ORIGIN nucleotide sequence.`,
  },
  INVERTED_FEATURE_SPAN: {
    code: 9359,
    rule: "inverted-feature-span",
    severity: "error" as DiagnosticSeverity,
    message: (featureName: string, start: number, end: number, locus: string) =>
      `Feature '${featureName}' in non-circular sequence '${locus}' has inverted span '[${start}..${end}]' ('start > end').`,
  },
  DUPLICATE_LOCUS_IDENTIFIER: {
    code: 9360,
    rule: "duplicate-locus-identifier",
    severity: "error" as DiagnosticSeverity,
    message: (locus: string) => `LOCUS or FASTA identifier '${locus}' is declared multiple times in the document.`,
  },
} as const;
