// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * @modelscript/energyplus — Multi-File Workspace Indexer.
 *
 * Implements IWorkspaceIndex for EnergyPlus models (.idf, .epJSON).
 * Indexes thermal zones, envelope surfaces, materials, constructions,
 * internal heat gains, and HVAC equipment across workspace files.
 */

import type { IWorkspaceIndex, SymbolEntry, SymbolId, SymbolIndex } from "@modelscript/runtime";
import { parseEnergyPlus } from "./parser/index.js";
import type { EnergyPlusDocument, IdfZone } from "./types.js";

export class EnergyPlusWorkspaceIndex implements IWorkspaceIndex {
  private _version = 1;
  private fileIndices = new Map<string, SymbolIndex>();
  private fileDocuments = new Map<string, EnergyPlusDocument>();
  private fileBaseIds = new Map<string, number>();
  private nextFileSlot = 1;

  get version(): number {
    return this._version;
  }

  get structuralRevision(): number {
    return this._version;
  }

  get fileCount(): number {
    return this.fileIndices.size;
  }

  public has(uri: string): boolean {
    return this.fileIndices.has(uri);
  }

  public getFileIndex(uri: string): SymbolIndex | undefined {
    return this.fileIndices.get(uri);
  }

  public getDocument(uri: string): EnergyPlusDocument | undefined {
    return this.fileDocuments.get(uri);
  }

  public register(uri: string, _loader?: () => unknown): void {
    if (!this.fileIndices.has(uri)) {
      this.fileIndices.set(uri, {
        symbols: new Map(),
        byName: new Map(),
        childrenOf: new Map(),
      });
    }
  }

  public reindexDocument(uri: string, loader?: () => unknown): void {
    this._version++;
    if (loader) {
      try {
        const res = loader();
        if (typeof res === "string") {
          this.indexSource(uri, res);
        } else if (res && typeof res === "object") {
          this.indexDocument(uri, res as EnergyPlusDocument);
        }
      } catch {
        // Retain previous or empty index
      }
    }
  }

  public indexSource(uri: string, source: string): void {
    const doc = parseEnergyPlus(source, uri);
    this.indexDocument(uri, doc);
  }

  public indexDocument(uri: string, doc: EnergyPlusDocument): void {
    this._version++;
    this.fileDocuments.set(uri, doc);

    let baseId = this.fileBaseIds.get(uri);
    if (!baseId) {
      baseId = this.nextFileSlot * 100_000;
      this.nextFileSlot++;
      this.fileBaseIds.set(uri, baseId);
    }

    let localSeq = 1;
    const symbols = new Map<SymbolId, SymbolEntry>();
    const byName = new Map<string, SymbolId[]>();
    const childrenOf = new Map<SymbolId | null, SymbolId[]>();

    function addSym(
      name: string,
      kind: string,
      parentId: SymbolId | null = null,
      extra?: Record<string, unknown>,
    ): SymbolId {
      const symId = (baseId! + localSeq++) as SymbolId;
      const entry: SymbolEntry = {
        id: symId,
        name,
        kind,
        ruleName: `energyplus_${kind}`,
        namePath: name,
        fieldName: null,
        parentId,
        startOffset: 0,
        endOffset: 0,
        exports: [],
        inherits: [],
        language: "energyplus",
        resourceId: uri,
        metadata: extra ?? {},
      };

      symbols.set(symId, entry);

      const existingNames = byName.get(name) ?? [];
      existingNames.push(symId);
      byName.set(name, existingNames);

      const existingChildren = childrenOf.get(parentId) ?? [];
      existingChildren.push(symId);
      childrenOf.set(parentId, existingChildren);

      return symId;
    }

    // 1. Building Symbol
    let buildingSymId: SymbolId | null = null;
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

      // Surfaces belonging to this zone
      const zoneSurfaces = doc.surfaces.filter((s) => s.zoneName.toLowerCase() === zone.name.toLowerCase());
      for (const surf of zoneSurfaces) {
        addSym(surf.name, "surface", zoneSymId, {
          surfaceType: surf.surfaceType,
          construction: surf.constructionName,
          boundaryCondition: surf.boundaryCondition,
          grossArea: surf.grossArea,
        });
      }

      // Internal gains in this zone
      for (const p of doc.people.filter((x) => x.zoneName.toLowerCase() === zone.name.toLowerCase())) {
        addSym(p.name, "people", zoneSymId, { count: p.numberOfPeople });
      }
      for (const l of doc.lights.filter((x) => x.zoneName.toLowerCase() === zone.name.toLowerCase())) {
        addSym(l.name, "lights", zoneSymId, { watts: l.lightingLevel });
      }
      for (const e of doc.electricEquipment.filter((x) => x.zoneName.toLowerCase() === zone.name.toLowerCase())) {
        addSym(e.name, "equipment", zoneSymId, { watts: e.designLevel });
      }

      // HVAC in this zone
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

    this.fileIndices.set(uri, {
      symbols,
      byName,
      childrenOf,
    });
  }

  public getSymbolsByName(name: string): SymbolEntry[] {
    const results: SymbolEntry[] = [];
    for (const idx of this.fileIndices.values()) {
      const ids = idx.byName.get(name) ?? [];
      for (const id of ids) {
        const sym = idx.symbols.get(id);
        if (sym) results.push(sym);
      }
    }
    return results;
  }

  public getAllZones(): { uri: string; zone: IdfZone }[] {
    const list: { uri: string; zone: IdfZone }[] = [];
    for (const [uri, doc] of this.fileDocuments.entries()) {
      for (const z of doc.zones) {
        list.push({ uri, zone: z });
      }
    }
    return list;
  }
}
