// SPDX-License-Identifier: AGPL-3.0-or-later

import type { DslIndexFileContext } from "@modelscript/dsl";
import type { SymbolIndex, UnifiedWorkspace } from "@modelscript/runtime";
import { extractStepAssembly } from "./assembly-extractor.js";
import type { StepAssemblyModel } from "./physical-data.js";
import { scanStepEntities } from "./schema.js";

export interface OcctMesh {
  name?: string | undefined;
  color?: [number, number, number] | number[] | undefined;
  fromOcct?: boolean | undefined;
  attributes?:
    | {
        position?: { array?: Float32Array | number[] | undefined } | undefined;
        normal?: { array?: Float32Array | number[] | undefined } | undefined;
      }
    | undefined;
  index?: { array?: Uint32Array | Uint16Array | number[] | undefined } | undefined;
}

interface OcctTreeNode {
  name?: string | undefined;
  meshes?: number[] | undefined;
  children?: OcctTreeNode[] | undefined;
}

interface OcctInstance {
  ReadStepFile(
    content: Uint8Array,
    params: Record<string, unknown> | null,
  ): { meshes?: OcctMesh[] | undefined; root?: OcctTreeNode | undefined };
}

type OcctInitializer = (options?: { locateFile?: (path: string) => string }) => Promise<OcctInstance>;

let occtPromise: Promise<OcctInstance | null> | null = null;
let nodeRequire: NodeJS.Require | null = null;
const pendingMeshesByUri = new Map<string, OcctMesh[]>();

async function getNodeRequire(): Promise<NodeJS.Require | null> {
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

function getOcct(serverDistBase: string | null = null): Promise<OcctInstance | null> {
  if (!occtPromise) {
    occtPromise = (async () => {
      try {
        const mod = (await import("occt-import-js")) as { default?: OcctInitializer } & OcctInitializer;
        const init: OcctInitializer = mod.default || mod;
        const req = await getNodeRequire();
        return await init({
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
        console.error("[step] Failed to load occt-import-js:", e);
        occtPromise = null;
        return null;
      }
    })();
  }
  return occtPromise;
}

function extractFirstString(entityArgs: string): string | null {
  const match = entityArgs.match(/'([^']*)'/);
  return match ? match[1]! : null;
}

interface StepNameMatch {
  name: string;
  startOffset: number;
  endOffset: number;
  nameStartOffset: number;
  nameEndOffset: number;
}

function extractStepNames(text: string): {
  products: StepNameMatch[];
  shapes: StepNameMatch[];
} {
  const products: StepNameMatch[] = [];
  const shapes: StepNameMatch[] = [];

  const entities = scanStepEntities(text);
  for (const ent of entities) {
    const entityType = ent.type;
    if (
      entityType === "PRODUCT" ||
      entityType === "MANIFOLD_SOLID_BREP" ||
      entityType === "BREP_WITH_VOIDS" ||
      entityType === "FACETED_BREP" ||
      entityType === "GEOMETRIC_TOLERANCE"
    ) {
      const name = extractFirstString(ent.args);
      if (name && name.length > 0) {
        const fullMatch = text.slice(ent.startOffset, ent.endOffset);
        const startOffset = ent.startOffset;
        const endOffset = ent.endOffset;
        const nameIdx = fullMatch.indexOf(`'${name}'`);
        const nameStart = nameIdx >= 0 ? startOffset + nameIdx + 1 : startOffset;
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

function deriveProductNameFromUri(uri: string): string {
  const filename =
    uri
      .split("/")
      .pop()
      ?.replace(/\.(step|stp|p21)$/i, "") || "CADModel";
  return filename.charAt(0).toUpperCase() + filename.slice(1);
}

/**
 * Synchronous STEP file indexing hook registered on `stepLanguage.indexing.indexFile`.
 * Extracts ISO 10303-21 `PRODUCT` packages, B-Rep shape entities, assembly metadata, and any pre-tessellated OCCT meshes.
 */
export function indexStepFileSync(ctx: DslIndexFileContext): void {
  const { uri, text } = ctx;
  const { products, shapes } = extractStepNames(text);
  const assemblyModel = extractStepAssembly(text);
  ctx.setParsedModel(assemblyModel, "assembly");

  const meshes = pendingMeshesByUri.get(uri) ?? ctx.getParsedModel<OcctMesh[]>(uri, "meshes") ?? [];
  if (meshes.length > 0) {
    ctx.setParsedModel(meshes, "meshes");
  }

  const productList: (StepNameMatch | undefined)[] = products.length > 0 ? products : [undefined];
  let primaryProductId: number | null = null;
  let primaryProductName = productList[0]?.name || deriveProductNameFromUri(uri);

  for (let pIdx = 0; pIdx < productList.length; pIdx++) {
    const product = productList[pIdx];
    const productName = product?.name || deriveProductNameFromUri(uri);
    const productId = ctx.addSymbol(
      productName,
      "Package",
      null,
      product?.startOffset ?? 0,
      product?.endOffset ?? 0,
      { stepType: "Product", language: "step" },
      {
        ruleName: "step_product",
        namePath: productName,
        ...(product
          ? {
              nameStartOffset: product.nameStartOffset,
              nameEndOffset: product.nameEndOffset,
            }
          : {}),
      },
    );
    if (pIdx === 0) {
      primaryProductId = productId;
      primaryProductName = productName;
    }
  }

  const registeredShapes = new Set<string>();
  for (const shape of shapes) {
    if (registeredShapes.has(shape.name)) continue;
    registeredShapes.add(shape.name);
    ctx.addSymbol(
      shape.name,
      "Type",
      primaryProductId,
      shape.startOffset,
      shape.endOffset,
      { stepType: "NamedShape", language: "step" },
      {
        ruleName: "step_shape",
        namePath: `${primaryProductName}::${shape.name}`,
        nameStartOffset: shape.nameStartOffset,
        nameEndOffset: shape.nameEndOffset,
      },
    );
  }

  for (let i = 0; i < meshes.length; i++) {
    const mesh = meshes[i]!;
    const meshName = mesh.name || `Shape_${i}`;
    if (registeredShapes.has(meshName)) continue;
    registeredShapes.add(meshName);
    ctx.addSymbol(
      meshName,
      "Type",
      primaryProductId,
      0,
      0,
      {
        stepType: mesh.name ? "NamedShape" : "Face",
        meshIndex: i,
        color: mesh.color,
        language: "step",
      },
      {
        ruleName: "step_shape",
        namePath: `${primaryProductName}::${meshName}`,
      },
    );
  }
}

const inFlightStepIndexes = new WeakMap<
  UnifiedWorkspace,
  Map<string, { text: string; promise: Promise<SymbolIndex> }>
>();

const PMI_ONLY_STEP_ENTITY_TYPES = new Set([
  "PRODUCT_RELATED_PRODUCT_CATEGORY",
  "PROPERTY_DEFINITION",
  "PROPERTY_DEFINITION_REPRESENTATION",
  "REPRESENTATION",
  "REPRESENTATION_ITEM",
  "DESCRIPTIVE_REPRESENTATION_ITEM",
  "MEASURE_REPRESENTATION_ITEM",
  "SHAPE_ASPECT",
  "DATUM",
  "DATUM_SYSTEM",
  "DATUM_REFERENCE_COMPARTMENT",
  "GEOMETRIC_ITEM_SPECIFIC_USAGE",
  "APPLIED_NAME_ASSIGNMENT",
  "DIMENSIONAL_LOCATION",
  "DIMENSIONAL_SIZE",
  "CARTESIAN_POINT",
  "DIRECTION",
  "AXIS2_PLACEMENT_3D",
  "DATUM_FEATURE",
  "LENGTH_MEASURE_WITH_UNIT",
  "GEOMETRIC_TOLERANCE",
  "POSITION_TOLERANCE",
  "PERPENDICULARITY_TOLERANCE",
  "PARALLELISM_TOLERANCE",
  "FLATNESS_TOLERANCE",
  "CYLINDRICITY_TOLERANCE",
  "CIRCULARITY_TOLERANCE",
  "TOTAL_RUNOUT_TOLERANCE",
  "CIRCULAR_RUNOUT_TOLERANCE",
  "SURFACE_PROFILE_TOLERANCE",
  "LINE_PROFILE_TOLERANCE",
]);

/**
 * Extracts the geometry-bearing portion of STEP `DATA;` for OCCT tessellation caching.
 * Trailing AP242 PMI entities emitted after the final `SHAPE_DEFINITION_REPRESENTATION`
 * do not alter 3D B-Rep solids, so stripping them avoids 10+ second OCCT re-parses when only QIF tolerances change.
 */
function extractStepGeometryCacheKey(text: string): string {
  const dataMarker = /\r?\nDATA\s*;/.exec(text);
  const dataSection = dataMarker ? text.slice(dataMarker.index) : text;
  const lastProdIdx = dataSection.lastIndexOf("SHAPE_DEFINITION_REPRESENTATION(");
  if (lastProdIdx > 0) {
    const semiIdx = dataSection.indexOf(";", lastProdIdx);
    if (semiIdx > lastProdIdx) {
      const tail = dataSection.slice(semiIdx + 1);
      const entityTypeRe = /#\d+\s*=\s*([A-Z0-9_]+)\s*\(/g;
      let onlyPmi = true;
      let match: RegExpExecArray | null;
      while ((match = entityTypeRe.exec(tail)) !== null) {
        if (!PMI_ONLY_STEP_ENTITY_TYPES.has(match[1]!)) {
          onlyPmi = false;
          break;
        }
      }
      if (onlyPmi) {
        return dataSection.slice(0, semiIdx + 1);
      }
    }
  }
  return dataSection;
}

/**
 * Asynchronously tessellates a STEP document via OpenCascade (`occt-import-js` or pure-TS B-Rep fallback)
 * and indexes its products, shapes, meshes, and assembly hierarchy into `workspace`.
 */
export async function indexStepDocument(
  workspace: UnifiedWorkspace,
  uri: string,
  bufferOrText: Uint8Array | string,
  options?: { serverDistBase?: string | null | undefined },
): Promise<SymbolIndex> {
  if (!workspace.getLanguageDef("step")) {
    const { stepLanguage } = await import("./language.js");
    workspace.registerLanguageDef("step", stepLanguage);
  }

  const buffer = typeof bufferOrText === "string" ? new TextEncoder().encode(bufferOrText) : bufferOrText;
  const text = typeof bufferOrText === "string" ? bufferOrText : new TextDecoder().decode(bufferOrText);
  const dataSection = extractStepGeometryCacheKey(text);

  const cachedIndexedText = workspace.getParsedModel<string>(uri, "indexedSourceText");
  const cachedSourceText = workspace.getParsedModel<string>(uri, "meshesSourceText");
  const cachedDataSection = workspace.getParsedModel<string>(uri, "meshesDataText");
  const cachedMeshes = workspace.getParsedModel<OcctMesh[]>(uri, "meshes");
  if (cachedIndexedText === text && cachedSourceText === text && cachedMeshes && cachedMeshes.length > 0) {
    return workspace.getIndex();
  }

  let wsInFlight = inFlightStepIndexes.get(workspace);
  if (!wsInFlight) {
    wsInFlight = new Map();
    inFlightStepIndexes.set(workspace, wsInFlight);
  }
  const existing = wsInFlight.get(uri);
  if (existing && existing.text === text) {
    return existing.promise;
  }

  const run = async (): Promise<SymbolIndex> => {
    let meshes: OcctMesh[] = [];
    if (cachedDataSection === dataSection && cachedMeshes && cachedMeshes.length > 0) {
      meshes = cachedMeshes;
    } else {
      const occt = await getOcct(options?.serverDistBase ?? null);
      if (occt) {
        try {
          const result = occt.ReadStepFile(buffer, null);
          meshes = result?.meshes || [];
          if (result?.root && meshes.length > 0) {
            const assignNodeNames = (node: unknown, inheritedName: string): void => {
              if (!node || typeof node !== "object") return;
              const rec = node as { name?: unknown; meshes?: unknown; children?: unknown };
              const ownName =
                typeof rec.name === "string" && rec.name.trim().length > 0 ? rec.name.trim() : inheritedName;
              if (Array.isArray(rec.meshes)) {
                for (const meshIdx of rec.meshes) {
                  if (typeof meshIdx !== "number") continue;
                  const mesh = meshes[meshIdx];
                  if (mesh && (!mesh.name || !mesh.name.trim()) && ownName) {
                    mesh.name = ownName;
                  }
                }
              }
              if (Array.isArray(rec.children)) {
                for (const child of rec.children) {
                  assignNodeNames(child, ownName);
                }
              }
            };
            assignNodeNames(result.root, "");
          }
          for (const mesh of meshes as Array<OcctMesh & { fromOcct?: boolean }>) {
            if (mesh) mesh.fromOcct = true;
          }
        } catch (e) {
          console.error(`[step] OCCT parse failed for ${uri}:`, e);
        }
      }
      if (meshes.length === 0) {
        try {
          const { tessellateStepSolid } = await import("./occ.js");
          const stepMesh = tessellateStepSolid(text);
          if (stepMesh.triangleCount > 0) {
            const targets = stepMesh.solids.length > 0 ? stepMesh.solids : [stepMesh];
            meshes = targets.map((s) => ({
              name: s.name,
              attributes: {
                position: { array: s.vertices },
                normal: { array: s.normals },
              },
              index: { array: s.indices },
            }));
          }
        } catch {
          // ignore fallback tessellation errors
        }
      }
    }

    pendingMeshesByUri.set(uri, meshes);
    try {
      const fileIndex = workspace.indexDocumentText(uri, text, "step");
      workspace.setParsedModel(uri, meshes, "meshes");
      workspace.setParsedModel(uri, text, "meshesSourceText");
      workspace.setParsedModel(uri, dataSection, "meshesDataText");
      workspace.setParsedModel(uri, text, "indexedSourceText");
      return (
        fileIndex ?? {
          symbols: new Map(),
          byName: new Map(),
          childrenOf: new Map(),
        }
      );
    } finally {
      pendingMeshesByUri.delete(uri);
    }
  };

  const promise = run().finally(() => {
    const cur = wsInFlight?.get(uri);
    if (cur?.promise === promise) {
      wsInFlight.delete(uri);
    }
  });
  wsInFlight.set(uri, { text, promise });
  return promise;
}

/**
 * Retrieves cached triangulated OCCT meshes for `uri` (or across all STEP documents when `uri` is omitted).
 */
export function getStepMeshes(workspace: UnifiedWorkspace | undefined, uri?: string): OcctMesh[] {
  if (!workspace) return [];
  if (uri) {
    return workspace.getParsedModel<OcctMesh[]>(uri, "meshes") ?? [];
  }
  const out: OcctMesh[] = [];
  for (const list of workspace.getAllParsedModels<OcctMesh[]>("meshes").values()) {
    out.push(...list);
  }
  return out;
}

/**
 * Retrieves the extracted `StepAssemblyModel` for `uri` (or the first indexed STEP assembly if `uri` is omitted).
 */
export function getStepAssemblyModel(
  workspace: UnifiedWorkspace | undefined,
  uri?: string,
): StepAssemblyModel | undefined {
  if (!workspace) return undefined;
  if (uri) {
    return workspace.getParsedModel<StepAssemblyModel>(uri, "assembly");
  }
  return workspace.getAllParsedModels<StepAssemblyModel>("assembly").values().next().value;
}
