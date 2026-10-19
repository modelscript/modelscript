// SPDX-License-Identifier: AGPL-3.0-or-later
/* eslint-disable @typescript-eslint/no-explicit-any */

import type { IWorkspaceIndex, SymbolEntry, SymbolIndex } from "@modelscript/runtime";
import { extractStepAssembly } from "./assembly-extractor.js";
import type { StepAssemblyModel } from "./physical-data.js";

let occtPromise: Promise<any> | null = null;
let nodeRequire: any = null;

/**
 * Lazily initializes a Node.js `createRequire` function when running in a Node environment
 * so `occt-import-js.wasm` can be resolved from `node_modules`.
 */
async function getNodeRequire(): Promise<any> {
  if (!nodeRequire) {
    try {
      const nm = await import("node:module");
      if (nm?.createRequire) {
        nodeRequire = nm.createRequire(import.meta.url);
      }
    } catch {}
  }
  return nodeRequire;
}

/**
 * Lazily loads and initializes the OpenCascade WebAssembly (`occt-import-js`) instance
 * for B-Rep STEP tessellation across Node.js and browser/worker environments.
 */
function getOcct(serverDistBase: string | null = null): Promise<any> {
  if (!occtPromise) {
    occtPromise = (async () => {
      try {
        const mod = await import("occt-import-js");
        const init = mod.default || mod;
        const req = await getNodeRequire();
        return await (init as any)({
          locateFile: (path: string) => {
            if (path.endsWith(".wasm")) {
              if (serverDistBase) {
                return `${serverDistBase}/${path}`;
              }
              if (
                typeof self !== "undefined" &&
                self.location &&
                self.location.href &&
                !self.location.href.startsWith("blob:")
              ) {
                return new URL(path, self.location.href).href;
              }
              if (req?.resolve) {
                try {
                  return req.resolve("occt-import-js/dist/" + path);
                } catch {}
              }
            }
            return path;
          },
        });
      } catch (e) {
        console.error("[StepWorkspaceIndex] Failed to load occt-import-js:", e);
        occtPromise = null;
        return null;
      }
    })();
  }
  return occtPromise;
}

/**
 * Extract the first string parameter from a STEP entity line.
 * E.g. for `PRODUCT('DroneCAD','DroneCAD','',(#8))` → returns `'DroneCAD'`
 */
function extractFirstString(entityArgs: string): string | null {
  const match = entityArgs.match(/'([^']*)'/);
  return match ? match[1]! : null;
}

/**
 * Byte span and extracted name for a STEP `PRODUCT` or solid shape entity.
 */
interface StepNameMatch {
  name: string;
  startOffset: number;
  endOffset: number;
  nameStartOffset: number;
  nameEndOffset: number;
}

/**
 * Parse STEP text to extract PRODUCT names and named shapes with character positions.
 */
function extractStepNames(text: string): {
  products: StepNameMatch[];
  shapes: StepNameMatch[];
} {
  const products: StepNameMatch[] = [];
  const shapes: StepNameMatch[] = [];

  const headerRegex = /#\d+\s*=\s*([A-Z][A-Z0-9_]*)\s*\(/g;
  let headerMatch: RegExpExecArray | null;

  while ((headerMatch = headerRegex.exec(text)) !== null) {
    const entityType = headerMatch[1];
    const matchStart = headerMatch.index;
    const argsStart = matchStart + headerMatch[0].length;
    let depth = 1;
    let pos = argsStart;
    let inString = false;
    while (pos < text.length) {
      const ch = text[pos];
      if (ch === "'" && text[pos - 1] !== "\\") {
        inString = !inString;
      } else if (!inString) {
        if (ch === "(") depth++;
        else if (ch === ")") {
          depth--;
          if (depth === 0) break;
        } else if (ch === ";") {
          break;
        }
      }
      pos++;
    }
    const args = text.slice(argsStart, pos);
    let endPos = pos;
    if (text[endPos] === ")") endPos++;
    while (
      endPos < text.length &&
      (text[endPos] === " " || text[endPos] === "\t" || text[endPos] === "\r" || text[endPos] === "\n")
    ) {
      endPos++;
    }
    if (text[endPos] === ";") endPos++;
    headerRegex.lastIndex = endPos;

    if (
      entityType === "PRODUCT" ||
      entityType === "MANIFOLD_SOLID_BREP" ||
      entityType === "BREP_WITH_VOIDS" ||
      entityType === "FACETED_BREP" ||
      entityType === "GEOMETRIC_TOLERANCE"
    ) {
      const name = extractFirstString(args);
      if (name && name.length > 0) {
        const matchEnd = endPos;
        const fullMatch = text.slice(matchStart, matchEnd);
        const startOffset = matchStart;
        const endOffset = matchEnd;
        const nameIdx = fullMatch.indexOf(`'${name}'`);
        const nameStart = nameIdx >= 0 ? matchStart + nameIdx + 1 : startOffset;
        const nameEnd = nameIdx >= 0 ? nameStart + name.length : endOffset;
        if (entityType === "PRODUCT") {
          products.push({ name, startOffset, endOffset, nameStartOffset: nameStart, nameEndOffset: nameEnd });
        } else {
          shapes.push({ name, startOffset, endOffset, nameStartOffset: nameStart, nameEndOffset: nameEnd });
        }
      }
    }
  }

  return { products, shapes };
}

/**
 * Handles indexing of .step files by running occt-import-js inline
 * for mesh generation and parsing raw STEP text for symbol extraction.
 */
export class StepWorkspaceIndex implements IWorkspaceIndex {
  public serverDistBase: string | null = null;
  private _version = 0;
  private fileIndices = new Map<string, SymbolIndex>();
  private fileMeshes = new Map<string, any[]>();
  private fileAssemblies = new Map<string, StepAssemblyModel>();
  private uriBaseIds = new Map<string, number>();
  private nextBaseId = 1000000;

  private getBaseIdForUri(uri: string): number {
    let base = this.uriBaseIds.get(uri);
    if (base === undefined) {
      base = this.nextBaseId;
      this.nextBaseId += 100000;
      this.uriBaseIds.set(uri, base);
    }
    return base;
  }

  /** Monotonically increasing index revision counter. */
  get version(): number {
    return this._version;
  }

  /** Structural revision counter used for Salsa query invalidation. */
  get structuralRevision(): number {
    return this._version;
  }

  /** Total number of STEP files registered in this workspace index. */
  get fileCount(): number {
    return this.fileIndices.size;
  }

  /** Returns the cached triangulated OCCT meshes for `uri`. */
  public getMeshes(uri: string): any[] {
    return this.fileMeshes.get(uri) || [];
  }

  /** Returns the extracted `StepAssemblyModel` (parts, joints, mass properties, GD&T) for `uri`. */
  public getAssemblyModel(uri: string): StepAssemblyModel | undefined {
    return this.fileAssemblies.get(uri);
  }

  /** Returns `true` if `uri` has been registered in the STEP workspace index. */
  public has(uri: string): boolean {
    return this.fileIndices.has(uri);
  }

  /** Returns the per-file `SymbolIndex` for `uri`. */
  public getFileIndex(uri: string): SymbolIndex | undefined {
    return this.fileIndices.get(uri);
  }

  /** Registers an empty placeholder `SymbolIndex` entry for `uri` if not already present. */
  public register(uri: string, _loader?: () => any): void {
    if (!this.fileIndices.has(uri)) {
      this.fileIndices.set(uri, {
        symbols: new Map(),
        byName: new Map(),
        childrenOf: new Map(),
      });
    }
  }

  /**
   * Re-parses STEP product/shape symbols and assembly metadata when a document is edited in-place.
   */
  public reindexDocument(uri: string, loader?: () => any, _editRanges?: any, _totalDelta?: number): void {
    if (loader) {
      try {
        const res = loader();
        const text = typeof res === "string" ? res : res?.text;
        if (typeof text === "string" && text.length > 0) {
          const { products, shapes } = extractStepNames(text);
          this.fileAssemblies.set(uri, extractStepAssembly(text));
          const meshes = this.getMeshes(uri);
          this.fileIndices.set(uri, this.buildSymbolIndex(uri, products, shapes, meshes));
        }
      } catch {
        // ignore loader errors during incremental reindex
      }
    }
    this._version++;
  }

  /**
   * Parse a STEP file and index its contents.
   */
  public async parseStepFile(uri: string, buffer: Uint8Array, astIndex?: SymbolIndex): Promise<SymbolIndex> {
    const text = new TextDecoder().decode(buffer);
    const { products, shapes } = extractStepNames(text);

    const assemblyModel = extractStepAssembly(text);
    this.fileAssemblies.set(uri, assemblyModel);

    const occt = await getOcct(this.serverDistBase);
    let meshes: any[] = [];
    if (occt) {
      try {
        const result = occt.ReadStepFile(buffer, null);
        meshes = result?.meshes || [];
      } catch (e) {
        console.error(`[StepWorkspaceIndex] OCCT parse failed for ${uri}:`, e);
      }
    }

    this.fileMeshes.set(uri, meshes);

    const index = this.buildSymbolIndex(uri, products, shapes, meshes, astIndex);
    this.fileIndices.set(uri, index);
    this._version++;

    return index;
  }

  /**
   * Constructs a `SymbolIndex` combining STEP `PRODUCT` packages, B-Rep `step_shape` symbols,
   * and tessellated OCCT mesh entries.
   */
  private buildSymbolIndex(
    uri: string,
    products: StepNameMatch[],
    shapes: StepNameMatch[],
    meshes: any[],
    astIndex?: SymbolIndex,
  ): SymbolIndex {
    const symbols = new Map<number, SymbolEntry>();
    const byName = new Map<string, number[]>();
    const childrenOf = new Map<number | null, number[]>();

    if (astIndex) {
      for (const [id, entry] of astIndex.symbols) symbols.set(id, entry);
      for (const [name, ids] of astIndex.byName) byName.set(name, [...ids]);
      for (const [parentId, ids] of astIndex.childrenOf) childrenOf.set(parentId, [...ids]);
    }

    let idCounter = this.getBaseIdForUri(uri);

    const productList: (StepNameMatch | undefined)[] = products.length > 0 ? products : [undefined];
    let primaryProductId = idCounter;
    let primaryProductName = productList[0]?.name || this.deriveProductNameFromUri(uri);

    for (let pIdx = 0; pIdx < productList.length; pIdx++) {
      const product = productList[pIdx];
      const productName = product?.name || this.deriveProductNameFromUri(uri);
      const productId = idCounter++;
      if (pIdx === 0) {
        primaryProductId = productId;
        primaryProductName = productName;
      }
      const productStart = product?.startOffset ?? 0;
      const productEnd = product?.endOffset ?? 0;
      const productEntry: SymbolEntry = {
        id: productId,
        kind: "Package",
        name: productName,
        ruleName: "step_product",
        namePath: productName,
        startOffset: productStart,
        endOffset: productEnd,
        fieldRanges: product
          ? {
              name: {
                startOffset: product.nameStartOffset,
                endOffset: product.nameEndOffset,
              },
              declaredName: {
                startOffset: product.nameStartOffset,
                endOffset: product.nameEndOffset,
              },
            }
          : undefined,
        parentId: null,
        exports: [],
        inherits: [],
        metadata: { stepType: "Product", language: "step" },
        fieldName: null,
        resourceId: uri,
      };
      symbols.set(productId, productEntry);
      const existingProductNames = byName.get(productName) || [];
      existingProductNames.push(productId);
      byName.set(productName, existingProductNames);
      const rootChildren = childrenOf.get(null) || [];
      rootChildren.push(productId);
      childrenOf.set(null, rootChildren);
      childrenOf.set(productId, []);
    }

    const productChildren: number[] = [];

    const registeredShapes = new Set<string>();
    for (const shape of shapes) {
      if (registeredShapes.has(shape.name)) continue;
      registeredShapes.add(shape.name);

      const id = idCounter++;
      const entry: SymbolEntry = {
        id,
        kind: "Type",
        name: shape.name,
        ruleName: "step_shape",
        namePath: `${primaryProductName}::${shape.name}`,
        startOffset: shape.startOffset,
        endOffset: shape.endOffset,
        fieldRanges: {
          name: {
            startOffset: shape.nameStartOffset,
            endOffset: shape.nameEndOffset,
          },
          declaredName: {
            startOffset: shape.nameStartOffset,
            endOffset: shape.nameEndOffset,
          },
        },
        parentId: primaryProductId,
        exports: [],
        inherits: [],
        metadata: { stepType: "NamedShape", language: "step" },
        fieldName: null,
        resourceId: uri,
      };

      symbols.set(id, entry);
      const existing = byName.get(shape.name) || [];
      existing.push(id);
      byName.set(shape.name, existing);
      productChildren.push(id);
    }

    for (let i = 0; i < meshes.length; i++) {
      const mesh = meshes[i];
      const meshName = mesh.name || `Shape_${i}`;

      if (registeredShapes.has(meshName)) continue;
      registeredShapes.add(meshName);

      const id = idCounter++;
      const entry: SymbolEntry = {
        id,
        kind: "Type",
        name: meshName,
        ruleName: "step_shape",
        namePath: `${primaryProductName}::${meshName}`,
        startOffset: 0,
        endOffset: 0,
        parentId: primaryProductId,
        exports: [],
        inherits: [],
        metadata: {
          stepType: mesh.name ? "NamedShape" : "Face",
          meshIndex: i,
          color: mesh.color,
          language: "step",
        },
        fieldName: null,
        resourceId: uri,
      };

      symbols.set(id, entry);
      const existing = byName.get(meshName) || [];
      existing.push(id);
      byName.set(meshName, existing);
      productChildren.push(id);
    }

    childrenOf.set(primaryProductId, productChildren);

    return { symbols, byName, childrenOf };
  }

  /** Derives a fallback PascalCase product name from the file URI basename when no `PRODUCT` entity exists. */
  private deriveProductNameFromUri(uri: string): string {
    const filename =
      uri
        .split("/")
        .pop()
        ?.replace(/\.(step|stp|p21)$/i, "") || "CADModel";
    return filename.charAt(0).toUpperCase() + filename.slice(1);
  }

  /** Merges all per-file `SymbolIndex` maps into a single workspace-wide `SymbolIndex`. */
  private mergeIndices(): SymbolIndex {
    const symbols = new Map<number, SymbolEntry>();
    const byName = new Map<string, number[]>();
    const childrenOf = new Map<number | null, number[]>();

    for (const index of this.fileIndices.values()) {
      for (const [id, entry] of index.symbols) {
        symbols.set(id, entry);
      }
      for (const [name, ids] of index.byName) {
        const existing = byName.get(name) || [];
        existing.push(...ids);
        byName.set(name, existing);
      }
      for (const [parentId, ids] of index.childrenOf) {
        const existing = childrenOf.get(parentId) || [];
        existing.push(...ids);
        childrenOf.set(parentId, existing);
      }
    }

    return { symbols, byName, childrenOf };
  }

  /** Returns the merged `SymbolIndex` across all indexed STEP files. */
  toSymbolIndex(): SymbolIndex {
    return this.mergeIndices();
  }

  /** Returns the unified workspace `SymbolIndex`. */
  toUnified(): SymbolIndex {
    return this.mergeIndices();
  }

  /** Asynchronously returns the unified workspace `SymbolIndex`. */
  async toUnifiedAsync(): Promise<SymbolIndex> {
    return this.mergeIndices();
  }

  /** Returns the currently available partial unified `SymbolIndex`. */
  toUnifiedPartial(): SymbolIndex {
    return this.mergeIndices();
  }

  /** Returns the merged symbol tree index. */
  toTreeIndex(): SymbolIndex {
    return this.mergeIndices();
  }
}
