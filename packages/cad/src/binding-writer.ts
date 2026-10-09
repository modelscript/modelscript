// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Utilities for serializing, parsing, and patching CAD annotations and
 * dynamic simulation bindings in Modelica source code.
 */

export interface DynamicBindingConfig {
  property: "position" | "rotation" | "scale" | "deformation";
  index?: number; // 0=X, 1=Y, 2=Z
  variable: string;
  unit?: string;
  scale?: number;
  offset?: number;
  format?: "euler" | "matrix3x3" | "quaternion" | "axisAngle";
}

export interface CadAnnotationConfig {
  uri?: string;
  position?: [number, number, number];
  rotation?: [number, number, number];
  scale?: [number, number, number];
  dynamicBindings?: DynamicBindingConfig[];
  dynamicPosition?: string;
  dynamicRotation?: string;
  dynamicScale?: string;
  dynamicDeformation?: string;
}

/**
 * Serialize a single CADBinding record into Modelica syntax.
 * e.g. CADBinding(property = "position", index = 1, variable = "r_0[1]", unit = "m")
 */
export function serializeCadBinding(binding: DynamicBindingConfig): string {
  const parts: string[] = [`property = "${binding.property}"`];
  if (binding.index !== undefined) {
    const idx = binding.index < 1 ? binding.index + 1 : binding.index;
    parts.push(`index = ${idx}`);
  }
  parts.push(`variable = "${binding.variable}"`);
  if (binding.unit) {
    parts.push(`unit = "${binding.unit}"`);
  }
  if (binding.scale !== undefined && binding.scale !== 1) {
    parts.push(`scale = ${binding.scale}`);
  }
  if (binding.offset !== undefined && binding.offset !== 0) {
    parts.push(`offset = ${binding.offset}`);
  }
  if (binding.format) {
    parts.push(`format = "${binding.format}"`);
  }
  return `CADBinding(${parts.join(", ")})`;
}

/**
 * Parse CADBinding(...) calls from a Modelica annotation string.
 */
export function parseCadBindings(cadStr: string): DynamicBindingConfig[] {
  const bindings: DynamicBindingConfig[] = [];
  if (!cadStr) return bindings;

  // 1. Match explicit CADBinding(...) calls
  const bindingRegex = /CADBinding\s*\(([^)]+)\)/g;
  let match;
  while ((match = bindingRegex.exec(cadStr)) !== null) {
    const args = match[1];
    const item: Partial<DynamicBindingConfig> = {};

    const propMatch = args.match(/property\s*=\s*"([^"]+)"/);
    if (propMatch) item.property = propMatch[1] as DynamicBindingConfig["property"];

    const idxMatch = args.match(/index\s*=\s*([0-9]+)/);
    if (idxMatch) {
      const idx = parseInt(idxMatch[1], 10);
      item.index = idx >= 1 ? idx - 1 : idx; // normalize to 0-based for JS
    }

    const varMatch = args.match(/variable\s*=\s*"([^"]+)"/);
    if (varMatch) item.variable = varMatch[1];

    const unitMatch = args.match(/unit\s*=\s*"([^"]+)"/);
    if (unitMatch) item.unit = unitMatch[1];

    const scaleMatch = args.match(/scale\s*=\s*([0-9.eE+-]+)/);
    if (scaleMatch) item.scale = parseFloat(scaleMatch[1]);

    const offsetMatch = args.match(/offset\s*=\s*([0-9.eE+-]+)/);
    if (offsetMatch) item.offset = parseFloat(offsetMatch[1]);

    const formatMatch = args.match(/format\s*=\s*"([^"]+)"/);
    if (formatMatch) item.format = formatMatch[1] as DynamicBindingConfig["format"];

    if (item.property && item.variable) {
      bindings.push(item as DynamicBindingConfig);
    }
  }

  // 2. Fallback to shorthand dynamicPosition / dynamicRotation / dynamicScale
  if (bindings.length === 0) {
    const posMatch = cadStr.match(/dynamicPosition\s*=\s*"\{([^,]+),\s*([^,]+),\s*([^}]+)\}"/);
    if (posMatch) {
      bindings.push({ property: "position", index: 0, variable: posMatch[1].trim() });
      bindings.push({ property: "position", index: 1, variable: posMatch[2].trim() });
      bindings.push({ property: "position", index: 2, variable: posMatch[3].trim() });
    }

    const rotMatch = cadStr.match(/dynamicRotation\s*=\s*"([^"]+)"/);
    if (rotMatch) {
      bindings.push({ property: "rotation", variable: rotMatch[1].trim(), format: "matrix3x3" });
    }

    const scaleMatch = cadStr.match(/dynamicScale\s*=\s*"([^"]+)"/);
    if (scaleMatch) {
      bindings.push({ property: "scale", variable: scaleMatch[1].trim() });
    }
  }

  return bindings;
}

/**
 * Serialize a full CAD(...) annotation call into Modelica syntax.
 */
export function serializeCadAnnotation(config: CadAnnotationConfig): string {
  const parts: string[] = [];
  if (config.uri) {
    parts.push(`uri = "${config.uri}"`);
  }
  if (config.position) {
    parts.push(`position = {${config.position.join(", ")}}`);
  }
  if (config.rotation) {
    parts.push(`rotation = {${config.rotation.join(", ")}}`);
  }
  if (config.scale) {
    parts.push(`scale = {${config.scale.join(", ")}}`);
  }
  if (config.dynamicBindings && config.dynamicBindings.length > 0) {
    const serializedBindings = config.dynamicBindings.map((b) => `      ${serializeCadBinding(b)}`).join(",\n");
    parts.push(`dynamicBindings = {\n${serializedBindings}\n    }`);
  }
  if (config.dynamicPosition) {
    parts.push(`dynamicPosition = "${config.dynamicPosition}"`);
  }
  if (config.dynamicRotation) {
    parts.push(`dynamicRotation = "${config.dynamicRotation}"`);
  }
  if (config.dynamicScale) {
    parts.push(`dynamicScale = "${config.dynamicScale}"`);
  }
  if (config.dynamicDeformation) {
    parts.push(`dynamicDeformation = "${config.dynamicDeformation}"`);
  }
  return `CAD(\n    ${parts.join(",\n    ")}\n  )`;
}

/**
 * Patch a Modelica source document to add or update CAD annotations and dynamic bindings
 * for a specific component declaration.
 */
export function patchModelicaCadAnnotation(
  source: string,
  componentName: string,
  config: {
    uri?: string;
    position?: [number, number, number];
    rotation?: [number, number, number];
    scale?: [number, number, number];
    bindings: DynamicBindingConfig[];
  },
): { updatedSource: string; replacedRange?: { start: number; end: number }; newText?: string } {
  // Regex to match component declaration: e.g. "BodyBox body(" or "BodyBox body;"
  // Captures up to the semicolon or next declaration
  const compRegex = new RegExp(`\\b${componentName}\\b([\\s\\S]*?)(;)`, "m");
  const compMatch = compRegex.exec(source);

  if (!compMatch) {
    return { updatedSource: source };
  }

  const compBody = compMatch[1];
  const compStart = compMatch.index;
  const compEnd = compStart + compMatch[0].length;

  // Case 1: Already has annotation(... CAD(...) ...)
  const cadRegex = /annotation\s*\([\s\S]*?CAD\s*\(([\s\S]*?)\)[\s\S]*?\)/;
  const cadMatch = cadRegex.exec(compBody);

  if (cadMatch) {
    const existingCadInner = cadMatch[1];
    // Extract existing uri, position, rotation, scale if not provided
    const uriMatch = existingCadInner.match(/uri\s*=\s*"([^"]+)"/);
    const existingUri = config.uri ?? (uriMatch ? uriMatch[1] : undefined);

    const posMatch = existingCadInner.match(/position\s*=\s*\{([^}]+)\}/);
    const existingPos =
      config.position ??
      (posMatch ? (posMatch[1].split(",").map((s) => parseFloat(s.trim())) as [number, number, number]) : undefined);

    const rotMatch = existingCadInner.match(/rotation\s*=\s*\{([^}]+)\}/);
    const existingRot =
      config.rotation ??
      (rotMatch ? (rotMatch[1].split(",").map((s) => parseFloat(s.trim())) as [number, number, number]) : undefined);

    const scaleMatch = existingCadInner.match(/scale\s*=\s*\{([^}]+)\}/);
    const existingScale =
      config.scale ??
      (scaleMatch
        ? (scaleMatch[1].split(",").map((s) => parseFloat(s.trim())) as [number, number, number])
        : undefined);

    const newCadStr = serializeCadAnnotation({
      uri: existingUri,
      position: existingPos,
      rotation: existingRot,
      scale: existingScale,
      dynamicBindings: config.bindings,
    });

    const newAnnotationStr = `annotation(${newCadStr})`;
    const updatedCompBody = compBody.replace(cadRegex, newAnnotationStr);
    const updatedSource =
      source.slice(0, compStart + compMatch[0].indexOf(compBody)) + updatedCompBody + source.slice(compEnd - 1);

    return {
      updatedSource,
      replacedRange: { start: compStart, end: compEnd },
      newText: updatedSource.slice(
        compStart,
        compStart + compMatch[0].length - compBody.length + updatedCompBody.length,
      ),
    };
  }

  // Case 2: Has annotation(...) without CAD(...)
  const annotRegex = /annotation\s*\(([\s\S]*?)\)/;
  const annotMatch = annotRegex.exec(compBody);

  if (annotMatch) {
    const newCadStr = serializeCadAnnotation({
      uri: config.uri ?? "modelica://Model/Resources/CAD/part.step",
      position: config.position ?? [0, 0, 0],
      rotation: config.rotation ?? [0, 0, 0],
      scale: config.scale ?? [1, 1, 1],
      dynamicBindings: config.bindings,
    });

    const existingContent = annotMatch[1].trim();
    const updatedAnnot = `annotation(${existingContent ? existingContent + ",\n  " : ""}${newCadStr})`;
    const updatedCompBody = compBody.replace(annotRegex, updatedAnnot);
    const updatedSource =
      source.slice(0, compStart + compMatch[0].indexOf(compBody)) + updatedCompBody + source.slice(compEnd - 1);

    return {
      updatedSource,
      replacedRange: { start: compStart, end: compEnd },
    };
  }

  // Case 3: No annotation at all — append before the ';'
  const newCadStr = serializeCadAnnotation({
    uri: config.uri ?? "modelica://Model/Resources/CAD/part.step",
    position: config.position ?? [0, 0, 0],
    rotation: config.rotation ?? [0, 0, 0],
    scale: config.scale ?? [1, 1, 1],
    dynamicBindings: config.bindings,
  });

  const insertion = ` annotation(${newCadStr})`;
  const semicolonIdx = compEnd - 1;
  const updatedSource = source.slice(0, semicolonIdx) + insertion + source.slice(semicolonIdx);

  return {
    updatedSource,
    replacedRange: { start: semicolonIdx, end: semicolonIdx + insertion.length },
    newText: insertion,
  };
}
