// SPDX-License-Identifier: AGPL-3.0-or-later

import type { DslIndexFileContext } from "@modelscript/dsl";
import type { SymbolEntry, SymbolId, UnifiedWorkspace } from "@modelscript/runtime";
import { parseTopas } from "./parser/index.js";

/**
 * Declarative `UnifiedWorkspace` file indexer for TOPAS (`.topas`) and GATE (`.mac`) files.
 */
export function indexTopasFile(ctx: DslIndexFileContext): void {
  const doc = parseTopas(ctx.text, ctx.uri);
  ctx.setParsedModel(doc);

  // 1. Index Geometry Components
  for (const comp of doc.components) {
    ctx.addSymbol(
      comp.name,
      "Component",
      null,
      comp.range.startOffset,
      comp.range.endOffset,
      {
        type: comp.type,
        parent: comp.parent,
        material: comp.material,
        hlx: comp.hlx,
        hly: comp.hly,
        hlz: comp.hlz,
        rMax: comp.rMax,
        hl: comp.hl,
      },
      {
        ruleName: "topas_component",
        namePath: `Ge/${comp.name}`,
        inherits: comp.parent ? [comp.parent] : [],
        aliases: [`Ge/${comp.name}`],
      },
    );
  }

  // 2. Index Particle Sources
  for (const src of doc.sources) {
    ctx.addSymbol(
      src.name,
      "Event",
      null,
      src.range.startOffset,
      src.range.endOffset,
      {
        type: src.type,
        beamParticle: src.beamParticle,
        beamEnergy: src.beamEnergy,
        beamEnergySpread: src.beamEnergySpread,
      },
      {
        ruleName: "topas_source",
        namePath: `So/${src.name}`,
        aliases: [`So/${src.name}`],
      },
    );
  }

  // 3. Index Scorers
  for (const sc of doc.scorers) {
    ctx.addSymbol(
      sc.name,
      "Property",
      null,
      sc.range.startOffset,
      sc.range.endOffset,
      {
        quantity: sc.quantity,
        component: sc.component,
      },
      {
        ruleName: "topas_scorer",
        namePath: `Sc/${sc.name}`,
        aliases: [`Sc/${sc.name}`],
      },
    );
  }

  // 4. Index Custom Materials
  for (const mat of doc.materials) {
    ctx.addSymbol(
      mat.name,
      "Constant",
      null,
      mat.range.startOffset,
      mat.range.endOffset,
      {
        density: mat.density,
        components: mat.components,
      },
      {
        ruleName: "topas_material",
        namePath: `Ma/${mat.name}`,
        aliases: [`Ma/${mat.name}`],
      },
    );
  }
}

/**
 * Resolves a TOPAS / GATE symbol within an optional scope or globally across `workspace`.
 */
export function resolveTopasInScope(
  workspace: UnifiedWorkspace,
  name: string,
  scopeId: SymbolId | null,
  uri?: string,
): SymbolEntry | null {
  const idx = workspace.getIndex();
  if (uri && !workspace.hasDocument(uri)) return null;

  if (scopeId !== null) {
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

  const found = workspace.findSymbolsByName(name)[0];
  return found ?? null;
}
