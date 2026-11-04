// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * @modelscript/dicom-rt — Multi-File Workspace Indexer.
 *
 * Implements IWorkspaceIndex for DICOM-RT files (.dcm.xml, .rtplan, .rtstruct, .rtdose, .dicom-rt).
 * Indexes treatment plans, ROI structures, treatment beams, control points, and DVH curves.
 */

import type { IWorkspaceIndex, SymbolEntry, SymbolId, SymbolIndex } from "@modelscript/runtime";
import { parseDicomRt } from "./parser/index.js";
import type { DicomRtDocument, DicomRtSourceRange } from "./types.js";

const DEFAULT_RANGE: DicomRtSourceRange = {
  startLine: 1,
  startColumn: 1,
  endLine: 1,
  endColumn: 1,
  startOffset: 0,
  endOffset: 0,
};

export class DicomRtWorkspaceIndex implements IWorkspaceIndex {
  private _version = 1;
  private fileIndices = new Map<string, SymbolIndex>();
  private fileDocuments = new Map<string, DicomRtDocument>();
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

  public getDocument(uri: string): DicomRtDocument | undefined {
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

  public reindexDocument(uri: string, loader?: () => string | { sourceText?: string; text?: string } | null): void {
    this._version++;
    if (loader) {
      try {
        const res = loader();
        const text = typeof res === "string" ? res : (res?.sourceText ?? res?.text);
        if (typeof text === "string") {
          this.indexFile(uri, text);
        }
      } catch {
        // incremental reindex guard
      }
    }
  }

  public indexFile(uri: string, text: string): SymbolIndex {
    const symbols = new Map<SymbolId, SymbolEntry>();
    const byName = new Map<string, SymbolId[]>();
    const childrenOf = new Map<SymbolId | null, SymbolId[]>();

    let baseId = this.fileBaseIds.get(uri);
    if (baseId === undefined) {
      baseId = this.nextFileSlot++ * 100_000;
      this.fileBaseIds.set(uri, baseId);
    }
    let idCounter = baseId;

    const doc = parseDicomRt(text, uri);
    this.fileDocuments.set(uri, doc);
    const docRange = doc.range ?? DEFAULT_RANGE;

    const rootChildren: SymbolId[] = [];

    const addByName = (key: string, symId: SymbolId) => {
      if (!key) return;
      const list = byName.get(key) ?? [];
      if (!list.includes(symId)) {
        list.push(symId);
        byName.set(key, list);
      }
    };

    // 1. Index Plan Symbol
    const planSymId = idCounter++ as SymbolId;
    rootChildren.push(planSymId);
    const planEntry: SymbolEntry = {
      id: planSymId,
      name: doc.planLabel || doc.planId,
      kind: "Package",
      ruleName: "dicom_rt_plan",
      namePath: doc.planLabel || doc.planId,
      fieldName: null,
      parentId: null,
      startOffset: docRange.startOffset,
      endOffset: docRange.endOffset,
      exports: [],
      inherits: [],
      language: "dicom-rt",
      resourceId: uri,
      metadata: {
        planId: doc.planId,
        planLabel: doc.planLabel,
        patientId: doc.patientId,
        frameOfReferenceUid: doc.frameOfReferenceUid,
        prescribedDoseGy: doc.prescribedDoseGy,
        fractions: doc.fractions,
      },
    };
    symbols.set(planSymId, planEntry);
    addByName(doc.planLabel, planSymId);
    addByName(doc.planId, planSymId);

    // 2. Index ROI Structures
    for (const roi of doc.structures) {
      const symId = idCounter++ as SymbolId;
      rootChildren.push(symId);

      const entry: SymbolEntry = {
        id: symId,
        name: roi.name,
        kind: "Component",
        ruleName: "dicom_rt_roi",
        namePath: roi.name,
        fieldName: null,
        parentId: null,
        startOffset: roi.range.startOffset,
        endOffset: roi.range.endOffset,
        exports: [],
        inherits: [],
        language: "dicom-rt",
        resourceId: uri,
        metadata: {
          roiNumber: roi.roiNumber,
          interpretedType: roi.interpretedType,
          volumeCc: roi.volumeCc,
          contourSlices: roi.contours.length,
          maxDoseLimitGy: roi.maxDoseLimitGy,
          meanDoseLimitGy: roi.meanDoseLimitGy,
        },
      };
      symbols.set(symId, entry);
      addByName(roi.name, symId);
      addByName(`ROI_${roi.roiNumber}`, symId);
    }

    // 3. Index Treatment Beams & Child Control Points
    for (const beam of doc.beams) {
      const beamSymId = idCounter++ as SymbolId;
      rootChildren.push(beamSymId);

      const beamEntry: SymbolEntry = {
        id: beamSymId,
        name: beam.name,
        kind: "Class",
        ruleName: "dicom_rt_beam",
        namePath: beam.name,
        fieldName: null,
        parentId: null,
        startOffset: beam.range.startOffset,
        endOffset: beam.range.endOffset,
        exports: [],
        inherits: [],
        language: "dicom-rt",
        resourceId: uri,
        metadata: {
          beamNumber: beam.beamNumber,
          modality: beam.modality,
          treatmentDeliveryType: beam.treatmentDeliveryType,
          energyMeV: beam.energyMeV,
          metersetMu: beam.metersetMu,
          doseRateMuPerMin: beam.doseRateMuPerMin,
        },
      };
      symbols.set(beamSymId, beamEntry);
      addByName(beam.name, beamSymId);
      addByName(`Beam_${beam.beamNumber}`, beamSymId);

      const cpChildren: SymbolId[] = [];
      for (const cp of beam.controlPoints) {
        const cpSymId = idCounter++ as SymbolId;
        cpChildren.push(cpSymId);
        const cpName = `CP_${cp.index}`;
        const cpEntry: SymbolEntry = {
          id: cpSymId,
          name: cpName,
          kind: "Event",
          ruleName: "dicom_rt_control_point",
          namePath: `${beam.name}.${cpName}`,
          fieldName: null,
          parentId: beamSymId,
          startOffset: cp.range.startOffset,
          endOffset: cp.range.endOffset,
          exports: [],
          inherits: [],
          language: "dicom-rt",
          resourceId: uri,
          metadata: {
            index: cp.index,
            cumulativeMetersetWeight: cp.cumulativeMetersetWeight,
            gantryAngleDeg: cp.gantryAngleDeg,
            collimatorAngleDeg: cp.collimatorAngleDeg,
            couchAngleDeg: cp.couchAngleDeg,
            mlcLeafPairCount: cp.mlcLeaves.length,
          },
        };
        symbols.set(cpSymId, cpEntry);
        addByName(cpName, cpSymId);
      }
      childrenOf.set(beamSymId, cpChildren);
    }

    // 4. Index DVHs
    for (const dvh of doc.dvhs) {
      const symId = idCounter++ as SymbolId;
      rootChildren.push(symId);
      const r = dvh.range ?? docRange;
      const dvhName = `DVH_${dvh.roiName}`;

      const entry: SymbolEntry = {
        id: symId,
        name: dvhName,
        kind: "Property",
        ruleName: "dicom_rt_dvh",
        namePath: dvhName,
        fieldName: null,
        parentId: null,
        startOffset: r.startOffset,
        endOffset: r.endOffset,
        exports: [],
        inherits: [],
        language: "dicom-rt",
        resourceId: uri,
        metadata: {
          roiNumber: dvh.roiNumber,
          roiName: dvh.roiName,
          d95Gy: dvh.d95Gy,
          meanDoseGy: dvh.meanDoseGy,
          maxDoseGy: dvh.maxDoseGy,
        },
      };
      symbols.set(symId, entry);
      addByName(dvhName, symId);
    }

    childrenOf.set(null, rootChildren);

    const index: SymbolIndex = {
      symbols,
      byName,
      childrenOf,
    };

    this.fileIndices.set(uri, index);
    return index;
  }

  public resolveInScope(name: string, scopeId: SymbolId | null, uri: string): SymbolEntry | null {
    const idx = this.fileIndices.get(uri);
    if (!idx) return null;

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

    for (const fileIndex of this.fileIndices.values()) {
      const candidates = fileIndex.byName.get(name);
      const firstCandidate = candidates?.[0];
      if (firstCandidate !== undefined) {
        const found = fileIndex.symbols.get(firstCandidate);
        if (found) return found;
      }
    }

    return null;
  }

  public lookupExact(id: SymbolId): SymbolEntry | undefined {
    for (const index of this.fileIndices.values()) {
      const sym = index.symbols.get(id);
      if (sym) return sym;
    }
    return undefined;
  }

  public findByName(name: string): SymbolEntry[] {
    const results: SymbolEntry[] = [];
    for (const index of this.fileIndices.values()) {
      const ids = index.byName.get(name);
      if (ids) {
        for (const id of ids) {
          const s = index.symbols.get(id);
          if (s) results.push(s);
        }
      }
    }
    return results;
  }

  public getAllSymbols(uri: string): SymbolEntry[] {
    const idx = this.fileIndices.get(uri);
    if (!idx) return [];
    return Array.from(idx.symbols.values());
  }

  public getAllFiles(): string[] {
    return Array.from(this.fileIndices.keys());
  }

  public clear(): void {
    this._version++;
    this.fileIndices.clear();
    this.fileDocuments.clear();
    this.fileBaseIds.clear();
    this.nextFileSlot = 1;
  }
}
