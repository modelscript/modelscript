// SPDX-License-Identifier: AGPL-3.0-or-later

import type { RenderPad, RenderTrace, RenderVia } from "@modelscript/cad";
import type { DiffFeature, PcbDesignData, PcbDiffResult } from "./types.js";

function floatEq(a: number, b: number, eps = 0.01): boolean {
  return Math.abs(a - b) <= eps;
}

export function computePcbDiff(revA: PcbDesignData, revB: PcbDesignData): PcbDiffResult {
  // ── 1. Trace Diffing ──
  const diffTraces: DiffFeature<RenderTrace>[] = [];
  const usedTracesA = new Set<number>();

  for (let i = 0; i < revB.traces.length; i++) {
    const tb = revB.traces[i];
    let matchIdx = -1;
    let isIdentical = false;

    for (let j = 0; j < revA.traces.length; j++) {
      if (usedTracesA.has(j)) continue;
      const ta = revA.traces[j];

      if (ta.layer === tb.layer && ta.points.length === tb.points.length) {
        let ptsMatch = true;
        for (let p = 0; p < tb.points.length; p++) {
          if (!floatEq(ta.points[p].x, tb.points[p].x) || !floatEq(ta.points[p].y, tb.points[p].y)) {
            ptsMatch = false;
            break;
          }
        }
        if (ptsMatch) {
          matchIdx = j;
          if (floatEq(ta.width, tb.width) && ta.netId === tb.netId) {
            isIdentical = true;
          }
          break;
        }
      }
    }

    if (matchIdx !== -1) {
      usedTracesA.add(matchIdx);
      const ta = revA.traces[matchIdx];
      if (isIdentical) {
        diffTraces.push({ status: "unchanged", feature: tb });
      } else {
        diffTraces.push({
          status: "modified",
          feature: tb,
          oldFeature: ta,
          changeSummary: `Width: ${ta.width}mm -> ${tb.width}mm, Net: ${ta.netId} -> ${tb.netId}`,
        });
      }
    } else {
      diffTraces.push({ status: "added", feature: tb, changeSummary: `New trace on ${tb.layer} (Net: ${tb.netId})` });
    }
  }

  // Any remaining in revA were removed
  for (let j = 0; j < revA.traces.length; j++) {
    if (!usedTracesA.has(j)) {
      const ta = revA.traces[j];
      diffTraces.push({
        status: "removed",
        feature: ta,
        changeSummary: `Removed trace from ${ta.layer} (Net: ${ta.netId})`,
      });
    }
  }

  // ── 2. Pad Diffing ──
  const diffPads: DiffFeature<RenderPad>[] = [];
  const usedPadsA = new Set<number>();

  for (let i = 0; i < revB.pads.length; i++) {
    const pb = revB.pads[i];
    let matchIdx = -1;
    let isIdentical = false;

    for (let j = 0; j < revA.pads.length; j++) {
      if (usedPadsA.has(j)) continue;
      const pa = revA.pads[j];

      // Match by component + pinName or location
      const samePin = pa.component === pb.component && pa.pinName === pb.pinName;
      const sameLoc = floatEq(pa.center.x, pb.center.x) && floatEq(pa.center.y, pb.center.y) && pa.layer === pb.layer;

      if (samePin || sameLoc) {
        matchIdx = j;
        if (
          floatEq(pa.center.x, pb.center.x) &&
          floatEq(pa.center.y, pb.center.y) &&
          floatEq(pa.width, pb.width) &&
          floatEq(pa.height, pb.height) &&
          pa.shape === pb.shape &&
          pa.netId === pb.netId
        ) {
          isIdentical = true;
        }
        break;
      }
    }

    if (matchIdx !== -1) {
      usedPadsA.add(matchIdx);
      const pa = revA.pads[matchIdx];
      if (isIdentical) {
        diffPads.push({ status: "unchanged", feature: pb });
      } else {
        diffPads.push({
          status: "modified",
          feature: pb,
          oldFeature: pa,
          changeSummary: `${pb.component}.${pb.pinName} pad modified (${pa.width}x${pa.height} -> ${pb.width}x${pb.height})`,
        });
      }
    } else {
      diffPads.push({ status: "added", feature: pb, changeSummary: `Added pad ${pb.component}.${pb.pinName}` });
    }
  }

  for (let j = 0; j < revA.pads.length; j++) {
    if (!usedPadsA.has(j)) {
      const pa = revA.pads[j];
      diffPads.push({ status: "removed", feature: pa, changeSummary: `Removed pad ${pa.component}.${pa.pinName}` });
    }
  }

  // ── 3. Via Diffing ──
  const diffVias: DiffFeature<RenderVia>[] = [];
  const usedViasA = new Set<number>();

  for (let i = 0; i < revB.vias.length; i++) {
    const vb = revB.vias[i];
    let matchIdx = -1;
    let isIdentical = false;

    for (let j = 0; j < revA.vias.length; j++) {
      if (usedViasA.has(j)) continue;
      const va = revA.vias[j];
      if (floatEq(va.center.x, vb.center.x) && floatEq(va.center.y, vb.center.y)) {
        matchIdx = j;
        if (
          floatEq(va.outerRadius, vb.outerRadius) &&
          floatEq(va.drillRadius, vb.drillRadius) &&
          va.netId === vb.netId
        ) {
          isIdentical = true;
        }
        break;
      }
    }

    if (matchIdx !== -1) {
      usedViasA.add(matchIdx);
      const va = revA.vias[matchIdx];
      if (isIdentical) {
        diffVias.push({ status: "unchanged", feature: vb });
      } else {
        diffVias.push({
          status: "modified",
          feature: vb,
          oldFeature: va,
          changeSummary: `Via at (${vb.center.x.toFixed(2)}, ${vb.center.y.toFixed(2)}) modified`,
        });
      }
    } else {
      diffVias.push({ status: "added", feature: vb, changeSummary: `Added via on net ${vb.netId}` });
    }
  }

  for (let j = 0; j < revA.vias.length; j++) {
    if (!usedViasA.has(j)) {
      const va = revA.vias[j];
      diffVias.push({ status: "removed", feature: va, changeSummary: `Removed via on net ${va.netId}` });
    }
  }

  // ── 4. Net changes summary ──
  const netsA = new Set<string>();
  revA.traces.forEach((t) => t.netId && netsA.add(t.netId));
  revA.pads.forEach((p) => p.netId && netsA.add(p.netId));
  revA.vias.forEach((v) => v.netId && netsA.add(v.netId));

  const netsB = new Set<string>();
  revB.traces.forEach((t) => t.netId && netsB.add(t.netId));
  revB.pads.forEach((p) => p.netId && netsB.add(p.netId));
  revB.vias.forEach((v) => v.netId && netsB.add(v.netId));

  const addedNets = Array.from(netsB).filter((n) => !netsA.has(n));
  const removedNets = Array.from(netsA).filter((n) => !netsB.has(n));

  return {
    traces: diffTraces,
    pads: diffPads,
    vias: diffVias,
    summary: {
      addedTraces: diffTraces.filter((t) => t.status === "added").length,
      removedTraces: diffTraces.filter((t) => t.status === "removed").length,
      modifiedTraces: diffTraces.filter((t) => t.status === "modified").length,
      addedPads: diffPads.filter((p) => p.status === "added").length,
      removedPads: diffPads.filter((p) => p.status === "removed").length,
      addedVias: diffVias.filter((v) => v.status === "added").length,
      removedVias: diffVias.filter((v) => v.status === "removed").length,
      netChanges: {
        addedNets,
        removedNets,
      },
    },
  };
}
