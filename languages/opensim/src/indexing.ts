// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * @modelscript/opensim — Declarative Multi-File Indexing.
 *
 * Indexes OpenSim (.osim) biomechanical model files including rigid bodies, joints,
 * generalized coordinates, Hill-type muscles, markers, wrap objects, and constraints
 * into UnifiedWorkspace.
 */

import type { DslIndexFileContext } from "@modelscript/dsl";
import type { SymbolEntry, SymbolId, UnifiedWorkspace } from "@modelscript/runtime";
import { parseOpenSim } from "./parser/index.js";
import type { OpenSimDocument } from "./types.js";

export function indexOpenSimFile(ctx: DslIndexFileContext): void {
  const doc = parseOpenSim(ctx.text, ctx.uri);
  ctx.setParsedModel(doc);

  for (const b of doc.bodies) {
    ctx.addSymbol(
      b.name,
      "Component",
      null,
      b.range.startOffset,
      b.range.endOffset,
      {
        bodyId: b.id,
        mass: b.mass,
        massCenter: b.massCenter,
        inertia: b.inertia,
      },
      {
        ruleName: "opensim_body",
        namePath: b.name,
        aliases: b.id ? [b.id] : undefined,
      },
    );
  }

  for (const j of doc.joints) {
    const jSymId = ctx.addSymbol(
      j.name,
      "Class",
      null,
      j.range.startOffset,
      j.range.endOffset,
      {
        jointId: j.id,
        jointType: j.jointType,
        parentFrame: j.parentFrame,
        childFrame: j.childFrame,
        locationInParent: j.locationInParent,
        orientationInParent: j.orientationInParent,
      },
      {
        ruleName: "opensim_joint",
        namePath: j.name,
        inherits: [j.parentFrame],
        aliases: j.id ? [j.id] : undefined,
      },
    );

    for (const c of j.coordinates) {
      ctx.addSymbol(
        c.name,
        "Variable",
        jSymId,
        c.range.startOffset,
        c.range.endOffset,
        {
          coordinateId: c.id,
          motionType: c.motionType,
          defaultValue: c.defaultValue,
          rangeMin: c.rangeMin,
          rangeMax: c.rangeMax,
          clamped: c.clamped,
          locked: c.locked,
        },
        {
          ruleName: "opensim_coordinate",
          namePath: `${j.name}.${c.name}`,
          aliases: c.id ? [c.id] : undefined,
        },
      );
    }
  }

  for (const m of doc.muscles) {
    ctx.addSymbol(
      m.name,
      "Function",
      null,
      m.range.startOffset,
      m.range.endOffset,
      {
        muscleId: m.id,
        muscleType: m.muscleType,
        maxIsometricForce: m.maxIsometricForce,
        optimalFiberLength: m.optimalFiberLength,
        tendonSlackLength: m.tendonSlackLength,
        pennationAngleAtOptimal: m.pennationAngleAtOptimal,
        pathPoints: m.pathPoints.length,
        wrapObjects: m.wrapObjects,
      },
      {
        ruleName: "opensim_muscle",
        namePath: m.name,
        aliases: m.id ? [m.id] : undefined,
      },
    );
  }

  for (const mk of doc.markers) {
    ctx.addSymbol(
      mk.name,
      "Constant",
      null,
      mk.range.startOffset,
      mk.range.endOffset,
      {
        markerId: mk.id,
        bodyFrame: mk.bodyFrame,
        location: mk.location,
      },
      {
        ruleName: "opensim_marker",
        namePath: mk.name,
        aliases: mk.id ? [mk.id] : undefined,
      },
    );
  }

  for (const w of doc.wrapObjects) {
    ctx.addSymbol(
      w.name,
      "Property",
      null,
      w.range.startOffset,
      w.range.endOffset,
      {
        wrapId: w.id,
        wrapType: w.wrapType,
        bodyFrame: w.bodyFrame,
        radius: w.radius,
        length: w.length,
      },
      {
        ruleName: "opensim_wrap_object",
        namePath: w.name,
        aliases: w.id ? [w.id] : undefined,
      },
    );
  }

  for (const c of doc.constraints) {
    ctx.addSymbol(
      c.name,
      "Event",
      null,
      c.range.startOffset,
      c.range.endOffset,
      {
        constraintId: c.id,
        constraintType: c.constraintType,
        body1: c.body1,
        body2: c.body2,
      },
      {
        ruleName: "opensim_constraint",
        namePath: c.name,
        aliases: c.id ? [c.id] : undefined,
      },
    );
  }
}

export function getOpenSimDocument(workspace: UnifiedWorkspace, uri: string): OpenSimDocument | undefined {
  return workspace.getParsedModel<OpenSimDocument>(uri);
}

export function resolveOpenSimInScope(
  workspace: UnifiedWorkspace,
  name: string,
  scopeId: SymbolId | null,
  uri: string,
): SymbolEntry | null {
  const idx = workspace.getFileIndex(uri);
  if (idx && scopeId !== null) {
    const children = idx.childrenOf.get(scopeId);
    if (children) {
      for (const cid of children) {
        const sym = idx.symbols.get(cid);
        if (sym && sym.name.toLowerCase() === name.toLowerCase()) {
          return sym;
        }
      }
    }
  }

  return workspace.findSymbolsByName(name)[0] ?? null;
}
