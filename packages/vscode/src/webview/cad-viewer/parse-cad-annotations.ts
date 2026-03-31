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
    const key = match[1];
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

/**
 * Extract CadComponent entries from a DAE JSON representation.
 *
 * Expects variables in the format `{ name: "x", cad: "CAD(uri=\"...\")" }`
 * as produced by the updated ModelicaVariable.toJSON.
 */
export function extractCadComponents(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  daeVariables: any[],
): CadComponent[] {
  const components: CadComponent[] = [];
  const portsByParent = new Map<string, { name: string; port: CadPortAnnotation }[]>();

  for (const v of daeVariables) {
    if (!v || typeof v !== "object" || !v.cad) continue;
    const cadStr = v.cad as string;
    const parsed = parseCadAnnotationString(cadStr);
    if (!parsed) continue;

    if (cadStr.startsWith("CAD(")) {
      components.push({
        name: v.name,
        cad: parsed as CadAnnotation,
        ports: [],
      });
    } else if (cadStr.startsWith("CADPort(")) {
      // CADPort annotations are on leaf variables like "body.port1"
      const parts = (v.name as string).split(".");
      const parentName = parts.slice(0, -1).join(".");
      const portName = parts[parts.length - 1];
      if (!portsByParent.has(parentName)) portsByParent.set(parentName, []);
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
