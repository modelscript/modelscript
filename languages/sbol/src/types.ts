// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * @modelscript/sbol — Synthetic Biology Open Language (SBOL3) AST & Data Types.
 *
 * Conforms to the SBOL 3.x specification for genetic circuit design, Sequence Ontology (SO)
 * feature roles, Systems Biology Ontology (SBO) molecular interactions, and transcriptional
 * regulatory networks.
 */

export interface SbolRange {
  startLine: number;
  startColumn: number;
  endLine: number;
  endColumn: number;
  startOffset: number;
  endOffset: number;
}

/**
 * Canonical Sequence Ontology (SO) role identifiers and human-readable aliases.
 * - SO:0000167: Promoter
 * - SO:0000139: Ribosome Entry Site (RBS)
 * - SO:0000316: Coding Sequence (CDS)
 * - SO:0000141: Terminator
 * - SO:0000804: Engineered Region
 * - SO:0000057: Operator
 */
export type SbolRole =
  | "SO:0000167"
  | "SO:0000139"
  | "SO:0000316"
  | "SO:0000141"
  | "SO:0000804"
  | "SO:0000057"
  | "promoter"
  | "rbs"
  | "cds"
  | "terminator"
  | "engineered_region"
  | "operator"
  | (string & {});

export const SEQUENCE_ONTOLOGY = {
  PROMOTER: "SO:0000167",
  RBS: "SO:0000139",
  CDS: "SO:0000316",
  TERMINATOR: "SO:0000141",
  ENGINEERED_REGION: "SO:0000804",
  OPERATOR: "SO:0000057",
} as const;

export const SYSTEMS_BIOLOGY_ONTOLOGY = {
  INHIBITION: "SBO:0000169",
  STIMULATION: "SBO:0000170",
  GENETIC_PRODUCTION: "SBO:0000589",
  DEGRADATION: "SBO:0000179",
  CONTROL: "SBO:0000168",
  INHIBITOR: "SBO:0000020",
  INHIBITED: "SBO:0000642",
  STIMULATOR: "SBO:0000459",
  STIMULATED: "SBO:0000643",
  PROMOTER_PARTICIPANT: "SBO:0000598",
  TEMPLATE: "SBO:0000645",
  PRODUCT: "SBO:0000011",
  REACTANT: "SBO:0000010",
} as const;

export interface SbolSequence {
  displayId: string;
  name?: string | undefined;
  namespace?: string | undefined;
  elements: string;
  encoding?: string | undefined; // e.g., "IUPAC_DNA" | "IUPAC_RNA" | "IUPAC_PROTEIN"
  range?: SbolRange | undefined;
}

export interface SbolFeature {
  displayId: string;
  name?: string | undefined;
  roles: SbolRole[];
  start?: number | undefined;
  end?: number | undefined;
  orientation?: "inline" | "reverseComplement" | undefined;
  sequenceId?: string | undefined;
  range?: SbolRange | undefined;
}

export interface SbolSubComponent {
  displayId: string;
  name?: string | undefined;
  instanceOf: string;
  roles?: SbolRole[] | undefined;
  start?: number | undefined;
  end?: number | undefined;
  orientation?: "inline" | "reverseComplement" | undefined;
  sequenceId?: string | undefined;
  range?: SbolRange | undefined;
}

export interface SbolConstraint {
  displayId?: string | undefined;
  subject: string;
  object: string;
  restriction: "precedes" | "sameOrientationAs" | "oppositeOrientationAs" | "meets" | (string & {});
  range?: SbolRange | undefined;
}

export type SbolInteractionType =
  | "inhibition"
  | "stimulation"
  | "genetic_production"
  | "degradation"
  | "control"
  | "biochemical_reaction";

export type SbolParticipationRole =
  | "inhibitor"
  | "inhibited"
  | "stimulator"
  | "stimulated"
  | "template"
  | "product"
  | "reactant"
  | "modifier"
  | "degraded"
  | "promoter"
  | (string & {});

export interface SbolParticipation {
  displayId?: string | undefined;
  participant: string;
  roles: SbolParticipationRole[];
  range?: SbolRange | undefined;
}

export interface SbolInteraction {
  displayId: string;
  name?: string | undefined;
  type: SbolInteractionType;
  participants: SbolParticipation[];
  /**
   * Optional kinetic parameters for regulatory/production interactions:
   * - K (dissociation/Hill threshold constant, default 1.0)
   * - n (Hill cooperativity coefficient, default 2.0)
   * - alpha (maximal activated/repressed transcription/production rate, default 10.0)
   * - alpha0 / basal (basal leaky expression rate, default 0.01)
   * - gamma / kd (degradation rate constant, default 0.1)
   */
  parameters: Record<string, number>;
  range?: SbolRange | undefined;
}

export interface SbolComponent {
  displayId: string;
  name?: string | undefined;
  description?: string | undefined;
  namespace?: string | undefined;
  types: string[]; // e.g. ["SBO:0000251" (DNA), "SBO:0000252" (Protein), "SBO:0000250" (RNA)]
  roles: SbolRole[];
  sequences: string[];
  features: SbolFeature[];
  subComponents: SbolSubComponent[];
  constraints: SbolConstraint[];
  interactions: SbolInteraction[];
  initialConcentration?: number | undefined;
  basalRate?: number | undefined;
  maxExpressionRate?: number | undefined;
  degradationRate?: number | undefined;
  range?: SbolRange | undefined;
}

export interface SbolDocument {
  namespace: string;
  components: SbolComponent[];
  sequences: SbolSequence[];
  interactions: SbolInteraction[];
  sourceFile?: string | undefined;
}
