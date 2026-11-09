// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Supply Chain & Sourcing Data Types.
 *
 * Defines normalized models for distributor pricing, inventory, lifecycle status,
 * and multi-level BOM scrubbing across aggregators and direct franchised distributors.
 */

export type DistributorName =
  | "DigiKey"
  | "Mouser"
  | "Arrow"
  | "Avnet"
  | "Future"
  | "Newark"
  | "OctopartAggregated"
  | "MockDistributor";

export type ComponentLifecycleStatus =
  | "Active"
  | "NRND" // Not Recommended for New Designs
  | "EOL" // End of Life
  | "Obsolete"
  | "Discontinued"
  | "Unknown";

export type SupplyChainRiskFlag =
  | "OUT_OF_STOCK"
  | "LOW_STOCK"
  | "LONG_LEAD_TIME"
  | "NRND"
  | "EOL"
  | "OBSOLETE"
  | "SINGLE_SOURCED"
  | "NO_QUOTES_FOUND";

export interface PriceBreak {
  quantity: number;
  unitPrice: number;
}

export interface DistributorQuote {
  distributor: DistributorName;
  sku: string;
  mpn: string;
  manufacturer: string;
  stockAvailable: number;
  packaging: "Cut Tape" | "Tape & Reel" | "Tube" | "Tray" | "Bulk" | "Unknown";
  minimumOrderQuantity: number;
  orderMultiple: number;
  leadTimeWeeks: number | null;
  priceBreaks: PriceBreak[];
  currency: string;
  productUrl: string;
  datasheetUrl?: string | undefined;
  rohsCompliant: boolean;
  lifecycleStatus: ComponentLifecycleStatus;
  fetchedAt: string;
}

export interface BOMComponentInput {
  refDes: string;
  mpn: string;
  quantity?: number | undefined;
  footprint?: string | undefined;
  value?: string | undefined;
  description?: string | undefined;
  approvedAlternates?: string[] | undefined;
}

export interface ComponentSourcingPlan {
  refDes: string[];
  requestedMpn: string;
  totalQuantity: number;
  selectedQuote: DistributorQuote | null;
  allQuotes: DistributorQuote[];
  extendedPrice: number;
  riskFlags: SupplyChainRiskFlag[];
  qualifiedAlternates: {
    mpn: string;
    manufacturer: string;
    stockAvailable: number;
    unitPrice: number;
    qualificationStatus: "DROP_IN_QUALIFIED" | "PIN_COMPATIBLE" | "REQUIRES_REVIEW";
  }[];
}

export interface BOMScrubResult {
  projectName?: string | undefined;
  revision?: string | undefined;
  targetBuildQuantity: number;
  timestamp: string;
  totalComponents: number;
  uniqueParts: number;
  totalExtendedPrice: number;
  overallHealthScore: number; // 0 - 100
  riskSummary: {
    outOfStockCount: number;
    eolCount: number;
    longLeadTimeCount: number;
    singleSourcedCount: number;
  };
  componentPlans: ComponentSourcingPlan[];
}

export interface SourcingCacheEntry {
  quotes: DistributorQuote[];
  cachedAt: number;
  ttlMs: number;
}
