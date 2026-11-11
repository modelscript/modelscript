// SPDX-License-Identifier: AGPL-3.0-or-later

import type { DslIndexFileContext } from "@modelscript/dsl";
import type { SymbolEntry, SymbolId, UnifiedWorkspace } from "@modelscript/runtime";
import { parseThreeMf } from "./parser/index.js";

/**
 * Declarative `UnifiedWorkspace` file indexer for ISO/ASTM 52915 3MF files (`.3mf`).
 */
export function indexThreeMfFile(ctx: DslIndexFileContext): void {
  const doc = parseThreeMf(ctx.text, ctx.uri);
  ctx.setParsedModel(doc);

  // 1. Index Base Material Groups
  for (const grp of doc.baseMaterialGroups) {
    for (const mat of grp.materials) {
      ctx.addSymbol(
        mat.name,
        "Constant",
        null,
        mat.range.startOffset,
        mat.range.endOffset,
        {
          groupId: grp.id,
          index: mat.index,
          displayColor: mat.displayColor,
        },
        {
          ruleName: "three_mf_material",
          namePath: `${grp.id}/${mat.name}`,
        },
      );
    }
  }

  // 2. Index Objects and Child Surgical Guide Features
  for (const obj of doc.objects) {
    const displayName = obj.name ?? `Object_${obj.id}`;
    const objSymId = ctx.addSymbol(
      displayName,
      "Component",
      null,
      obj.range.startOffset,
      obj.range.endOffset,
      {
        objectId: obj.id,
        type: obj.type,
        materialName: obj.materialName,
        wallThicknessMm: obj.wallThicknessMm,
        vertexCount: obj.mesh?.vertices.length ?? 0,
        triangleCount: obj.mesh?.triangles.length ?? 0,
      },
      {
        ruleName: "three_mf_object",
        namePath: displayName,
        aliases: obj.id && obj.id !== displayName ? [obj.id] : undefined,
      },
    );

    if (obj.surgicalGuide) {
      for (const plane of obj.surgicalGuide.osteotomyPlanes) {
        ctx.addSymbol(
          plane.id,
          "Property",
          objSymId,
          plane.range.startOffset,
          plane.range.endOffset,
          {
            origin: plane.origin,
            normal: plane.normal,
            slotWidthMm: plane.slotWidthMm,
          },
          {
            ruleName: "three_mf_osteotomy_plane",
            namePath: `${displayName}.${plane.id}`,
          },
        );
      }

      for (const sleeve of obj.surgicalGuide.drillSleeves) {
        ctx.addSymbol(
          sleeve.id,
          "Property",
          objSymId,
          sleeve.range.startOffset,
          sleeve.range.endOffset,
          {
            innerDiameterMm: sleeve.innerDiameterMm,
            outerDiameterMm: sleeve.outerDiameterMm,
            wallThicknessMm: sleeve.wallThicknessMm,
          },
          {
            ruleName: "three_mf_drill_sleeve",
            namePath: `${displayName}.${sleeve.id}`,
          },
        );
      }
    }
  }
}

/**
 * Resolves a 3MF symbol within an optional parent object scope or globally across `workspace`.
 */
export function resolveThreeMfInScope(
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
