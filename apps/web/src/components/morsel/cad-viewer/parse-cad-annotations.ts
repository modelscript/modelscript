// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Utility to parse CAD annotation strings from flattened DAE variables
 * into structured CadComponent objects for the CadViewer.
 */

import {
  createMslPipeSurfaceMesh,
  createMslRectangleSurfaceMesh,
  createMslShapeMesh,
  createMslTorusMesh,
} from "@modelscript/modelica/extensions";
import type { CadAnnotation, CadComponent, CadPortAnnotation, ProceduralMeshData } from "./CadViewer";

/**
 * Parse a CAD annotation string like:
 *   `CAD(uri="modelica://Lib/part.glb", scale={1, 1, 1})`
 * into a structured CadAnnotation object.
 */
export function parseCadAnnotationString(cadStr: string): CadAnnotation | CadPortAnnotation | null {
  // Determine type prefix
  const isCAD = cadStr.startsWith("CAD(");
  const isCADPort = cadStr.startsWith("CADPort(");
  if (!isCAD && !isCADPort) return null;

  const prefix = isCAD ? "CAD(" : "CADPort(";
  const inner = cadStr.slice(prefix.length, -1); // strip "CAD(" and ")"

  const result: Record<string, string | number | boolean | number[]> = {};

  // Parse key=value pairs (handles strings, numbers, booleans, arrays)
  const regex = /(\w+)\s*=\s*(?:"([^"]*)"|\{([^}]*)\}|(true|false)|([0-9.eE+-]+))/g;
  let match;
  while ((match = regex.exec(inner)) !== null) {
    const key = match[1]!;
    if (match[2] !== undefined) {
      // String value
      result[key] = match[2];
    } else if (match[3] !== undefined) {
      // Array value
      result[key] = match[3].split(",").map((s) => parseFloat(s.trim()));
    } else if (match[4] !== undefined) {
      // Boolean value
      result[key] = match[4] === "true";
    } else if (match[5] !== undefined) {
      // Numeric value
      result[key] = parseFloat(match[5]);
    }
  }

  if (isCAD) {
    return {
      uri: (result["uri"] as string) ?? "",
      position: result["position"] as [number, number, number] | undefined,
      rotation: result["rotation"] as [number, number, number] | undefined,
      scale: result["scale"] as [number, number, number] | undefined,
    } satisfies CadAnnotation;
  } else {
    return {
      feature: (result["feature"] as string) ?? "",
      offsetPosition: result["offsetPosition"] as [number, number, number] | undefined,
      offsetRotation: result["offsetRotation"] as [number, number, number] | undefined,
      offsetScale: result["offsetScale"] as [number, number, number] | undefined,
    } satisfies CadPortAnnotation;
  }
}

export interface RawCadVariableEntry {
  name: string;
  cad: string | CadAnnotation;
  ports?: { name: string; port: CadPortAnnotation }[] | undefined;
  dynamicBindings?: { property: string; index: number; variable: string }[] | undefined;
  proceduralMesh?: ProceduralMeshData | undefined;
  defaults?: Record<string, unknown> | undefined;
  shapeType?: string | undefined;
}

function parseModifierNum(modStr: string, name: string, fallback: number): number {
  const m = new RegExp(`\\b${name}\\s*=\\s*([+-]?\\d*\\.?\\d+(?:[eE][+-]?\\d+)?)`).exec(modStr);
  if (!m?.[1]) return fallback;
  const v = parseFloat(m[1]);
  return Number.isFinite(v) ? v : fallback;
}

function parseModifierVec3(modStr: string, name: string, fallback: [number, number, number]): [number, number, number] {
  const m = new RegExp(`\\b${name}\\s*=\\s*\\{\\s*([^}]+)\\}`).exec(modStr);
  if (!m?.[1]) return fallback;
  const parts = m[1].split(",").map((s) => parseFloat(s.trim()));
  return [
    Number.isFinite(parts[0]) ? parts[0]! : fallback[0],
    Number.isFinite(parts[1]) ? parts[1]! : fallback[1],
    Number.isFinite(parts[2]) ? parts[2]! : fallback[2],
  ];
}

function parseModifierStr(modStr: string, name: string, fallback: string): string {
  const m = new RegExp(`\\b${name}\\s*=\\s*"([^"]*)"`).exec(modStr);
  return m?.[1] !== undefined ? m[1] : fallback;
}

function normalizeRgba(rgb: [number, number, number]): [number, number, number, number] {
  const scale = rgb[0] > 1 || rgb[1] > 1 || rgb[2] > 1 ? 1 / 255 : 1;
  return [
    Math.min(1, Math.max(0, rgb[0] * scale)),
    Math.min(1, Math.max(0, rgb[1] * scale)),
    Math.min(1, Math.max(0, rgb[2] * scale)),
    1.0,
  ];
}

/**
 * Parse source-level `annotation(... cad(...))` / `CAD(...)` / `CAD="..."` and
 * `Modelica.Mechanics.MultiBody.Visualizers` / `MultiBody` components from Modelica code
 * into DAE-shaped variable objects suitable for `extractCadComponents`.
 */
export function parseSourceCadVariables(source: string): RawCadVariableEntry[] {
  if (!source || typeof source !== "string") return [];
  const results: RawCadVariableEntry[] = [];
  const seen = new Set<string>();

  // 1. Match component declarations with annotation(... CAD(...) / cad(...) / CADPort(...) ...)
  const declRegex =
    /\b(?:parameter\s+|input\s+|output\s+|discrete\s+|constant\s+)?[A-Za-z_][\w.]*\s+([A-Za-z_]\w*)\b[^;]*?\bannotation\s*\(([\s\S]*?)\)\s*;/g;
  let match: RegExpExecArray | null;
  while ((match = declRegex.exec(source)) !== null) {
    const varName = match[1]!;
    const annBody = match[2] || "";
    const cadMatch = /\b(CADPort|CAD|cad)\s*\(([^)]*)\)/.exec(annBody);
    if (cadMatch) {
      const prefix = cadMatch[1] === "CADPort" ? "CADPort" : "CAD";
      const cadStr = `${prefix}(${cadMatch[2] || ""})`;
      const key = `${varName}:${cadStr}`;
      if (!seen.has(key)) {
        seen.add(key);
        results.push({ name: varName, cad: cadStr });
      }
    }
  }

  // 2. Match explicit CAD="CAD(...)" string modifiers
  const attrRegex = /\b([A-Za-z_]\w*)\s*\([^;]*?\bCAD\s*=\s*"((?:CADPort|CAD)\([^"]*\))"/g;
  while ((match = attrRegex.exec(source)) !== null) {
    const varName = match[1]!;
    const cadStr = match[2]!;
    const key = `${varName}:${cadStr}`;
    if (!seen.has(key)) {
      seen.add(key);
      results.push({ name: varName, cad: cadStr });
    }
  }

  // 3. Match standard Modelica.Mechanics.MultiBody.Visualizers & MultiBody components
  const mslRegex =
    /\b((?:Modelica\.Mechanics\.MultiBody\.)?(?:Visualizers\.(?:Advanced\.)?(?:FixedShape2?|Shape|FixedArrow|SignalArrow|ForceArrow|TorqueArrow|VelocityArrow|Arrow|DoubleArrow|Vector|Torus|VoluminousWheel|Rectangle|PipeWithScalarField)|Parts\.(?:BodyCylinder|BodyBox|BodyShape|Body|FixedTranslation)|Forces\.Spring|Joints\.(?:Revolute|Prismatic)))\s+([A-Za-z_]\w*)\s*(?:\(([\s\S]*?)\))?\s*(?:annotation\s*\([\s\S]*?\))?\s*;/g;

  while ((match = mslRegex.exec(source)) !== null) {
    const typeSpec = match[1]!;
    const varName = match[2]!;
    const modStr = match[3] || "";
    if (seen.has(varName)) continue;
    seen.add(varName);

    const shortType = typeSpec.split(".").pop()!;
    const r0 = parseModifierVec3(modStr, "r", [0, 0, 0]);
    const rShape = parseModifierVec3(modStr, "r_shape", [0, 0, 0]);
    const colorRgb = parseModifierVec3(modStr, "color", [0, 128, 255]);
    const rgba = normalizeRgba(colorRgb);

    if (shortType === "Torus" || shortType === "VoluminousWheel") {
      const ri = parseModifierNum(modStr, "ri", 0.5);
      const ro = parseModifierNum(modStr, "ro", 0.1);
      const mesh = createMslTorusMesh(ri, ro, 36, 18, rgba);
      results.push({
        name: varName,
        shapeType: "surface:torus",
        cad: `CAD(uri="procedural://msl-surface/torus", position={${r0.join(", ")}}, scale={1, 1, 1})`,
        proceduralMesh: mesh,
        defaults: {
          position: r0,
          scale: [1, 1, 1],
          color: [rgba[0], rgba[1], rgba[2]],
        },
        dynamicBindings: [
          { property: "position", index: 0, variable: `${varName}.frame_a.r_0[1]` },
          { property: "position", index: 1, variable: `${varName}.frame_a.r_0[2]` },
          { property: "position", index: 2, variable: `${varName}.frame_a.r_0[3]` },
        ],
      });
    } else if (shortType === "Rectangle") {
      const length = parseModifierNum(modStr, "length", 1.0);
      const width = parseModifierNum(modStr, "width", 0.5);
      const mesh = createMslRectangleSurfaceMesh(length, width, 4, 4, rgba);
      results.push({
        name: varName,
        shapeType: "surface:rectangle",
        cad: `CAD(uri="procedural://msl-surface/rectangle", position={${r0.join(", ")}}, scale={1, 1, 1})`,
        proceduralMesh: mesh,
        defaults: {
          position: r0,
          scale: [1, 1, 1],
          color: [rgba[0], rgba[1], rgba[2]],
        },
        dynamicBindings: [
          { property: "position", index: 0, variable: `${varName}.frame_a.r_0[1]` },
          { property: "position", index: 1, variable: `${varName}.frame_a.r_0[2]` },
          { property: "position", index: 2, variable: `${varName}.frame_a.r_0[3]` },
        ],
      });
    } else if (shortType === "PipeWithScalarField") {
      const length = parseModifierNum(modStr, "length", 1.0);
      const rOuter = parseModifierNum(modStr, "r_outer", 0.1);
      const mesh = createMslPipeSurfaceMesh(length, rOuter, 16, 24, rgba);
      results.push({
        name: varName,
        shapeType: "surface:pipeWithScalarField",
        cad: `CAD(uri="procedural://msl-surface/pipe", position={${r0.join(", ")}}, scale={1, 1, 1})`,
        proceduralMesh: mesh,
        defaults: {
          position: r0,
          scale: [1, 1, 1],
          color: [rgba[0], rgba[1], rgba[2]],
        },
        dynamicBindings: [
          { property: "position", index: 0, variable: `${varName}.frame_a.r_0[1]` },
          { property: "position", index: 1, variable: `${varName}.frame_a.r_0[2]` },
          { property: "position", index: 2, variable: `${varName}.frame_a.r_0[3]` },
        ],
      });
    } else if (
      shortType === "FixedArrow" ||
      shortType === "SignalArrow" ||
      shortType === "ForceArrow" ||
      shortType === "TorqueArrow" ||
      shortType === "VelocityArrow" ||
      shortType === "Arrow" ||
      shortType === "DoubleArrow" ||
      shortType === "Vector"
    ) {
      const diameter = parseModifierNum(modStr, "diameter", 0.025);
      const quantity = parseModifierStr(modStr, "quantity", "").toLowerCase();
      const shapeKind = shortType === "DoubleArrow" || quantity.includes("torque") ? "doublearrow" : "arrow";
      const length = parseModifierNum(modStr, "length", 0.5);
      const lengthDir = parseModifierVec3(modStr, "n", [1, 0, 0]);
      const mesh = createMslShapeMesh(shapeKind, 0, rgba);
      results.push({
        name: varName,
        shapeType: shapeKind,
        cad: `CAD(uri="procedural://msl/${shapeKind}", position={${r0.join(", ")}}, scale={${length}, ${diameter}, ${diameter}})`,
        proceduralMesh: mesh,
        defaults: {
          position: r0,
          scale: [length, diameter, diameter],
          shapeOffset: rShape,
          lengthDirection: lengthDir,
          widthDirection: [0, 1, 0],
          vectorCoordinates: shortType !== "FixedArrow",
          color: [rgba[0], rgba[1], rgba[2]],
        },
        dynamicBindings: [
          { property: "position", index: 0, variable: `${varName}.frame_a.r_0[1]` },
          { property: "position", index: 1, variable: `${varName}.frame_a.r_0[2]` },
          { property: "position", index: 2, variable: `${varName}.frame_a.r_0[3]` },
          { property: "vectorCoordinates", index: 0, variable: `${varName}.r_head[1]` },
          { property: "vectorCoordinates", index: 1, variable: `${varName}.r_head[2]` },
          { property: "vectorCoordinates", index: 2, variable: `${varName}.r_head[3]` },
        ],
      });
    } else {
      let shapeType = parseModifierStr(
        modStr,
        "shapeType",
        shortType === "Spring"
          ? "spring"
          : shortType === "BodyBox"
            ? "box"
            : shortType === "Body"
              ? "sphere"
              : "cylinder",
      );
      const rVec = parseModifierVec3(modStr, "r", [0.5, 0, 0]);
      const rNorm = Math.hypot(rVec[0], rVec[1], rVec[2]);
      const defaultLen = rNorm > 1e-6 ? rNorm : 0.5;
      const length = parseModifierNum(modStr, "length", defaultLen);
      const diameter = parseModifierNum(modStr, "diameter", 0.1);
      const width = parseModifierNum(modStr, "width", diameter);
      const height = parseModifierNum(modStr, "height", width);
      const extra = parseModifierNum(
        modStr,
        "extra",
        shortType === "Spring" ? parseModifierNum(modStr, "numberOfWindings", 6) : 0,
      );
      const lengthDir = parseModifierVec3(
        modStr,
        "lengthDirection",
        shortType === "Revolute" || shortType === "Prismatic"
          ? parseModifierVec3(modStr, "n", [0, 0, 1])
          : rNorm > 1e-6
            ? [rVec[0] / rNorm, rVec[1] / rNorm, rVec[2] / rNorm]
            : [1, 0, 0],
      );
      const widthDir = parseModifierVec3(modStr, "widthDirection", [0, 1, 0]);
      if (shapeType.startsWith("modelica://")) {
        results.push({
          name: varName,
          shapeType,
          cad: `CAD(uri="${shapeType}", position={${r0.join(", ")}}, scale={${length}, ${width}, ${height}})`,
          defaults: {
            position: r0,
            scale: [length, width, height],
            shapeOffset: rShape,
            lengthDirection: lengthDir,
            widthDirection: widthDir,
            color: [rgba[0], rgba[1], rgba[2]],
          },
        });
      } else {
        shapeType = shapeType.toLowerCase();
        const mesh = createMslShapeMesh(shapeType, extra, rgba);
        const bindings: { property: string; index: number; variable: string }[] = [
          { property: "position", index: 0, variable: `${varName}.frame_a.r_0[1]` },
          { property: "position", index: 1, variable: `${varName}.frame_a.r_0[2]` },
          { property: "position", index: 2, variable: `${varName}.frame_a.r_0[3]` },
          { property: "position", index: 0, variable: `${varName}.r_0[1]` },
          { property: "position", index: 1, variable: `${varName}.r_0[2]` },
          { property: "position", index: 2, variable: `${varName}.r_0[3]` },
        ];
        if (shortType === "Revolute") {
          bindings.push({ property: "rotation", index: 2, variable: `${varName}.phi` });
        }
        results.push({
          name: varName,
          shapeType,
          cad: `CAD(uri="procedural://msl/${shapeType}", position={${r0.join(", ")}}, scale={${length}, ${width}, ${height}})`,
          proceduralMesh: mesh,
          defaults: {
            position: r0,
            scale: [length, width, height],
            shapeOffset: rShape,
            lengthDirection: lengthDir,
            widthDirection: widthDir,
            ...(shortType === "Spring" ? { vectorCoordinates: true } : {}),
            color: [rgba[0], rgba[1], rgba[2]],
          },
          dynamicBindings: bindings,
        });
      }
    }
  }

  return results;
}

/**
 * Extract CadComponent entries from a DAE JSON representation or Modelica source string.
 *
 * Expects variables in the format `{ name: "x", cad: "CAD(uri=\"...\")" }`
 * or `{ name: "x", cad: { uri: "..." }, proceduralMesh, defaults }`.
 */
export function extractCadComponents(daeVariables: any[] | string): CadComponent[] {
  const normalizedVars: any[] =
    typeof daeVariables === "string"
      ? parseSourceCadVariables(daeVariables)
      : Array.isArray(daeVariables)
        ? daeVariables
        : [];
  const components: CadComponent[] = [];
  const portsByParent = new Map<string, { name: string; port: CadPortAnnotation }[]>();

  for (const v of normalizedVars) {
    if (!v || typeof v !== "object" || !v.cad) continue;
    if (typeof v.cad === "object") {
      components.push({
        name: v.name,
        cad: v.cad as CadAnnotation,
        ports: v.ports ?? [],
        dynamicBindings: v.dynamicBindings ?? undefined,
        proceduralMesh: v.proceduralMesh ?? undefined,
        defaults: v.defaults ?? undefined,
        shapeType: v.shapeType ?? undefined,
      });
      continue;
    }

    const cadStr = v.cad as string;
    const parsed = parseCadAnnotationString(cadStr);
    if (!parsed) continue;

    if (cadStr.startsWith("CAD(")) {
      components.push({
        name: v.name,
        cad: parsed as CadAnnotation,
        ports: v.ports ?? [],
        dynamicBindings: v.dynamicBindings ?? undefined,
        proceduralMesh: v.proceduralMesh ?? undefined,
        defaults: v.defaults ?? undefined,
        shapeType: v.shapeType ?? undefined,
      });
    } else if (cadStr.startsWith("CADPort(")) {
      // CADPort annotations are on leaf variables like "body.port1"
      const parts = (v.name as string).split(".");
      const parentName = parts.slice(0, -1).join(".");
      const portName = parts[parts.length - 1]!;
      if (!portsByParent.has(parentName)) portsByParent.set(parentName, []);
      portsByParent.get(parentName)!.push({
        name: portName,
        port: parsed as CadPortAnnotation,
      });
    }
  }

  // Attach ports to their parent components
  for (const comp of components) {
    const ports = portsByParent.get(comp.name);
    if (ports && ports.length > 0) comp.ports = ports;
  }

  return components;
}
