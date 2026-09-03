// SPDX-License-Identifier: LGPL-3.0-or-later
/* eslint-disable @typescript-eslint/no-explicit-any */

import type { IWorkspaceIndex, SymbolEntry, SymbolIndex } from "@modelscript/language/compiler";
import { extractStepAssembly } from "./assembly-extractor.js";
import type { StepAssemblyModel } from "./physical-data.js";

let occtPromise: Promise<any> | null = null;

function getOcct(serverDistBase: string | null = null): Promise<any> {
  if (!occtPromise) {
    occtPromise = import("occt-import-js")
      .then((mod) => {
        const init = mod.default || mod;
        return (init as any)({
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
            }
            return path;
          },
        });
      })
      .catch((e) => {
        console.error("[StepWorkspaceIndex] Failed to load occt-import-js:", e);
        occtPromise = null;
        return null;
      });
  }
  return occtPromise;
}

/**
 * Extract the first string parameter from a STEP entity line.
 * E.g. for `PRODUCT('DroneCAD','DroneCAD','',(#8))` → returns `'DroneCAD'`
 */
function extractFirstString(entityArgs: string): string | null {
  const match = entityArgs.match(/'([^']*)'/);
  return match ? match[1] : null;
}

interface StepNameMatch {
  name: string;
  startByte: number;
  endByte: number;
  nameStartByte: number;
  nameEndByte: number;
}

/**
 * Parse STEP text to extract PRODUCT names and named shapes with byte positions.
 */
function extractStepNames(text: string): {
  products: StepNameMatch[];
  shapes: StepNameMatch[];
} {
  const products: StepNameMatch[] = [];
  const shapes: StepNameMatch[] = [];

  const encoder = new TextEncoder();

  const entityPattern = /#\d+=\s*([A-Z][A-Z0-9_]*)\(([^;]*)\)\s*;/g;
  let match: RegExpExecArray | null;

  while ((match = entityPattern.exec(text)) !== null) {
    const entityType = match[1];
    const args = match[2];
    const matchStart = match.index;
    const matchEnd = matchStart + match[0].length;

    const startByte = encoder.encode(text.substring(0, matchStart)).length;
    const endByte = encoder.encode(text.substring(0, matchEnd)).length;

    if (entityType === "PRODUCT") {
      const name = extractFirstString(args);
      if (name) {
        const nameIdx = match[0].indexOf(`'${name}'`);
        const nameStart = nameIdx >= 0 ? startByte + nameIdx + 1 : startByte;
        const nameEnd = nameIdx >= 0 ? nameStart + encoder.encode(name).length : endByte;
        products.push({ name, startByte, endByte, nameStartByte: nameStart, nameEndByte: nameEnd });
      }
    } else if (
      entityType === "MANIFOLD_SOLID_BREP" ||
      entityType === "BREP_WITH_VOIDS" ||
      entityType === "FACETED_BREP"
    ) {
      const name = extractFirstString(args);
      if (name && name.length > 0) {
        const nameIdx = match[0].indexOf(`'${name}'`);
        const nameStart = nameIdx >= 0 ? startByte + nameIdx + 1 : startByte;
        const nameEnd = nameIdx >= 0 ? nameStart + encoder.encode(name).length : endByte;
        shapes.push({ name, startByte, endByte, nameStartByte: nameStart, nameEndByte: nameEnd });
      }
    } else if (entityType === "GEOMETRIC_TOLERANCE") {
      const name = extractFirstString(args);
      if (name && name.length > 0) {
        const nameIdx = match[0].indexOf(`'${name}'`);
        const nameStart = nameIdx >= 0 ? startByte + nameIdx + 1 : startByte;
        const nameEnd = nameIdx >= 0 ? nameStart + encoder.encode(name).length : endByte;
        shapes.push({ name, startByte, endByte, nameStartByte: nameStart, nameEndByte: nameEnd });
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

  get version(): number {
    return this._version;
  }

  get structuralRevision(): number {
    return this._version;
  }

  get fileCount(): number {
    return this.fileIndices.size;
  }

  public getMeshes(uri: string): any[] {
    return this.fileMeshes.get(uri) || [];
  }

  public getAssemblyModel(uri: string): StepAssemblyModel | undefined {
    return this.fileAssemblies.get(uri);
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

    let idCounter = 1000000;

    const product = products[0];
    const productName = product?.name || this.deriveProductNameFromUri(uri);

    const productId = idCounter++;
    const productEntry: SymbolEntry = {
      id: productId,
      kind: "Package",
      name: productName,
      ruleName: "step_product",
      namePath: productName,
      startByte: product?.startByte ?? 0,
      endByte: product?.endByte ?? 0,
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
        namePath: `${productName}::${shape.name}`,
        startByte: shape.startByte,
        endByte: shape.endByte,
        parentId: productId,
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
        namePath: `${productName}::${meshName}`,
        startByte: 0,
        endByte: 0,
        parentId: productId,
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

    childrenOf.set(productId, productChildren);

    return { symbols, byName, childrenOf };
  }

  private deriveProductNameFromUri(uri: string): string {
    const filename =
      uri
        .split("/")
        .pop()
        ?.replace(/\.(step|stp|p21)$/i, "") || "CADModel";
    return filename.charAt(0).toUpperCase() + filename.slice(1);
  }

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

  toUnified(): SymbolIndex {
    return this.mergeIndices();
  }

  async toUnifiedAsync(): Promise<SymbolIndex> {
    return this.mergeIndices();
  }

  toUnifiedPartial(): SymbolIndex {
    return this.mergeIndices();
  }

  toTreeIndex(): SymbolIndex {
    return this.mergeIndices();
  }
}
