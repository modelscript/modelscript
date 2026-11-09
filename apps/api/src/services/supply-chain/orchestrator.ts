// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Supply Chain Sourcing Orchestrator.
 *
 * Coordinates multi-tier sourcing across:
 *   - Local TTL memory cache
 *   - Tier 1: Nexar / Octopart Aggregator (broad market parametric sweep)
 *   - Tier 2: Direct Franchised Distributors (Digi-Key v4 & Mouser API v1)
 *
 * Performs BOM scrubbing, risk assessment, price break optimization,
 * and automated alternate qualification.
 */

import { DigiKeyConnector } from "./digikey-connector.js";
import { MouserConnector } from "./mouser-connector.js";
import { NexarConnector } from "./nexar-connector.js";
import type {
  BOMComponentInput,
  BOMScrubResult,
  ComponentSourcingPlan,
  DistributorQuote,
  SourcingCacheEntry,
  SupplyChainRiskFlag,
} from "./types.js";

export interface OrchestratorOptions {
  cacheTtlMs?: number | undefined;
  nexarConnector?: NexarConnector | undefined;
  digiKeyConnector?: DigiKeyConnector | undefined;
  mouserConnector?: MouserConnector | undefined;
}

export class SupplyChainOrchestrator {
  private cache = new Map<string, SourcingCacheEntry>();
  private cacheTtlMs: number;
  private nexar: NexarConnector;
  private digiKey: DigiKeyConnector;
  private mouser: MouserConnector;

  constructor(options?: OrchestratorOptions) {
    this.cacheTtlMs = options?.cacheTtlMs ?? 24 * 60 * 60 * 1000; // 24 hours default TTL
    this.nexar = options?.nexarConnector ?? new NexarConnector();
    this.digiKey = options?.digiKeyConnector ?? new DigiKeyConnector();
    this.mouser = options?.mouserConnector ?? new MouserConnector();
  }

  /**
   * Clears the in-memory sourcing cache.
   */
  clearCache(): void {
    this.cache.clear();
  }

  /**
   * Retrieves quotes for a single MPN across all tiers with caching.
   */
  async getQuotesForPart(mpn: string): Promise<DistributorQuote[]> {
    const key = mpn.trim().toUpperCase();
    const cached = this.cache.get(key);
    const now = Date.now();

    if (cached && now - cached.cachedAt < cached.ttlMs) {
      return cached.quotes;
    }

    // Query connectors concurrently
    const [nexarQuotes, dkQuotes, mouserQuotes] = await Promise.all([
      this.nexar.searchPart(mpn).catch(() => []),
      this.digiKey.searchPart(mpn).catch(() => []),
      this.mouser.searchPart(mpn).catch(() => []),
    ]);

    const combined: DistributorQuote[] = [...dkQuotes, ...mouserQuotes, ...nexarQuotes];

    // Deduplicate by distributor + SKU
    const seen = new Set<string>();
    const uniqueQuotes: DistributorQuote[] = [];
    for (const q of combined) {
      const qKey = `${q.distributor}:${q.sku}`;
      if (!seen.has(qKey)) {
        seen.add(qKey);
        uniqueQuotes.push(q);
      }
    }

    this.cache.set(key, {
      quotes: uniqueQuotes,
      cachedAt: now,
      ttlMs: this.cacheTtlMs,
    });

    return uniqueQuotes;
  }

  /**
   * Scrubs a complete BOM for a target production quantity.
   */
  async scrubBOM(components: BOMComponentInput[], targetQuantity = 1000): Promise<BOMScrubResult> {
    const grouped = new Map<string, { refDes: string[]; input: BOMComponentInput }>();

    for (const comp of components) {
      const mpn = comp.mpn.trim();
      let entry = grouped.get(mpn);
      if (!entry) {
        entry = { refDes: [], input: comp };
        grouped.set(mpn, entry);
      }
      entry.refDes.push(comp.refDes);
    }

    const plans: ComponentSourcingPlan[] = [];
    let grandTotalPrice = 0;
    let outOfStockCount = 0;
    let eolCount = 0;
    let longLeadTimeCount = 0;
    let singleSourcedCount = 0;

    for (const [mpn, { refDes, input }] of grouped) {
      const totalPartQty = refDes.length * targetQuantity;
      const quotes = await this.getQuotesForPart(mpn);

      // Select optimal quote based on in-stock and lowest unit price at target volume
      const bestQuote = this.selectOptimalQuote(quotes, totalPartQty);
      const riskFlags: SupplyChainRiskFlag[] = [];

      if (!bestQuote || bestQuote.stockAvailable === 0) {
        riskFlags.push("OUT_OF_STOCK");
        outOfStockCount++;
      } else if (bestQuote.stockAvailable < totalPartQty) {
        riskFlags.push("LOW_STOCK");
      }

      if (bestQuote && bestQuote.leadTimeWeeks !== null && bestQuote.leadTimeWeeks > 16) {
        riskFlags.push("LONG_LEAD_TIME");
        longLeadTimeCount++;
      }

      if (bestQuote) {
        if (bestQuote.lifecycleStatus === "EOL") {
          riskFlags.push("EOL");
          eolCount++;
        } else if (bestQuote.lifecycleStatus === "NRND") {
          riskFlags.push("NRND");
        } else if (bestQuote.lifecycleStatus === "Obsolete") {
          riskFlags.push("OBSOLETE");
          eolCount++;
        }
      }

      // Check alternates
      const qualifiedAlternates: ComponentSourcingPlan["qualifiedAlternates"] = [];
      for (const altMpn of input.approvedAlternates ?? []) {
        const altQuotes = await this.getQuotesForPart(altMpn);
        const bestAlt = this.selectOptimalQuote(altQuotes, totalPartQty);
        if (bestAlt) {
          qualifiedAlternates.push({
            mpn: altMpn,
            manufacturer: bestAlt.manufacturer,
            stockAvailable: bestAlt.stockAvailable,
            unitPrice: this.calculateEffectiveUnitPrice(bestAlt, totalPartQty),
            qualificationStatus: "DROP_IN_QUALIFIED",
          });
        }
      }

      if (qualifiedAlternates.length === 0) {
        riskFlags.push("SINGLE_SOURCED");
        singleSourcedCount++;
      }

      const unitPrice = bestQuote ? this.calculateEffectiveUnitPrice(bestQuote, totalPartQty) : 0;
      const extPrice = unitPrice * totalPartQty;
      grandTotalPrice += extPrice;

      plans.push({
        refDes,
        requestedMpn: mpn,
        totalQuantity: totalPartQty,
        selectedQuote: bestQuote,
        allQuotes: quotes,
        extendedPrice: extPrice,
        riskFlags,
        qualifiedAlternates,
      });
    }

    // Health Score calculation (0 to 100)
    let penalty = 0;
    penalty += outOfStockCount * 25;
    penalty += eolCount * 20;
    penalty += longLeadTimeCount * 10;
    penalty += singleSourcedCount * 5;
    const healthScore = Math.max(0, Math.min(100, 100 - penalty));

    return {
      targetBuildQuantity: targetQuantity,
      timestamp: new Date().toISOString(),
      totalComponents: components.length,
      uniqueParts: grouped.size,
      totalExtendedPrice: grandTotalPrice,
      overallHealthScore: healthScore,
      riskSummary: {
        outOfStockCount,
        eolCount,
        longLeadTimeCount,
        singleSourcedCount,
      },
      componentPlans: plans,
    };
  }

  private selectOptimalQuote(quotes: DistributorQuote[], quantity: number): DistributorQuote | null {
    if (quotes.length === 0) return null;

    // Prefer quotes that have sufficient stock
    const inStock = quotes.filter((q) => q.stockAvailable >= quantity);
    const candidates = inStock.length > 0 ? inStock : quotes;

    // Sort by effective unit price at target volume
    candidates.sort((a, b) => {
      const priceA = this.calculateEffectiveUnitPrice(a, quantity);
      const priceB = this.calculateEffectiveUnitPrice(b, quantity);
      return priceA - priceB;
    });

    return candidates[0] ?? null;
  }

  private calculateEffectiveUnitPrice(quote: DistributorQuote, quantity: number): number {
    if (!quote.priceBreaks || quote.priceBreaks.length === 0) {
      return 1.0;
    }

    // Find highest tier <= quantity
    let effective = quote.priceBreaks[0]!.unitPrice;
    for (const pb of quote.priceBreaks) {
      if (quantity >= pb.quantity) {
        effective = pb.unitPrice;
      }
    }
    return effective;
  }
}
