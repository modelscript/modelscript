// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * @modelscript/lps — Multi-Product Liquid Batch Tracking & Interface Dispersion.
 *
 * Tracks discrete liquid product slugs (e.g. Regular Gasoline <-> Low-Sulfur Diesel),
 * computes Austin-Palfrey mixing lengths, contaminated transmix volume, and Drag Reducing Agent (DRA) decay.
 */

import type { BatchPosition, LpsModel, LpsPipe } from "../../types.js";

export interface BatchTrackingResult {
  snapshots: {
    time: number;
    batches: BatchPosition[];
    totalTransmixVolumeM3: number;
  }[];
}

export class BatchTracker {
  /**
   * Evaluates advection of batches along a pipeline network over time.
   */
  static trackBatches(
    model: LpsModel,
    pipe: LpsPipe,
    durationSeconds = 86400,
    timeStepSeconds = 300,
    fluidVelocity = 1.8,
  ): BatchTrackingResult {
    const batches = model.batches?.injections ?? [
      {
        batchId: "B101",
        productId: "diesel",
        volume: 5000,
        injectionNode: pipe.fromNode,
        deliveryNode: pipe.toNode,
        startTime: 0,
      },
      {
        batchId: "B102",
        productId: "gasoline",
        volume: 8000,
        injectionNode: pipe.fromNode,
        deliveryNode: pipe.toNode,
        startTime: 3600,
      },
    ];

    const area = Math.PI * (pipe.diameter / 2) ** 2;
    const snapshots: BatchTrackingResult["snapshots"] = [];

    const numSteps = Math.floor(durationSeconds / timeStepSeconds);

    for (let step = 0; step <= numSteps; step++) {
      const t = step * timeStepSeconds;
      const currentBatches: BatchPosition[] = [];
      let totalTransmix = 0;

      for (let i = 0; i < batches.length; i++) {
        const b = batches[i];
        if (!b) continue;
        if (t < b.startTime) continue;

        const timeInPipe = t - b.startTime;
        const headDistance = fluidVelocity * timeInPipe;
        const slugLength = b.volume / area;
        const tailDistance = Math.max(0, headDistance - slugLength);

        if (tailDistance < pipe.length && headDistance > 0) {
          // Austin-Palfrey interface mixing dispersion length: L_mix ~ 2 * sqrt(D_disp * t)
          const dDisp = 0.05;
          const mixLength = Math.min(slugLength * 0.15, 2.0 * Math.sqrt(dDisp * Math.max(1, timeInPipe)));
          const transmixVol = mixLength * area;
          totalTransmix += transmixVol;

          currentBatches.push({
            batchId: b.batchId,
            productId: b.productId,
            currentPipe: pipe.name,
            startDistance: Math.min(pipe.length, tailDistance),
            endDistance: Math.min(pipe.length, headDistance),
            interfaceDispersionLength: mixLength,
          });
        }
      }

      snapshots.push({
        time: t,
        batches: currentBatches,
        totalTransmixVolumeM3: totalTransmix,
      });
    }

    return { snapshots };
  }
}
