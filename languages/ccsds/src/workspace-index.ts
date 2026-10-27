// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * @modelscript/ccsds — Multi-File Workspace Indexer.
 *
 * Implements IWorkspaceIndex for space mission flight dynamics decks (.oem, .opm, .omm)
 * and satellite telemetry dictionaries (.xtce, .xml).
 */

import type { IWorkspaceIndex, SymbolEntry, SymbolId, SymbolIndex } from "@modelscript/runtime";
import { parseCcsds } from "./parser/index.js";
import type { CcsdsDocument } from "./types.js";

export class CcsdsWorkspaceIndex implements IWorkspaceIndex {
  private _version = 1;
  private fileIndices = new Map<string, SymbolIndex>();
  private fileDocuments = new Map<string, CcsdsDocument>();
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

  public getDocument(uri: string): CcsdsDocument | undefined {
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
          this.indexDocument(uri, res as CcsdsDocument);
        }
      } catch {
        // Retain previous or empty index
      }
    }
  }

  public indexSource(uri: string, source: string): void {
    const doc = parseCcsds(source, uri);
    this.indexDocument(uri, doc);
  }

  public indexDocument(uri: string, doc: CcsdsDocument): void {
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
        ruleName: `ccsds_${kind}`,
        namePath: name,
        fieldName: null,
        parentId,
        startOffset: 0,
        endOffset: 0,
        exports: [],
        inherits: [],
        language: "ccsds",
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

    if (doc.format === "XTCE") {
      const rootId = addSym(doc.name, "space_system", null, {
        format: doc.format,
        parameterCount: doc.parameters.length,
        containerCount: doc.containers.length,
        commandCount: doc.commands.length,
      });

      for (const p of doc.parameters) {
        addSym(p.name, "telemetry_parameter", rootId, {
          paramType: p.paramType,
          bitLength: p.bitLength,
          units: p.units,
        });
      }

      for (const c of doc.containers) {
        addSym(c.name, "telemetry_container", rootId, {
          entryCount: c.entries.length,
        });
      }

      for (const cmd of doc.commands) {
        addSym(cmd.name, "telecommand", rootId, {
          argumentCount: cmd.arguments.length,
        });
      }
    } else {
      const rootId = addSym(doc.metadata.objectName, "spacecraft", null, {
        format: doc.format,
        objectId: doc.metadata.objectId,
        refFrame: doc.metadata.refFrame,
        timeSystem: doc.metadata.timeSystem,
      });

      if (doc.format === "OEM") {
        addSym("EphemerisTrajectory", "ephemeris_track", rootId, {
          pointCount: doc.points.length,
          startTime: doc.metadata.startTime ?? doc.points[0]?.epoch ?? "",
          stopTime: doc.metadata.stopTime ?? doc.points[doc.points.length - 1]?.epoch ?? "",
        });
      } else if (doc.format === "OPM") {
        addSym("StateVector", "state_vector", rootId, {
          epoch: doc.stateVector.epoch,
          position: [doc.stateVector.x, doc.stateVector.y, doc.stateVector.z],
          velocity: [doc.stateVector.vx, doc.stateVector.vy, doc.stateVector.vz],
        });
        if (doc.keplerian) {
          addSym("KeplerianOrbit", "keplerian_elements", rootId, {
            semiMajorAxisKm: doc.keplerian.semiMajorAxisKm,
            eccentricity: doc.keplerian.eccentricity,
            inclinationDeg: doc.keplerian.inclinationDeg,
          });
        }
      } else if (doc.format === "OMM") {
        addSym("MeanKeplerianOrbit", "keplerian_elements", rootId, {
          semiMajorAxisKm: doc.meanElements.semiMajorAxisKm,
          eccentricity: doc.meanElements.eccentricity,
          inclinationDeg: doc.meanElements.inclinationDeg,
        });
      }

      if ("spacecraft" in doc && doc.spacecraft) {
        addSym("SpacecraftProperties", "spacecraft_properties", rootId, {
          massKg: doc.spacecraft.massKg,
          dragAreaM2: doc.spacecraft.dragAreaM2,
        });
      }
    }

    this.fileIndices.set(uri, { symbols, byName, childrenOf });
  }

  public removeDocument(uri: string): void {
    this._version++;
    this.fileIndices.delete(uri);
    this.fileDocuments.delete(uri);
    this.fileBaseIds.delete(uri);
  }

  public getSymbols(uri: string): SymbolEntry[] {
    const idx = this.fileIndices.get(uri);
    return idx ? Array.from(idx.symbols.values()) : [];
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

  public findByType(kind: string): SymbolEntry[] {
    const results: SymbolEntry[] = [];
    for (const idx of this.fileIndices.values()) {
      for (const sym of idx.symbols.values()) {
        if (sym.kind === kind || sym.ruleName === `ccsds_${kind}`) {
          results.push(sym);
        }
      }
    }
    return results;
  }
}
