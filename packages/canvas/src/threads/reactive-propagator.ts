// SPDX-License-Identifier: AGPL-3.0-or-later

import type { CanvasDocument } from "../schema/canvas-document.js";
import { computeCanvasBlastRadius } from "./wire-router.js";

export interface ParameterPropagationResult {
  document: CanvasDocument;
  impactedTileIds: string[];
  impactedWireIds: string[];
  failedRequirements: string[];
}

/**
 * Parses a simple threshold constraint from a requirement label
 * (e.g. "REQ-014 Mass <= 2.5 kg" -> { op: "<=", limit: 2.5 }).
 */
function parseRequirementConstraint(label: string): { op: "<=" | "<" | ">=" | ">"; limit: number } | null {
  const match = /(<=|>=|<|>)\s*(-?\d+(?:\.\d+)?)/.exec(label);
  if (!match) return null;
  const op = match[1] as "<=" | "<" | ">=" | ">";
  const limit = Number(match[2]);
  if (!Number.isFinite(limit)) return null;
  return { op, limit };
}

function evaluateConstraint(value: number, op: "<=" | "<" | ">=" | ">", limit: number): boolean {
  switch (op) {
    case "<=":
      return value <= limit;
    case "<":
      return value < limit;
    case ">=":
      return value >= limit;
    case ">":
      return value > limit;
  }
}

/**
 * Propagates a parameter edit on one tile across live Digital Thread & FMI wires:
 * - Updates the source anchor's displayed value
 * - In `autoSync: true` mode, synchronizes linked shared-parameter anchors and
 *   re-evaluates downstream ReqIF threshold badges (`PASS` / `FAIL`)
 * - In `autoSync: false` mode, marks downstream wires and tiles `stale` for review
 */
export function propagateParameterEdit(
  doc: CanvasDocument,
  params: {
    tileId: string;
    anchorPath: string;
    numericValue: number;
    unit?: string | undefined;
    autoSync?: boolean | undefined;
  },
): ParameterPropagationResult {
  const next = structuredClone(doc);
  const autoSync = params.autoSync ?? true;
  const sourceTile = next.tiles[params.tileId];
  if (!sourceTile) {
    return { document: next, impactedTileIds: [], impactedWireIds: [], failedRequirements: [] };
  }

  const sourceAnchor = sourceTile.pinnedAnchors?.find((a) => a.path === params.anchorPath);
  const unit = params.unit ?? sourceAnchor?.unit ?? "";
  const formattedVal = unit ? `${params.numericValue} ${unit}` : String(params.numericValue);

  if (sourceAnchor) {
    sourceAnchor.currentValue = formattedVal;
  }

  const blast = computeCanvasBlastRadius(next, params.tileId, params.anchorPath);
  const failedRequirements: string[] = [];

  for (const wireId of blast.impactedWireIds) {
    const wire = next.wires[wireId];
    if (!wire) continue;

    if (!autoSync) {
      wire.status = "stale";
      const dst = next.tiles[wire.target.tileId];
      if (dst && dst.id !== params.tileId) {
        dst.health = "stale";
      }
      continue;
    }

    // Auto-sync shared parameters and re-verify requirement traces
    if (wire.kind === "shared-parameter") {
      wire.status = "synced";
      wire.liveValue = formattedVal;
      const peerEndpoint = wire.source.tileId === params.tileId ? wire.target : wire.source;
      const peerTile = next.tiles[peerEndpoint.tileId];
      const peerAnchor = peerTile?.pinnedAnchors?.find((a) => a.path === peerEndpoint.anchorPath);
      if (peerAnchor) {
        peerAnchor.currentValue = formattedVal;
      }
    } else if (wire.kind === "requirement-trace") {
      const reqTile = next.tiles[wire.target.tileId];
      const reqAnchor = reqTile?.pinnedAnchors?.find((a) => a.path === wire.target.anchorPath);
      if (reqTile && reqAnchor) {
        const constraint = parseRequirementConstraint(reqAnchor.label);
        if (constraint) {
          const passed = evaluateConstraint(params.numericValue, constraint.op, constraint.limit);
          reqAnchor.currentValue = `${passed ? "PASS" : "FAIL"} (${formattedVal})`;
          wire.status = passed ? "synced" : "conflict";
          wire.liveValue = `${params.numericValue} ${constraint.op} ${constraint.limit} ${unit}`.trim();
          if (!passed) {
            failedRequirements.push(reqAnchor.path);
            reqTile.health = "error";
          } else if (reqTile.health !== "error") {
            reqTile.health = "ok";
          }
        }
      }
    } else if (wire.kind === "fmi-signal") {
      wire.status = "stale";
    }
  }

  next.metadata.updatedAt = new Date().toISOString();

  return {
    document: next,
    impactedTileIds: Object.keys(blast.tileDistances).filter((id) => id !== params.tileId),
    impactedWireIds: blast.impactedWireIds,
    failedRequirements,
  };
}
