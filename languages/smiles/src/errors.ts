// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * @modelscript/smiles — Pre-flight Cheminformatics & Molecular Graph Diagnostic Error Definitions.
 *
 * Conforms to OpenModelica-style diagnostic formatting (M9301 - M9310).
 */

import type { SmilesRange } from "./types.js";

export type DiagnosticSeverity = "error" | "warning" | "info";

export interface DiagnosticItem {
  code: number;
  rule: string;
  severity: DiagnosticSeverity;
  message: string;
  range?: SmilesRange | undefined;
}

export const SmilesErrorCode = {
  UNCLOSED_RING_DIGIT: {
    code: 9301,
    rule: "unclosed-ring-digit",
    severity: "error" as DiagnosticSeverity,
    message: (ringId: string | number, moleculeName: string) =>
      `Ring closure digit '${ringId}' in '${moleculeName}' has no matching closing bond.`,
  },
  UNBALANCED_BRANCH_PARENTHESIS: {
    code: 9302,
    rule: "unbalanced-branch-parenthesis",
    severity: "error" as DiagnosticSeverity,
    message: (moleculeName: string) => `Branch parenthesis in '${moleculeName}' is unbalanced.`,
  },
  VALENCE_EXCEEDED: {
    code: 9303,
    rule: "valence-exceeded",
    severity: "error" as DiagnosticSeverity,
    message: (
      element: string,
      atomIndex: number | string,
      moleculeName: string,
      actualValence: number | string,
      maxValence: number | string,
    ) =>
      `Atom '${element}' (index '${atomIndex}') in '${moleculeName}' has bond order sum '${actualValence}' exceeding maximum allowed valence '${maxValence}'.`,
  },
  INVALID_AROMATIC_KEKULE_RING: {
    code: 9304,
    rule: "invalid-aromatic-kekule-ring",
    severity: "error" as DiagnosticSeverity,
    message: (moleculeName: string) =>
      `Aromatic ring in '${moleculeName}' violates Hückel's 4n+2 pi-electron rule or cannot be Kekulized.`,
  },
  UNKNOWN_CHEMICAL_ELEMENT: {
    code: 9305,
    rule: "unknown-chemical-element",
    severity: "error" as DiagnosticSeverity,
    message: (symbol: string, moleculeName: string) =>
      `Atomic symbol '${symbol}' in '${moleculeName}' is not a valid IUPAC element.`,
  },
  CONFLICTING_RING_BOND_ORDER: {
    code: 9306,
    rule: "conflicting-ring-bond-order",
    severity: "error" as DiagnosticSeverity,
    message: (ringId: string | number, moleculeName: string) =>
      `Ring closure '${ringId}' in '${moleculeName}' specifies conflicting bond orders at opening and closing atoms.`,
  },
  SELF_LOOP_BOND: {
    code: 9307,
    rule: "self-loop-bond",
    severity: "error" as DiagnosticSeverity,
    message: (atomIndex: number | string, moleculeName: string) =>
      `Bond in '${moleculeName}' connects atom '${atomIndex}' to itself.`,
  },
  DUPLICATE_ATOM_BOND: {
    code: 9308,
    rule: "duplicate-atom-bond",
    severity: "error" as DiagnosticSeverity,
    message: (atomA: number | string, atomB: number | string, moleculeName: string) =>
      `Multiple bonds declared between identical atom pair ('${atomA}', '${atomB}') in '${moleculeName}'.`,
  },
  INVALID_TETRAHEDRAL_CHIRALITY: {
    code: 9309,
    rule: "invalid-tetrahedral-chirality",
    severity: "warning" as DiagnosticSeverity,
    message: (atomIndex: number | string, moleculeName: string) =>
      `Chiral center '${atomIndex}' in '${moleculeName}' has fewer than 4 distinct substituents.`,
  },
  EMPTY_MOLECULAR_GRAPH: {
    code: 9310,
    rule: "empty-molecular-graph",
    severity: "error" as DiagnosticSeverity,
    message: (moleculeName: string) => `Molecule entry '${moleculeName}' contains zero atoms.`,
  },
} as const;
