// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Utility to parse CAD annotation strings from flattened DAE variables
 * into structured CadComponent objects for the CadViewer.
 */

import type { CadAnnotation, CadComponent, CadPortAnnotation } from "./cad-viewer";

/**
 * Parse a CAD annotation string like:
 *   `CAD(uri="modelica://Lib/part.glb", scale={1, 1, 1})`
 * into a structured CadAnnotation object.
 */
function parseTopLevelCadKvArgs(inner: string): Record<string, string | number | boolean | number[]> {
  const result: Record<string, string | number | boolean | number[]> = {};
  let i = 0;
  const n = inner.length;
  const skipWs = () => {
    while (i < n && /\s/.test(inner[i]!)) i++;
  };
  while (i < n) {
    skipWs();
    if (inner[i] === ",") {
      i++;
      continue;
    }
    const keyStart = i;
    while (i < n && /\w/.test(inner[i]!)) i++;
    const key = inner.slice(keyStart, i);
    if (!key) {
      i++;
      continue;
    }
    skipWs();
    if (inner[i] !== "=") {
      while (i < n && inner[i] !== ",") i++;
      continue;
    }
    i++;
    skipWs();
    if (inner[i] === '"') {
      i++;
      let strVal = "";
      while (i < n && inner[i] !== '"') {
        if (inner[i] === "\\" && i + 1 < n) i++;
        strVal += inner[i]!;
        i++;
      }
      if (inner[i] === '"') i++;
      result[key] = strVal;
    } else if (inner[i] === "{") {
      const valStart = i + 1;
      let braceDepth = 1;
      let parenDepth = 0;
      let inStr = false;
      i++;
      while (i < n && braceDepth > 0) {
        const ch = inner[i]!;
        if (inStr) {
          if (ch === "\\" && i + 1 < n) i++;
          else if (ch === '"') inStr = false;
        } else if (ch === '"') {
          inStr = true;
        } else if (ch === "(") {
          parenDepth++;
        } else if (ch === ")") {
          parenDepth = Math.max(0, parenDepth - 1);
        } else if (ch === "{") {
          braceDepth++;
        } else if (ch === "}") {
          braceDepth--;
          if (braceDepth === 0) break;
        }
        i++;
      }
      const rawBraceInner = inner.slice(valStart, i);
      if (inner[i] === "}") i++;
      if (!/[a-zA-Z(]/.test(rawBraceInner) && key !== "dynamicBindings") {
        const nums = rawBraceInner.split(",").map((s) => parseFloat(s.trim()));
        if (nums.every(Number.isFinite)) {
          result[key] = nums;
        }
      }
    } else {
      const valStart = i;
      let parenDepth = 0;
      let inStr = false;
      while (i < n) {
        const ch = inner[i]!;
        if (inStr) {
          if (ch === "\\" && i + 1 < n) i++;
          else if (ch === '"') inStr = false;
        } else if (ch === '"') {
          inStr = true;
        } else if (ch === "(") {
          parenDepth++;
        } else if (ch === ")") {
          if (parenDepth === 0) break;
          parenDepth--;
        } else if (ch === "," && parenDepth === 0) {
          break;
        }
        i++;
      }
      const rawVal = inner.slice(valStart, i).trim();
      if (rawVal === "true" || rawVal === "false") {
        result[key] = rawVal === "true";
      } else {
        const num = Number(rawVal);
        if (rawVal.length > 0 && Number.isFinite(num)) {
          result[key] = num;
        }
      }
    }
  }
  return result;
}

export function parseCadAnnotationString(cadStr: string): CadAnnotation | CadPortAnnotation | null {
  // Determine type prefix
  const isCAD = cadStr.startsWith("CAD(");
  const isCADPort = cadStr.startsWith("CADPort(");
  if (!isCAD && !isCADPort) return null;

  const prefix = isCAD ? "CAD(" : "CADPort(";
  const inner = cadStr.slice(prefix.length, -1); // strip "CAD(" and ")"

  const result = parseTopLevelCadKvArgs(inner);

  if (isCAD) {
    return {
      uri: (result["uri"] as string) ?? "",
      feature: result["feature"] as string | undefined,
      position: result["position"] as [number, number, number] | undefined,
      rotation: result["rotation"] as [number, number, number] | undefined,
      scale: result["scale"] as [number, number, number] | undefined,
      dynamicPosition: result["dynamicPosition"] as string | undefined,
      dynamicRotation: result["dynamicRotation"] as string | undefined,
      dynamicScale: result["dynamicScale"] as string | undefined,
      dynamicDeformation: result["dynamicDeformation"] as string | undefined,
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

/**
 * Extract CadComponent entries from a DAE JSON representation.
 *
 * Expects variables in the format `{ name: "x", cad: "CAD(uri=\"...\")" }`
 * as produced by the updated ModelicaVariable.toJSON.
 */

export interface RawDaeVariable {
  name: string;
  cad?: string | CadAnnotation | undefined;
  ports?: { name: string; port: CadPortAnnotation }[] | undefined;
  dynamicBindings?: CadComponent["dynamicBindings"] | undefined;
  sourceMetadata?: CadComponent["sourceMetadata"] | undefined;
  proceduralMesh?: CadComponent["proceduralMesh"] | undefined;
  defaults?: Record<string, unknown> | undefined;
  shapeType?: string | undefined;
  [key: string]: unknown;
}

export function extractCadComponents(daeVariables: readonly (RawDaeVariable | null | undefined)[]): CadComponent[] {
  const components: CadComponent[] = [];
  const portsByParent = new Map<string, { name: string; port: CadPortAnnotation }[]>();

  for (const v of daeVariables) {
    if (!v || typeof v !== "object" || !v.cad) continue;
    if (typeof v.cad === "object") {
      components.push({
        name: v.name,
        cad: v.cad as CadAnnotation,
        ports: v.ports ?? [],
        dynamicBindings: v.dynamicBindings ?? undefined,
        sourceMetadata: v.sourceMetadata ?? undefined,
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
        ports: [],
        dynamicBindings: v.dynamicBindings ?? undefined,
        sourceMetadata: v.sourceMetadata ?? undefined,
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
      const portList = portsByParent.get(parentName);
      if (portList) {
        portList.push({
          name: portName,
          port: parsed as CadPortAnnotation,
        });
      }
    }
  }

  // Attach ports to their parent components
  for (const comp of components) {
    const ports = portsByParent.get(comp.name);
    if (ports) comp.ports = ports;
  }

  return components;
}
