// SPDX-License-Identifier: AGPL-3.0-or-later

import type { Point2D, RenderPad, RenderTrace, RenderVia } from "@modelscript/cad";

export interface PcbDesignData {
  boardName?: string;
  revision: string;
  boardOutline: Point2D[];
  traces: RenderTrace[];
  pads: RenderPad[];
  vias: RenderVia[];
  layers?: string[];
}

export type DiffStatus = "unchanged" | "added" | "removed" | "modified";

export interface DiffFeature<T> {
  status: DiffStatus;
  feature: T;
  oldFeature?: T;
  changeSummary?: string;
}

export interface PcbDiffResult {
  traces: DiffFeature<RenderTrace>[];
  pads: DiffFeature<RenderPad>[];
  vias: DiffFeature<RenderVia>[];
  summary: {
    addedTraces: number;
    removedTraces: number;
    modifiedTraces: number;
    addedPads: number;
    removedPads: number;
    addedVias: number;
    removedVias: number;
    netChanges: {
      addedNets: string[];
      removedNets: string[];
    };
  };
}

export interface EngineeringQuerySignOff {
  userId: string;
  userName: string;
  role: "oem_engineer" | "cm_dfm" | "quality_lead";
  approved: boolean;
  timestamp: string;
  notes?: string;
}

export interface EngineeringQueryItem {
  id: string;
  spaceId?: string;
  title: string;
  description: string;
  category: "dfm" | "dfa" | "sourcing" | "test" | "other";
  status: "open" | "under_review" | "approved_deviation" | "rejected" | "resolved";
  severity: "critical" | "major" | "minor" | "info";
  location?: {
    x: number;
    y: number;
    layer?: string;
  };
  componentRef?: string;
  suggestedRemedy?: string;
  author: string;
  assignedTo?: string;
  createdAt: string;
  updatedAt: string;
  signOffs?: EngineeringQuerySignOff[];
}

export interface BomRedlineItem {
  designators: string[];
  quantityRevA?: number;
  quantityRevB?: number;
  mpnRevA?: string;
  mpnRevB?: string;
  manufacturerRevA?: string;
  manufacturerRevB?: string;
  description: string;
  packageRevA?: string;
  packageRevB?: string;
  status: DiffStatus;
  lifecycleStatus?: "ACTIVE" | "NRND" | "EOL" | "OBSOLETE" | "UNKNOWN";
  stockAvailable?: number;
  leadTimeWeeks?: number;
  unitPriceRevA?: number;
  unitPriceRevB?: number;
  alternatesCount?: number;
  notes?: string;
}

export interface BomRedlineSummary {
  totalItemsRevA: number;
  totalItemsRevB: number;
  addedCount: number;
  removedCount: number;
  modifiedCount: number;
  unchangedCount: number;
  totalCostRevA: number;
  totalCostRevB: number;
  costDelta: number;
  riskCount: number;
}
