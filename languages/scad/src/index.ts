// SPDX-License-Identifier: AGPL-3.0-or-later

import { compileToStep, ManifoldWorker, SolidKind, type Solid, type SolidSourceMetadata } from "@modelscript/cad";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createWasmParser, type TreeSitterParser } from "../src-gen/bindings.js";
import { ScadErrorCode } from "./errors.js";
import { ScadEvaluator, type ScadEvaluationOptions } from "./evaluator.js";
import { scadLanguage } from "./language.js";
import { lintScadCst, type ScadDiagnostic } from "./linter.js";
import { ScadPatcher, type ScadCstNode, type ScadCstTree } from "./patcher.js";

export * from "./workspace-index.js";
export { lintScadCst, ScadErrorCode, ScadEvaluator, scadLanguage, ScadPatcher };
export type { ScadCstNode, ScadCstTree, ScadDiagnostic, ScadEvaluationOptions };

export interface ScadCadComponent {
  name: string;
  cad: {
    uri: string;
    position?: [number, number, number] | undefined;
    rotation?: [number, number, number] | undefined;
    scale?: [number, number, number] | undefined;
  };
  proceduralMesh: {
    vertices: number[];
    indices: number[];
    normals: number[];
    color?: [number, number, number, number] | undefined;
  };
  ports: {
    name: string;
    port: {
      feature: string;
      offsetPosition?: [number, number, number] | undefined;
    };
  }[];
  dynamicBindings: unknown[];
  sourceMetadata?: SolidSourceMetadata | undefined;
}

let cachedParser: TreeSitterParser | null = null;

function findFile(relativePaths: string[]): string {
  const currentDir = path.dirname(fileURLToPath(import.meta.url));
  for (const rel of relativePaths) {
    const candidate = path.resolve(currentDir, rel);
    if (fs.existsSync(candidate)) return candidate;
  }
  return path.resolve(currentDir, relativePaths[0]!);
}

/**
 * Initializes or retrieves the singleton WebAssembly GLR parser for SCAD.
 */
export async function getScadParser(wasmUrlOrBytes?: Uint8Array | ArrayBuffer | string): Promise<TreeSitterParser> {
  if (cachedParser) return cachedParser;

  let wasmInput: Uint8Array | ArrayBuffer | string | undefined = wasmUrlOrBytes;
  if (!wasmInput) {
    if (
      typeof fs?.readFileSync === "function" &&
      typeof import.meta?.url === "string" &&
      import.meta.url.startsWith("file:")
    ) {
      const wasmPath = findFile(["../parser.wasm", "../dist/parser.wasm", "../../dist/parser.wasm", "parser.wasm"]);
      wasmInput = fs.readFileSync(wasmPath);
    } else {
      const serverBase = (globalThis as { serverDistBase?: string | undefined }).serverDistBase;
      wasmInput = serverBase ? `${serverBase.replace(/\/$/, "")}/scad.wasm` : "scad.wasm";
    }
  }

  const { parser } = await createWasmParser(wasmInput);
  cachedParser = parser;
  return parser;
}

/**
 * Parses and semantically lints OpenSCAD source code, returning diagnostics with narrow byte and line/column ranges.
 */
export async function lintScad(source: string): Promise<ScadDiagnostic[]> {
  const parser = await getScadParser();
  const tree = parser.parse(source);
  if (!tree) return [];
  return lintScadCst(tree.rootNode, source);
}

/**
 * Parses and evaluates SCAD source code into a @modelscript/cad Solid CSG tree.
 */
export async function compileScadToSolid(source: string, options?: ScadEvaluationOptions): Promise<Solid | null> {
  const parser = await getScadParser();
  const tree = parser.parse(source);
  if (!tree) return null;
  const evaluator = new ScadEvaluator(options);
  return evaluator.evaluate(tree.rootNode);
}

function collectSelectableParts(solid: Solid, out: Solid[]): void {
  if (solid.kind === SolidKind.Union) {
    collectSelectableParts(solid.left, out);
    collectSelectableParts(solid.right, out);
    return;
  }
  out.push(solid);
}

/**
 * Evaluates SCAD source into interactive 3D `CadComponent` objects with procedural triangle meshes
 * and AST `sourceMetadata` for 3D gizmo manipulation in `CadViewerPanel`.
 */
export async function extractScadCadComponents(
  source: string,
  rootNode?: ScadCstNode | null,
  uri?: string,
  options?: ScadEvaluationOptions,
): Promise<ScadCadComponent[]> {
  let root = rootNode;
  if (!root) {
    const parser = await getScadParser();
    const tree = parser.parse(source);
    root = tree?.rootNode;
  }
  if (!root) return [];

  const evaluator = new ScadEvaluator(options);
  const topSolids = evaluator.evaluateParts(root);
  const parts: Solid[] = [];
  for (const s of topSolids) {
    collectSelectableParts(s, parts);
  }

  const components: ScadCadComponent[] = [];
  for (let i = 0; i < parts.length; i++) {
    const part = parts[i]!;
    const mesh = ManifoldWorker.evaluateSolid(part);
    if (mesh.indices.length === 0) continue;

    const meta = part.sourceMetadata ?? mesh.sourceMetadata;
    const userPos: [number, number, number] = meta?.translation
      ? [meta.translation[0], meta.translation[1], meta.translation[2]]
      : [0, 0, 0];

    // Shift vertices into the component's local frame so `<group position={userPos}>`
    // places the TransformControls gizmo at `userPos` without double-translating the mesh.
    const shiftedVerts = new Array<number>(mesh.vertices.length);
    for (let v = 0; v < mesh.vertices.length; v += 3) {
      shiftedVerts[v] = mesh.vertices[v]! - userPos[0];
      shiftedVerts[v + 1] = mesh.vertices[v + 1]! - userPos[1];
      shiftedVerts[v + 2] = mesh.vertices[v + 2]! - userPos[2];
    }

    const ports = mesh.tags.map((t, tagIdx) => {
      const rawOrigin = (t as { origin?: unknown }).origin;
      let offsetPosition: [number, number, number] = [0, 0, 0];
      if (Array.isArray(rawOrigin) && rawOrigin.length >= 3) {
        offsetPosition = [Number(rawOrigin[0]), Number(rawOrigin[1]), Number(rawOrigin[2])];
      } else if (mesh.faceTagIndices && mesh.faceTagIndices.length > 0) {
        const targetTagId = tagIdx + 1;
        let sx = 0;
        let sy = 0;
        let sz = 0;
        let count = 0;
        for (let f = 0; f < mesh.faceTagIndices.length; f++) {
          if (mesh.faceTagIndices[f] === targetTagId) {
            const i0 = mesh.indices[f * 3]! * 3;
            const i1 = mesh.indices[f * 3 + 1]! * 3;
            const i2 = mesh.indices[f * 3 + 2]! * 3;
            sx += (shiftedVerts[i0]! + shiftedVerts[i1]! + shiftedVerts[i2]!) / 3;
            sy += (shiftedVerts[i0 + 1]! + shiftedVerts[i1 + 1]! + shiftedVerts[i2 + 1]!) / 3;
            sz += (shiftedVerts[i0 + 2]! + shiftedVerts[i1 + 2]! + shiftedVerts[i2 + 2]!) / 3;
            count++;
          }
        }
        if (count > 0) {
          offsetPosition = [sx / count, sy / count, sz / count];
        }
      }
      return {
        name: t.portName,
        port: {
          feature: t.portType,
          offsetPosition,
        },
      };
    });

    const compName = `${part.name || "part"}_${i + 1}`;
    components.push({
      name: compName,
      cad: {
        uri: uri ? `${uri}#${compName}` : `scad://${compName}`,
        position: userPos,
        rotation: meta?.rotation ? [meta.rotation[0], meta.rotation[1], meta.rotation[2]] : [0, 0, 0],
        scale: meta?.scale ? [meta.scale[0], meta.scale[1], meta.scale[2]] : [1, 1, 1],
      },
      proceduralMesh: {
        vertices: shiftedVerts,
        indices: Array.from(mesh.indices),
        normals: Array.from(mesh.normals),
        color: meta?.color ? [meta.color[0], meta.color[1], meta.color[2], meta.color[3]] : undefined,
      },
      ports,
      dynamicBindings: [],
      sourceMetadata: meta,
    });
  }

  return components;
}

/**
 * Parses and evaluates SCAD source code directly into a STEP Part 21 string.
 */
export async function compileScadToStep(source: string, options?: ScadEvaluationOptions): Promise<string> {
  const solid = await compileScadToSolid(source, options);
  if (!solid) {
    throw new Error("Failed to compile SCAD: no solid geometry generated");
  }
  return compileToStep(solid);
}
