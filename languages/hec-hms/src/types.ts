// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Types and structures for USACE HEC-HMS watershed models (.hms, .basin, .met).
 */

export type HmsUnitSystem = "Metric" | "U.S. Customary";

export interface HmsSubbasin {
  name: string;
  area: number; // km^2 (Metric) or mi^2 (English)
  downstream: string;
  lossMethod?: string | undefined;
  transformMethod?: string | undefined;
  baseflowMethod?: string | undefined;
  curveNumber?: number | undefined; // 0 - 100
  initialAbstraction?: number | undefined; // mm or in
  imperviousPercent?: number | undefined; // 0 - 100%
  lagMinutes?: number | undefined;
  timeOfConcentrationHours?: number | undefined;
  storageCoefficientHours?: number | undefined;
}

export interface HmsReach {
  name: string;
  downstream: string;
  routingMethod?: string | undefined;
  muskingumK?: number | undefined; // hours
  muskingumX?: number | undefined; // 0.0 - 0.5
  subreaches?: number | undefined;
}

export interface HmsJunction {
  name: string;
  downstream: string;
}

export interface HmsReservoir {
  name: string;
  downstream: string;
  initialStorage?: number | undefined;
  storageDischargeCurve?: Array<{ storage: number; outflow: number }> | undefined;
}

export interface HmsSink {
  name: string;
}

export interface HmsBasinModel {
  name: string;
  unitSystem: HmsUnitSystem;
  subbasins: Map<string, HmsSubbasin>;
  reaches: Map<string, HmsReach>;
  junctions: Map<string, HmsJunction>;
  reservoirs: Map<string, HmsReservoir>;
  sinks: Map<string, HmsSink>;
}

export interface HmsHydrographPoint {
  timeHours: number;
  flow: number; // m^3/s (Metric) or cfs (English)
}

export interface HmsRunResult {
  basinName: string;
  outletName: string;
  peakDischarge: number;
  timeToPeakHours: number;
  totalVolume: number;
  hydrograph: HmsHydrographPoint[];
}
