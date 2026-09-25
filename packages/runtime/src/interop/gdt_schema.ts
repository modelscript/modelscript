// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * STEP AP242 Semantic GD&T (Geometric Dimensioning and Tolerancing) Schema.
 *
 * Implements ASME Y14.5 / ISO 1101 semantic tolerances for cyber-physical digital thread
 * and formal tolerance stack-up analysis.
 */

export type FormToleranceType = "flatness" | "straightness" | "circularity" | "cylindricity";
export type OrientationToleranceType = "perpendicularity" | "parallelism" | "angularity";
export type LocationToleranceType = "position" | "concentricity" | "symmetry";
export type ProfileToleranceType = "surface_profile" | "line_profile";
export type RunoutToleranceType = "circular_runout" | "total_runout";

export type GdtToleranceType =
  | FormToleranceType
  | OrientationToleranceType
  | LocationToleranceType
  | ProfileToleranceType
  | RunoutToleranceType
  | "linear_dimension"
  | "diameter";

export type MaterialCondition = "RFS" | "MMC" | "LMC";

export interface GdtDatum {
  label: string; // e.g. "A", "B", "C"
  partId: string;
  featureName: string;
  featureType: "plane" | "cylinder" | "axis" | "point";
  precedence?: number; // 1 = primary, 2 = secondary, 3 = tertiary
}

export interface GdtToleranceSpecification {
  id: string;
  partId: string;
  featureName: string;
  type: GdtToleranceType;
  nominalValue: number;
  plusTolerance: number;
  minusTolerance: number;
  materialCondition?: MaterialCondition;
  datumReferences?: string[];
  zoneShape?: "planar" | "cylindrical" | "spherical";
  unit?: "mm" | "m" | "inch";
}

export interface StackDimensionContributor {
  partId: string;
  featureName: string;
  direction: 1 | -1; // +1 increases gap, -1 decreases gap
  nominal: number;
  tolerance: number; // bilateral ±tolerance value (e.g. 0.025 mm)
  cpk?: number; // Process capability index (default 1.33 for standard manufacturing)
}

export interface ToleranceChainSpec {
  chainId: string;
  name: string;
  contributors: StackDimensionContributor[];
  targetClearance: {
    min: number; // e.g. 0.010 mm (minimum required to prevent interference / seizure)
    max: number; // e.g. 0.080 mm (maximum allowed to prevent pressure loss / vibration)
    name?: string;
  };
  method?: "worst_case" | "rss" | "six_sigma";
}

export interface ToleranceStackResult {
  chainId: string;
  nominalClearance: number;
  variation: number;
  minClearance: number;
  maxClearance: number;
  isSatisfied: boolean;
  violation?: "interference" | "excessive_play";
  method: "worst_case" | "rss" | "six_sigma";
  topContributors: {
    partId: string;
    featureName: string;
    tolerance: number;
    percentContribution: number;
  }[];
}
