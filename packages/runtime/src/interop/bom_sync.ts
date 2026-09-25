// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * eBOM <-> mBOM Cost, Mass, and Embodied Carbon Synchronization Engine.
 *
 * Federates SysML v2 part definitions and FEA structural materials with
 * manufacturing processes, procurement costs, and Life Cycle Assessment (LCA) carbon footprints.
 */

import { DigitalThreadHypergraph, ThreadDomain, ThreadRelation } from "./thread_hypergraph.js";

export interface MaterialLcaData {
  name: string;
  densityKgM3: number;
  costPerKgUsd: number;
  embodiedCarbonKgCo2ePerKg: number; // Cradle-to-gate carbon intensity
}

export interface ManufacturingProcessData {
  name: string;
  processCarbonPerKg: number; // Direct energy carbon emissions
  processCostPerKg: number;
  scrapFactor: number; // Ratio of material lost as chips/sprues (e.g. 0.4 for CNC)
}

export const STANDARD_MATERIALS: Record<string, MaterialLcaData> = {
  ALUMINUM_6061: {
    name: "Aluminum 6061-T6",
    densityKgM3: 2700,
    costPerKgUsd: 4.8,
    embodiedCarbonKgCo2ePerKg: 8.9,
  },
  ALUMINUM_7075: {
    name: "Aluminum 7075-T6",
    densityKgM3: 2810,
    costPerKgUsd: 8.5,
    embodiedCarbonKgCo2ePerKg: 10.4,
  },
  STEEL_316L: {
    name: "Stainless Steel 316L",
    densityKgM3: 8000,
    costPerKgUsd: 4.2,
    embodiedCarbonKgCo2ePerKg: 2.9,
  },
  TITANIUM_TI6AL4V: {
    name: "Titanium Grade 5 (Ti-6Al-4V)",
    densityKgM3: 4430,
    costPerKgUsd: 48.0,
    embodiedCarbonKgCo2ePerKg: 36.5,
  },
  CARBON_FIBER_CFRP: {
    name: "Carbon Fiber Reinforced Polymer",
    densityKgM3: 1550,
    costPerKgUsd: 65.0,
    embodiedCarbonKgCo2ePerKg: 24.0,
  },
  PEEK_POLYMER: {
    name: "Polyether Ether Ketone (PEEK)",
    densityKgM3: 1300,
    costPerKgUsd: 88.0,
    embodiedCarbonKgCo2ePerKg: 14.5,
  },
};

export const STANDARD_PROCESSES: Record<string, ManufacturingProcessData> = {
  cnc_machining: {
    name: "CNC 5-Axis Milling",
    processCarbonPerKg: 2.1,
    processCostPerKg: 18.0,
    scrapFactor: 0.45,
  },
  sheet_metal: {
    name: "Sheet Metal Stamping & Bending",
    processCarbonPerKg: 0.6,
    processCostPerKg: 4.5,
    scrapFactor: 0.12,
  },
  additive_3d: {
    name: "Laser Powder Bed Fusion (LPBF)",
    processCarbonPerKg: 9.5,
    processCostPerKg: 45.0,
    scrapFactor: 0.05,
  },
  injection_molding: {
    name: "High-Pressure Injection Molding",
    processCarbonPerKg: 0.8,
    processCostPerKg: 2.5,
    scrapFactor: 0.03,
  },
};

export interface BomLineItem {
  id: string;
  sysmlPart: string;
  description: string;
  quantity: number;
  material: string;
  volumeM3?: number;
  massKg: number;
  unitCostUsd?: number;
  process?: string;
  embodiedCarbonKgCo2e?: number;
  supplierPartNumber?: string;
}

export interface BomSummary {
  totalMassKg: number;
  totalCostUsd: number;
  totalEmbodiedCarbonKgCo2e: number;
  itemCount: number;
}

export class BomSyncManager {
  private items = new Map<string, BomLineItem>();

  public registerItem(item: BomLineItem): void {
    const enriched = this.recalculateItem(item);
    this.items.set(enriched.id, enriched);
  }

  public getItem(id: string): BomLineItem | undefined {
    return this.items.get(id);
  }

  public getAllItems(): BomLineItem[] {
    return Array.from(this.items.values());
  }

  /**
   * Updates the material of a part and returns the delta cost, carbon, and mass.
   */
  public updateItemMaterial(
    itemId: string,
    newMaterial: string,
  ): { deltaCost: number; deltaCarbon: number; deltaMass: number } {
    const existing = this.items.get(itemId);
    if (!existing) {
      throw new Error(`BOM item '${itemId}' not found`);
    }

    const prevCost = (existing.unitCostUsd || 0) * existing.quantity;
    const prevCarbon = (existing.embodiedCarbonKgCo2e || 0) * existing.quantity;
    const prevMass = existing.massKg * existing.quantity;

    existing.material = newMaterial;
    if (existing.volumeM3 && STANDARD_MATERIALS[newMaterial]) {
      existing.massKg = existing.volumeM3 * STANDARD_MATERIALS[newMaterial].densityKgM3;
    }

    const updated = this.recalculateItem(existing);
    this.items.set(itemId, updated);

    const newCost = (updated.unitCostUsd || 0) * updated.quantity;
    const newCarbon = (updated.embodiedCarbonKgCo2e || 0) * updated.quantity;
    const newMass = updated.massKg * updated.quantity;

    return {
      deltaCost: newCost - prevCost,
      deltaCarbon: newCarbon - prevCarbon,
      deltaMass: newMass - prevMass,
    };
  }

  private recalculateItem(item: BomLineItem): BomLineItem {
    const matKey = item.material.toUpperCase().replace(/[\s-]/g, "_");
    const mat = STANDARD_MATERIALS[matKey] || STANDARD_MATERIALS.ALUMINUM_6061;
    const procKey = (item.process || "cnc_machining").toLowerCase().replace(/[\s-]/g, "_");
    const proc = STANDARD_PROCESSES[procKey] || STANDARD_PROCESSES.cnc_machining;

    let mass = item.massKg;
    if (item.volumeM3 && item.volumeM3 > 0) {
      mass = item.volumeM3 * mat.densityKgM3;
    }

    const rawMaterialWeight = mass * (1 + proc.scrapFactor);
    const materialCost = rawMaterialWeight * mat.costPerKgUsd;
    const processCost = mass * proc.processCostPerKg;
    const unitCost = materialCost + processCost;

    const materialCarbon = rawMaterialWeight * mat.embodiedCarbonKgCo2ePerKg;
    const processCarbon = mass * proc.processCarbonPerKg;
    const totalCarbon = materialCarbon + processCarbon;

    return {
      ...item,
      massKg: mass,
      unitCostUsd: parseFloat(unitCost.toFixed(2)),
      embodiedCarbonKgCo2e: parseFloat(totalCarbon.toFixed(3)),
    };
  }

  public getSummary(): BomSummary {
    let totalMassKg = 0;
    let totalCostUsd = 0;
    let totalEmbodiedCarbonKgCo2e = 0;

    for (const item of this.items.values()) {
      totalMassKg += item.massKg * item.quantity;
      totalCostUsd += (item.unitCostUsd || 0) * item.quantity;
      totalEmbodiedCarbonKgCo2e += (item.embodiedCarbonKgCo2e || 0) * item.quantity;
    }

    return {
      totalMassKg: parseFloat(totalMassKg.toFixed(3)),
      totalCostUsd: parseFloat(totalCostUsd.toFixed(2)),
      totalEmbodiedCarbonKgCo2e: parseFloat(totalEmbodiedCarbonKgCo2e.toFixed(2)),
      itemCount: this.items.size,
    };
  }

  public bindToHypergraph(hypergraph: DigitalThreadHypergraph, baseThreadId = 90000): void {
    let idx = 0;
    for (const item of this.items.values()) {
      const threadId = baseThreadId + idx++;
      const slot = hypergraph.createThread(threadId, 0, ThreadRelation.AllocatesTo, 0);

      const sysmlId = Math.abs(this.hashString(item.sysmlPart));
      const bomId = Math.abs(this.hashString(item.id));
      const mfgId = Math.abs(this.hashString(item.process || "cnc"));

      hypergraph.bindDomainNode(slot, ThreadDomain.SysML2, sysmlId);
      hypergraph.bindDomainNode(slot, ThreadDomain.BOM, bomId);
      hypergraph.bindDomainNode(slot, ThreadDomain.Manufacturing, mfgId);
      hypergraph.bindDomainNode(slot, ThreadDomain.CostCarbon, Math.round(item.unitCostUsd || 1));
    }
  }

  private hashString(str: string): number {
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
      hash = (hash << 5) - hash + str.charCodeAt(i);
      hash |= 0;
    }
    return hash;
  }
}
