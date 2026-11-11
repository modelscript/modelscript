// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * @modelscript/energyplus — Declarative Workspace Indexing.
 *
 * Indexes thermal zones, envelope surfaces, materials, constructions,
 * internal heat gains, and HVAC equipment across EnergyPlus (.idf, .epJSON) files.
 */

import type { DslIndexFileContext } from "@modelscript/dsl";
import type { UnifiedWorkspace } from "@modelscript/runtime";
import { parseEnergyPlus } from "./parser/index.js";
import type { EnergyPlusDocument, IdfZone } from "./types.js";

export function canIndexEnergyPlus(uri: string, text?: string): boolean {
  const lower = uri.toLowerCase();
  if (lower.endsWith(".idf") || lower.endsWith(".epjson")) return true;
  if (text && (/\bBuilding\s*,/i.test(text) || text.includes('"Building"'))) return true;
  return false;
}

export function indexEnergyPlusDocument(ctx: DslIndexFileContext): void {
  const { uri, text } = ctx;
  const doc = parseEnergyPlus(text, uri);
  ctx.setParsedModel(doc);

  const addSym = (
    name: string,
    kind: string,
    parentId: number | null = null,
    extra?: Record<string, unknown>,
  ): number => {
    return ctx.addSymbol(name, kind, parentId, 0, 0, extra ?? {}, {
      ruleName: `energyplus_${kind}`,
      namePath: name,
    });
  };

  // 1. Building Symbol
  let buildingSymId: number | null = null;
  if (doc.building) {
    buildingSymId = addSym(doc.building.name, "building", null, {
      northAxis: doc.building.northAxis,
      terrain: doc.building.terrain,
    });
  }

  // 2. Thermal Zones
  for (const zone of doc.zones) {
    const zoneSymId = addSym(zone.name, "zone", buildingSymId, {
      volume: zone.volume,
      floorArea: zone.floorArea,
      ceilingHeight: zone.ceilingHeight,
    });

    const zoneSurfaces = doc.surfaces.filter((s) => s.zoneName.toLowerCase() === zone.name.toLowerCase());
    for (const surf of zoneSurfaces) {
      addSym(surf.name, "surface", zoneSymId, {
        surfaceType: surf.surfaceType,
        construction: surf.constructionName,
        boundaryCondition: surf.boundaryCondition,
        grossArea: surf.grossArea,
      });
    }

    for (const p of doc.people.filter((x) => x.zoneName.toLowerCase() === zone.name.toLowerCase())) {
      addSym(p.name, "people", zoneSymId, { count: p.numberOfPeople });
    }
    for (const l of doc.lights.filter((x) => x.zoneName.toLowerCase() === zone.name.toLowerCase())) {
      addSym(l.name, "lights", zoneSymId, { watts: l.lightingLevel });
    }
    for (const e of doc.electricEquipment.filter((x) => x.zoneName.toLowerCase() === zone.name.toLowerCase())) {
      addSym(e.name, "equipment", zoneSymId, { watts: e.designLevel });
    }
    for (const h of doc.zoneHvacs.filter((x) => x.zoneName.toLowerCase() === zone.name.toLowerCase())) {
      addSym(h.name, "hvac", zoneSymId, { type: h.type });
    }
  }

  // 3. Materials and Constructions
  for (const mat of doc.materials) {
    addSym(mat.name, "material", null, {
      thickness: mat.thickness,
      conductivity: mat.conductivity,
      density: mat.density,
      specificHeat: mat.specificHeat,
    });
  }
  for (const matNM of doc.materialsNoMass) {
    addSym(matNM.name, "material_nomass", null, {
      resistance: matNM.thermalResistance,
    });
  }
  for (const c of doc.constructions) {
    addSym(c.name, "construction", null, {
      layers: c.layers,
    });
  }
}

export function getEnergyPlusDocument(workspace: UnifiedWorkspace, uri: string): EnergyPlusDocument | undefined {
  return workspace.getParsedModel<EnergyPlusDocument>(uri);
}

export function getAllEnergyPlusZones(workspace: UnifiedWorkspace): { uri: string; zone: IdfZone }[] {
  const list: { uri: string; zone: IdfZone }[] = [];
  for (const [uri, doc] of workspace.getAllParsedModels<EnergyPlusDocument>().entries()) {
    for (const zone of doc.zones) {
      list.push({ uri, zone });
    }
  }
  return list;
}
