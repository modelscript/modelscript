// SPDX-License-Identifier: AGPL-3.0-or-later

import { compileToStep, ManifoldWorker, SolidKind, type Solid, type SolidSourceMetadata } from "@modelscript/cad";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createWasmParser, type TreeSitterParser } from "../src-gen/bindings.js";
import { ScadEvaluator, type ScadEvaluationOptions } from "./evaluator.js";
import { scadLanguage } from "./language.js";
import { lintScadCst, type ScadDiagnostic } from "./linter.js";
import { ScadPatcher } from "./patcher.js";

export { lintScadCst, ScadEvaluator, scadLanguage, ScadPatcher };
export type { ScadDiagnostic, ScadEvaluationOptions };

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
  dynamicBindings: any[];
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
      wasmInput = "scad.wasm";
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
  rootNode?: any,
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

    const ports = mesh.tags.map((t) => {
      const rawOrigin = (t as any).origin;
      return {
        name: t.portName,
        port: {
          feature: t.portType,
          offsetPosition: (Array.isArray(rawOrigin) && rawOrigin.length >= 3
            ? [Number(rawOrigin[0]), Number(rawOrigin[1]), Number(rawOrigin[2])]
            : [0, 0, 0]) as [number, number, number],
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
