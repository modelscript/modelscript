// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * @modelscript/doe2 — Declarative Workspace Indexing.
 *
 * Indexes DOE-2 BDL materials, layers, constructions, glazing types, schedules,
 * spaces, envelope surfaces, windows, doors, zones, systems, and plant equipment.
 */

import type { DslIndexFileContext } from "@modelscript/dsl";
import type { UnifiedWorkspace } from "@modelscript/runtime";
import { parseDoe2 } from "./parser/index.js";
import type { Doe2Document, Doe2Space, Doe2Zone } from "./types.js";

export function canIndexDoe2(uri: string, text?: string): boolean {
  const lower = uri.toLowerCase();
  if (lower.endsWith(".inp") || lower.endsWith(".bdl") || lower.endsWith(".doe")) return true;
  if (text && /\bINPUT\s+(LOADS|SYSTEMS|PLANT|ECONOMICS)\b/i.test(text)) return true;
  return false;
}

export function indexDoe2Document(ctx: DslIndexFileContext): void {
  const { uri, text } = ctx;
  const doc = parseDoe2(text, uri);
  ctx.setParsedModel(doc);

  const addSym = (
    name: string,
    kind: string,
    parentId: number | null,
    startOffset: number,
    endOffset: number,
    extra?: Record<string, unknown>,
  ): number => {
    return ctx.addSymbol(name, kind, parentId, startOffset, endOffset, extra ?? {}, {
      ruleName: `doe2_${kind}`,
      namePath: name,
    });
  };

  for (const mat of doc.materials) {
    addSym(mat.name, "material", null, mat.range.startOffset, mat.range.endOffset, {
      type: mat.type,
      thickness: mat.thickness,
      conductivity: mat.conductivity,
      resistance: mat.resistance,
    });
  }

  for (const lay of doc.layers) {
    addSym(lay.name, "layers", null, lay.range.startOffset, lay.range.endOffset, {
      materials: lay.materials,
    });
  }

  for (const con of doc.constructions) {
    addSym(con.name, "construction", null, con.range.startOffset, con.range.endOffset, {
      type: con.type,
      layersName: con.layersName,
      uValue: con.uValue,
    });
  }

  for (const glz of doc.glassTypes) {
    addSym(glz.name, "glass_type", null, glz.range.startOffset, glz.range.endOffset, {
      shgc: glz.shgc,
      glassConductance: glz.glassConductance,
    });
  }

  for (const sp of doc.spaces) {
    const spaceId = addSym(sp.name, "space", null, sp.range.startOffset, sp.range.endOffset, {
      area: sp.area,
      volume: sp.volume,
      infiltrationAch: sp.infiltrationAch,
    });

    for (const surf of doc.surfaces.filter((s) => s.spaceName?.toLowerCase() === sp.name.toLowerCase())) {
      const surfId = addSym(surf.name, "surface", spaceId, surf.range.startOffset, surf.range.endOffset, {
        kind: surf.kind,
        construction: surf.constructionName,
        area: surf.area,
      });

      for (const win of doc.windows.filter((w) => w.parentSurfaceName?.toLowerCase() === surf.name.toLowerCase())) {
        addSym(win.name, "window", surfId, win.range.startOffset, win.range.endOffset, {
          glassType: win.glassTypeName,
          area: win.area,
        });
      }

      for (const door of doc.doors.filter((d) => d.parentSurfaceName?.toLowerCase() === surf.name.toLowerCase())) {
        addSym(door.name, "door", surfId, door.range.startOffset, door.range.endOffset, {
          construction: door.constructionName,
          area: door.area,
        });
      }
    }
  }

  for (const sys of doc.systems) {
    addSym(sys.name, "system", null, sys.range.startOffset, sys.range.endOffset, {
      type: sys.type,
      zones: sys.zones,
    });
  }

  for (const zone of doc.zones) {
    addSym(zone.name, "zone", null, zone.range.startOffset, zone.range.endOffset, {
      spaceName: zone.spaceName,
      systemName: zone.systemName,
      type: zone.type,
    });
  }

  for (const pe of doc.plantEquipment) {
    addSym(pe.name, "plant_equipment", null, pe.range.startOffset, pe.range.endOffset, {
      type: pe.type,
      size: pe.size,
    });
  }
}

export function getDoe2Document(workspace: UnifiedWorkspace, uri: string): Doe2Document | undefined {
  return workspace.getParsedModel<Doe2Document>(uri);
}

export function getAllDoe2Spaces(workspace: UnifiedWorkspace): { uri: string; space: Doe2Space }[] {
  const out: { uri: string; space: Doe2Space }[] = [];
  for (const [uri, doc] of workspace.getAllParsedModels<Doe2Document>().entries()) {
    for (const space of doc.spaces) {
      out.push({ uri, space });
    }
  }
  return out;
}

export function getAllDoe2Zones(workspace: UnifiedWorkspace): { uri: string; zone: Doe2Zone }[] {
  const out: { uri: string; zone: Doe2Zone }[] = [];
  for (const [uri, doc] of workspace.getAllParsedModels<Doe2Document>().entries()) {
    for (const zone of doc.zones) {
      out.push({ uri, zone });
    }
  }
  return out;
}
