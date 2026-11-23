// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Utilities for serializing, parsing, and patching CAD annotations and
 * dynamic simulation bindings in Modelica source code.
 */

export interface DynamicBindingConfig {
  property: "position" | "rotation" | "scale" | "deformation";
  index?: number | undefined; // 0=X, 1=Y, 2=Z
  variable: string;
  unit?: string | undefined;
  scale?: number | undefined;
  offset?: number | undefined;
  format?: "euler" | "matrix3x3" | "quaternion" | "axisAngle" | undefined;
}

export interface CadAnnotationConfig {
  uri?: string | undefined;
  position?: [number, number, number] | undefined;
  rotation?: [number, number, number] | undefined;
  scale?: [number, number, number] | undefined;
  dynamicBindings?: DynamicBindingConfig[] | undefined;
  dynamicPosition?: string | undefined;
  dynamicRotation?: string | undefined;
  dynamicScale?: string | undefined;
  dynamicDeformation?: string | undefined;
}

/**
 * Serialize a single CADBinding record into Modelica syntax.
 * e.g. CADBinding(property = "position", index = 1, variable = "r_0[1]", unit = "m")
 */
export function serializeCadBinding(binding: DynamicBindingConfig): string {
  const parts: string[] = [`property = "${binding.property}"`];
  if (binding.index !== undefined) {
    const idx = binding.index + 1;
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
  const bindingRegex = /CADBinding\s*\(([^()]+)\)/g;
  let match;
  while ((match = bindingRegex.exec(cadStr)) !== null) {
    const args = match[1]!;
    const item: Partial<DynamicBindingConfig> = {};

    const propMatch = args.match(/property\s*=\s*"([^"]+)"/);
    if (propMatch) item.property = propMatch[1] as DynamicBindingConfig["property"];

    const idxMatch = args.match(/index\s*=\s*([0-9]+)/);
    if (idxMatch) {
      const idx = parseInt(idxMatch[1]!, 10);
      item.index = idx >= 1 ? idx - 1 : idx; // normalize to 0-based for JS
    }

    const varMatch = args.match(/variable\s*=\s*"([^"]+)"/);
    if (varMatch) item.variable = varMatch[1]!;

    const unitMatch = args.match(/unit\s*=\s*"([^"]+)"/);
    if (unitMatch) item.unit = unitMatch[1];

    const scaleMatch = args.match(/scale\s*=\s*([0-9.eE+-]+)/);
    if (scaleMatch) item.scale = parseFloat(scaleMatch[1]!);

    const offsetMatch = args.match(/offset\s*=\s*([0-9.eE+-]+)/);
    if (offsetMatch) item.offset = parseFloat(offsetMatch[1]!);

    const formatMatch = args.match(/format\s*=\s*"([^"]+)"/);
    if (formatMatch) item.format = formatMatch[1] as DynamicBindingConfig["format"];

    if (item.property && item.variable) {
      bindings.push(item as DynamicBindingConfig);
    }
  }

  // 2. Fallback to shorthand dynamicPosition / dynamicRotation / dynamicScale
  if (bindings.length === 0) {
    const posMatch = cadStr.match(/dynamicPosition\s*=\s*"\{([^"]+)\}"/);
    if (posMatch) {
      const parts = posMatch[1]!.split(",");
      if (parts.length === 3) {
        bindings.push({ property: "position", index: 0, variable: parts[0]!.trim() });
        bindings.push({ property: "position", index: 1, variable: parts[1]!.trim() });
        bindings.push({ property: "position", index: 2, variable: parts[2]!.trim() });
      }
    }

    const rotMatch = cadStr.match(/dynamicRotation\s*=\s*"([^"]+)"/);
    if (rotMatch) {
      bindings.push({ property: "rotation", variable: rotMatch[1]!.trim(), format: "matrix3x3" });
    }

    const scaleMatch = cadStr.match(/dynamicScale\s*=\s*"([^"]+)"/);
    if (scaleMatch) {
      bindings.push({ property: "scale", variable: scaleMatch[1]!.trim() });
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

function findBalancedCall(
  text: string,
  keyword: string,
): { callStart: number; innerStart: number; innerEnd: number; callEnd: number; inner: string } | null {
  const kwRegex = new RegExp(`\\b${keyword}\\s*\\(`, "g");
  const match = kwRegex.exec(text);
  if (!match) return null;
  const callStart = match.index;
  const openParenIdx = callStart + match[0].length - 1;
  const innerStart = openParenIdx + 1;
  let depth = 1;
  let inString = false;
  for (let i = innerStart; i < text.length; i++) {
    const ch = text[i];
    if (ch === '"' && text[i - 1] !== "\\") {
      inString = !inString;
      continue;
    }
    if (inString) continue;
    if (ch === "(") depth++;
    else if (ch === ")") {
      depth--;
      if (depth === 0) {
        return {
          callStart,
          innerStart,
          innerEnd: i,
          callEnd: i + 1,
          inner: text.slice(innerStart, i),
        };
      }
    }
  }
  return null;
}

function maskCommentsAndStringsSameLen(src: string): string {
  const out = src.split("");
  let inStr = false;
  let inLine = false;
  let inBlock = false;
  for (let i = 0; i < out.length; i++) {
    const ch = out[i]!;
    const next = out[i + 1] ?? "";
    if (inLine) {
      if (ch !== "\n" && ch !== "\r") out[i] = " ";
      if (ch === "\n") inLine = false;
      continue;
    }
    if (inBlock) {
      if (ch === "*" && next === "/") {
        out[i] = " ";
        out[i + 1] = " ";
        inBlock = false;
        i++;
      } else if (ch !== "\n" && ch !== "\r") {
        out[i] = " ";
      }
      continue;
    }
    if (inStr) {
      if (ch === "\\") {
        out[i] = " ";
        if (i + 1 < out.length && out[i + 1] !== "\n" && out[i + 1] !== "\r") {
          out[i + 1] = " ";
          i++;
        }
      } else if (ch === '"') {
        out[i] = " ";
        inStr = false;
      } else if (ch !== "\n" && ch !== "\r") {
        out[i] = " ";
      }
      continue;
    }
    if (ch === "/" && next === "/") {
      out[i] = " ";
      out[i + 1] = " ";
      inLine = true;
      i++;
    } else if (ch === "/" && next === "*") {
      out[i] = " ";
      out[i + 1] = " ";
      inBlock = true;
      i++;
    } else if (ch === '"') {
      out[i] = " ";
      inStr = true;
    }
  }
  return out.join("");
}

export interface CstNodeLike {
  descendantForIndex?: ((startIndex: number, endIndex?: number) => CstNodeLike | null | undefined) | undefined;
  children?: CstNodeLike[] | undefined;
  namedChildren?: CstNodeLike[] | undefined;
  childForFieldName?: ((name: string) => CstNodeLike | null | undefined) | undefined;
  type?: string | undefined;
  text?: string | undefined;
  startIndex?: number | undefined;
  endIndex?: number | undefined;
}

export type RootCstInput = CstNodeLike | { rootNode?: CstNodeLike | null | undefined } | null | undefined;

const CST_IDENT_NODE_TYPES = new Set(["ident", "IDENT", "identifier", "IDENTIFIER", "ID", "id", "name"]);
const CST_SKIP_SUBTREE_TYPES = new Set([
  "type_specifier",
  "type_prefix",
  "modification",
  "class_modification",
  "argument_list",
  "comment",
  "string_comment",
  "annotation",
  "annotation_clause",
  "condition_attribute",
  "array_subscripts",
  "line_comment",
  "block_comment",
]);

function unwrapCstRoot(rootCst: RootCstInput): CstNodeLike | null {
  if (!rootCst || typeof rootCst !== "object") return null;
  if ("rootNode" in rootCst && rootCst.rootNode && typeof rootCst.rootNode === "object") {
    return rootCst.rootNode as CstNodeLike;
  }
  return rootCst as CstNodeLike;
}

function getCstChildren(node: CstNodeLike): CstNodeLike[] {
  if (Array.isArray(node.children)) return node.children as CstNodeLike[];
  if (Array.isArray(node.namedChildren)) return node.namedChildren as CstNodeLike[];
  return [];
}

function getCstNodeText(node: CstNodeLike, source: string): string {
  if (typeof node.text === "string") return node.text;
  if (
    typeof node.startIndex === "number" &&
    typeof node.endIndex === "number" &&
    node.endIndex >= node.startIndex &&
    node.startIndex >= 0
  ) {
    return source.slice(node.startIndex, node.endIndex);
  }
  return "";
}

function findDeclaredIdentInCstNode(node: CstNodeLike, source: string, componentName: string): CstNodeLike | null {
  if (typeof node.childForFieldName === "function") {
    for (const field of ["name", "ident"]) {
      const fieldNode = node.childForFieldName(field) as CstNodeLike | null | undefined;
      if (fieldNode && getCstNodeText(fieldNode, source).trim() === componentName) {
        return fieldNode;
      }
    }
    const declField = node.childForFieldName("declaration") as CstNodeLike | null | undefined;
    if (declField) {
      const hit = findDeclaredIdentInCstNode(declField, source, componentName);
      if (hit) return hit;
    }
  }

  const children = getCstChildren(node);
  for (const child of children) {
    if (!child || typeof child !== "object") continue;
    const cType = child.type ?? "";
    if (CST_SKIP_SUBTREE_TYPES.has(cType)) continue;
    if (CST_IDENT_NODE_TYPES.has(cType)) {
      if (getCstNodeText(child, source).trim() === componentName) {
        return child;
      }
      continue;
    }
    if (cType === "declaration" || cType === "component_declaration" || cType === "component_list") {
      const hit = findDeclaredIdentInCstNode(child, source, componentName);
      if (hit) return hit;
      continue;
    }
    const grandChildren = getCstChildren(child);
    if (grandChildren.length === 0 && getCstNodeText(child, source).trim() === componentName) {
      return child;
    }
  }
  return null;
}

function hasDescendantOfType(node: CstNodeLike, targetType: string): boolean {
  const stack: CstNodeLike[] = [...getCstChildren(node)];
  while (stack.length > 0) {
    const curr = stack.pop()!;
    if (!curr || typeof curr !== "object") continue;
    if (curr.type === targetType) return true;
    const kids = getCstChildren(curr);
    for (let i = kids.length - 1; i >= 0; i--) {
      if (kids[i]) stack.push(kids[i]!);
    }
  }
  return false;
}

function computeDeclSpanFromCstMatch(
  declNode: CstNodeLike,
  identNode: CstNodeLike | null,
  source: string,
): { compStart: number; bodyStart: number; bodyEnd: number; compEnd: number } | null {
  if (
    typeof declNode.startIndex !== "number" ||
    typeof declNode.endIndex !== "number" ||
    declNode.endIndex <= declNode.startIndex
  ) {
    return null;
  }
  const declStart = declNode.startIndex;
  const declEnd = declNode.endIndex;
  const compStart =
    identNode && typeof identNode.startIndex === "number" && identNode.startIndex >= declStart
      ? identNode.startIndex
      : declStart;
  const bodyStart =
    identNode &&
    typeof identNode.endIndex === "number" &&
    identNode.endIndex >= compStart &&
    identNode.endIndex <= declEnd
      ? identNode.endIndex
      : declStart;

  const endsWithSemi = source[declEnd - 1] === ";";
  const bodyEnd = endsWithSemi ? declEnd - 1 : declEnd;
  const compEnd = endsWithSemi ? declEnd : source[declEnd] === ";" ? declEnd + 1 : declEnd;
  return { compStart, bodyStart, bodyEnd, compEnd };
}

function findComponentDeclSpanInCst(
  root: CstNodeLike,
  source: string,
  componentName: string,
): { compStart: number; bodyStart: number; bodyEnd: number; compEnd: number } | null {
  const stack: CstNodeLike[] = [root];
  while (stack.length > 0) {
    const curr = stack.pop()!;
    if (!curr || typeof curr !== "object") continue;
    const nodeType = curr.type ?? "";
    if (nodeType === "component_declaration") {
      const identNode = findDeclaredIdentInCstNode(curr, source, componentName);
      if (identNode) {
        const span = computeDeclSpanFromCstMatch(curr, identNode, source);
        if (span) return span;
      }
      continue;
    }
    if (nodeType === "component_clause" && !hasDescendantOfType(curr, "component_declaration")) {
      const identNode = findDeclaredIdentInCstNode(curr, source, componentName);
      if (identNode) {
        const span = computeDeclSpanFromCstMatch(curr, identNode, source);
        if (span) return span;
      }
      continue;
    }
    const kids = getCstChildren(curr);
    for (let i = kids.length - 1; i >= 0; i--) {
      if (kids[i]) stack.push(kids[i]!);
    }
  }
  return null;
}

function resolveComponentDeclSpan(
  source: string,
  componentName: string,
  rootCst: RootCstInput,
): { compStart: number; bodyStart: number; bodyEnd: number; compEnd: number } | null {
  if (rootCst !== undefined && rootCst !== null) {
    const root = unwrapCstRoot(rootCst);
    if (!root) return null;
    return findComponentDeclSpanInCst(root, source, componentName);
  }

  // Fallback when rootCst is not passed: mask comments/strings first so identifier mentions in comments do not hijack the match.
  const masked = maskCommentsAndStringsSameLen(source);
  const escapedName = componentName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const compRegex = new RegExp(`\\b${escapedName}\\b([\\s\\S]*?)(;)`, "m");
  const maskedMatch = compRegex.exec(masked);
  if (!maskedMatch) {
    return null;
  }

  const compStart = maskedMatch.index;
  const compEnd = compStart + maskedMatch[0].length;
  const bodyStart = compStart + maskedMatch[0].indexOf(maskedMatch[1]!);
  const bodyEnd = compEnd - 1;
  return { compStart, bodyStart, bodyEnd, compEnd };
}

/**
 * Patch a Modelica source document to add or update CAD annotations and dynamic bindings
 * for a specific component declaration.
 */
export function patchModelicaCadAnnotation(
  source: string,
  componentName: string,
  config: {
    uri?: string | undefined;
    position?: [number, number, number] | undefined;
    rotation?: [number, number, number] | undefined;
    scale?: [number, number, number] | undefined;
    bindings?: DynamicBindingConfig[] | undefined;
    rootCst?: RootCstInput | undefined;
  },
  options?: { rootCst?: RootCstInput | undefined },
): { updatedSource: string; replacedRange?: { start: number; end: number } | undefined; newText?: string | undefined } {
  const effectiveRootCst = options?.rootCst !== undefined ? options.rootCst : config.rootCst;
  const span = resolveComponentDeclSpan(source, componentName, effectiveRootCst);
  if (!span) {
    return { updatedSource: source };
  }

  const { compStart, bodyStart, bodyEnd, compEnd } = span;
  const compBody = source.slice(bodyStart, bodyEnd);

  const annotCall = findBalancedCall(compBody, "annotation");
  if (annotCall) {
    const cadCall = findBalancedCall(annotCall.inner, "CAD");
    if (cadCall) {
      // Case 1: Already has annotation(... CAD(...) ...)
      const existingCadInner = cadCall.inner;
      const uriMatch = existingCadInner.match(/uri\s*=\s*"([^"]+)"/);
      const existingUri = config.uri ?? (uriMatch ? uriMatch[1] : undefined);

      const posMatch = existingCadInner.match(/position\s*=\s*\{([^}]+)\}/);
      const existingPos =
        config.position ??
        (posMatch ? (posMatch[1]!.split(",").map((s) => parseFloat(s.trim())) as [number, number, number]) : undefined);

      const rotMatch = existingCadInner.match(/rotation\s*=\s*\{([^}]+)\}/);
      const existingRot =
        config.rotation ??
        (rotMatch ? (rotMatch[1]!.split(",").map((s) => parseFloat(s.trim())) as [number, number, number]) : undefined);

      const scaleMatch = existingCadInner.match(/scale\s*=\s*\{([^}]+)\}/);
      const existingScale =
        config.scale ??
        (scaleMatch
          ? (scaleMatch[1]!.split(",").map((s) => parseFloat(s.trim())) as [number, number, number])
          : undefined);

      const dynPosMatch = existingCadInner.match(/dynamicPosition\s*=\s*"([^"]+)"/);
      const dynRotMatch = existingCadInner.match(/dynamicRotation\s*=\s*"([^"]+)"/);
      const dynScaleMatch = existingCadInner.match(/dynamicScale\s*=\s*"([^"]+)"/);
      const dynDefMatch = existingCadInner.match(/dynamicDeformation\s*=\s*"([^"]+)"/);
      const effectiveBindings = config.bindings !== undefined ? config.bindings : parseCadBindings(existingCadInner);

      const newCadStr = serializeCadAnnotation({
        uri: existingUri,
        position: existingPos,
        rotation: existingRot,
        scale: existingScale,
        dynamicBindings: effectiveBindings,
        dynamicPosition: dynPosMatch ? dynPosMatch[1] : undefined,
        dynamicRotation: dynRotMatch ? dynRotMatch[1] : undefined,
        dynamicScale: dynScaleMatch ? dynScaleMatch[1] : undefined,
        dynamicDeformation: dynDefMatch ? dynDefMatch[1] : undefined,
      });

      const updatedAnnotInner =
        annotCall.inner.slice(0, cadCall.callStart) + newCadStr + annotCall.inner.slice(cadCall.callEnd);
      const updatedCompBody =
        compBody.slice(0, annotCall.innerStart) + updatedAnnotInner + compBody.slice(annotCall.innerEnd);
      const updatedSource = source.slice(0, bodyStart) + updatedCompBody + source.slice(bodyEnd);

      return {
        updatedSource,
        replacedRange: { start: compStart, end: compEnd },
        newText: updatedSource.slice(compStart, compEnd - compBody.length + updatedCompBody.length),
      };
    }

    // Case 2: Has annotation(...) without CAD(...)
    const newCadStr = serializeCadAnnotation({
      uri: config.uri ?? "modelica://Model/Resources/CAD/part.step",
      position: config.position ?? [0, 0, 0],
      rotation: config.rotation ?? [0, 0, 0],
      scale: config.scale ?? [1, 1, 1],
      dynamicBindings: config.bindings,
    });

    const existingContent = annotCall.inner.trim();
    const updatedAnnot = `annotation(${existingContent ? existingContent + ",\n  " : ""}${newCadStr})`;
    const updatedCompBody = compBody.slice(0, annotCall.callStart) + updatedAnnot + compBody.slice(annotCall.callEnd);
    const updatedSource = source.slice(0, bodyStart) + updatedCompBody + source.slice(bodyEnd);

    return {
      updatedSource,
      replacedRange: { start: bodyStart, end: bodyEnd },
      newText: updatedCompBody,
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
  const insertIdx = bodyEnd;
  const updatedSource = source.slice(0, insertIdx) + insertion + source.slice(insertIdx);

  return {
    updatedSource,
    replacedRange: { start: insertIdx, end: insertIdx },
    newText: insertion,
  };
}

/**
 * Adds or updates a CADPort(...) annotation on a Modelica component declaration.
 */
export function patchModelicaCadPortAnnotation(
  source: string,
  componentName: string,
  port: {
    feature: string;
    offsetPosition?: [number, number, number] | undefined;
    offsetRotation?: [number, number, number] | undefined;
    rootCst?: RootCstInput | undefined;
  },
  options?: { rootCst?: RootCstInput | undefined },
): { updatedSource: string; replacedRange?: { start: number; end: number } | undefined; newText?: string | undefined } {
  const effectiveRootCst = options?.rootCst !== undefined ? options.rootCst : port.rootCst;
  const span = resolveComponentDeclSpan(source, componentName, effectiveRootCst);
  if (!span) {
    return { updatedSource: source };
  }

  const { bodyStart, bodyEnd } = span;
  const compBody = source.slice(bodyStart, bodyEnd);

  const posStr = port.offsetPosition
    ? `, offsetPosition = {${port.offsetPosition.map((v) => Number(v.toFixed(4))).join(", ")}}`
    : "";
  const rotStr = port.offsetRotation
    ? `, offsetRotation = {${port.offsetRotation.map((v) => Number(v.toFixed(4))).join(", ")}}`
    : "";
  const cadPortStr = `CADPort(feature = "${port.feature}"${posStr}${rotStr})`;

  const annotCall = findBalancedCall(compBody, "annotation");
  if (annotCall) {
    const existingContent = annotCall.inner.trim();
    const updatedAnnot = `annotation(${existingContent ? existingContent + ",\n  " : ""}${cadPortStr})`;
    const updatedCompBody = compBody.slice(0, annotCall.callStart) + updatedAnnot + compBody.slice(annotCall.callEnd);
    const updatedSource = source.slice(0, bodyStart) + updatedCompBody + source.slice(bodyEnd);

    return {
      updatedSource,
      replacedRange: { start: bodyStart, end: bodyEnd },
      newText: updatedCompBody,
    };
  }

  const insertion = ` annotation(${cadPortStr})`;
  const insertIdx = bodyEnd;
  const updatedSource = source.slice(0, insertIdx) + insertion + source.slice(insertIdx);

  return {
    updatedSource,
    replacedRange: { start: insertIdx, end: insertIdx },
    newText: insertion,
  };
}

export type MultiBodyJointType = "Revolute" | "Prismatic" | "Cylindrical" | "Spherical" | "Fixed";

export interface AssemblyJointSpec {
  jointName: string;
  jointType: MultiBodyJointType;
  partA: string;
  frameA?: string | undefined;
  partB: string;
  frameB?: string | undefined;
  axis?: [number, number, number] | undefined;
  phi_offset?: number | undefined;
  s_offset?: number | undefined;
  rootCst?: RootCstInput | undefined;
}

function findEnclosingClassNodeInCst(root: CstNodeLike, source: string, targetNames: string[]): CstNodeLike {
  const stack: CstNodeLike[] = [root];
  let bestClass: CstNodeLike | null = null;
  while (stack.length > 0) {
    const curr = stack.pop()!;
    if (!curr || typeof curr !== "object") continue;
    const t = curr.type ?? "";
    if (t === "class_definition" || t === "long_class_specifier" || t === "class_specifier") {
      if (targetNames.some((name) => Boolean(name && findComponentDeclSpanInCst(curr, source, name)))) {
        bestClass = curr;
      }
    }
    const kids = getCstChildren(curr);
    for (let i = kids.length - 1; i >= 0; i--) {
      if (kids[i]) stack.push(kids[i]!);
    }
  }
  return bestClass ?? root;
}

function findEquationKeywordSpanInCst(
  scopeNode: CstNodeLike,
  source: string,
): { lineBreakIdx: number; keywordEnd: number } | null {
  const stack: CstNodeLike[] = [scopeNode];
  while (stack.length > 0) {
    const curr = stack.pop()!;
    if (!curr || typeof curr !== "object") continue;
    const t = curr.type ?? "";
    if (t === "equation_section") {
      const text = getCstNodeText(curr, source).trimStart();
      if (/^initial\b/.test(text)) continue;
      if (typeof curr.startIndex === "number" && curr.startIndex >= 0) {
        let kwStart = curr.startIndex;
        let kwEnd = kwStart + "equation".length;
        for (const child of getCstChildren(curr)) {
          if (getCstNodeText(child, source).trim() === "equation" && typeof child.startIndex === "number") {
            kwStart = child.startIndex;
            kwEnd = typeof child.endIndex === "number" ? child.endIndex : kwStart + "equation".length;
            break;
          }
        }
        const prevNl = source.lastIndexOf("\n", Math.max(0, kwStart - 1));
        const lineBreakIdx = prevNl >= 0 ? prevNl : kwStart;
        return { lineBreakIdx, keywordEnd: kwEnd };
      }
    }
    const kids = getCstChildren(curr);
    for (let i = kids.length - 1; i >= 0; i--) {
      if (kids[i]) stack.push(kids[i]!);
    }
  }
  return null;
}

function findEndKeywordLineStartInCst(scopeNode: CstNodeLike, source: string): number | null {
  let lastEndStart: number | null = null;
  const stack: CstNodeLike[] = [scopeNode];
  while (stack.length > 0) {
    const curr = stack.pop()!;
    if (!curr || typeof curr !== "object") continue;
    const kids = getCstChildren(curr);
    if (kids.length === 0 && getCstNodeText(curr, source).trim() === "end" && typeof curr.startIndex === "number") {
      if (lastEndStart === null || curr.startIndex > lastEndStart) {
        lastEndStart = curr.startIndex;
      }
      continue;
    }
    for (let i = kids.length - 1; i >= 0; i--) {
      if (kids[i]) stack.push(kids[i]!);
    }
  }
  if (lastEndStart === null) return null;
  const prevNl = source.lastIndexOf("\n", Math.max(0, lastEndStart - 1));
  return prevNl >= 0 ? prevNl : lastEndStart;
}

/**
 * Synthesizes and injects a Modelica MultiBody Joint declaration and connect equations
 * between two components/frames in an assembly model.
 */
export function patchModelicaAssemblyJoint(
  source: string,
  joint: AssemblyJointSpec,
  options?: { rootCst?: RootCstInput | undefined },
): {
  updatedSource: string;
  replacedRange?: { start: number; end: number } | undefined;
  newText?: string | undefined;
} {
  const { jointName, jointType, partA, frameA, partB, frameB, axis, phi_offset, s_offset } = joint;

  const params: string[] = [];
  if (axis && (jointType === "Revolute" || jointType === "Prismatic" || jointType === "Cylindrical")) {
    params.push(`n = {${axis.map((v) => Number(v.toFixed(4))).join(", ")}}`);
  }
  if (phi_offset !== undefined && (jointType === "Revolute" || jointType === "Cylindrical")) {
    params.push(`phi_offset = ${Number(phi_offset.toFixed(4))}`);
  }
  if (s_offset !== undefined && (jointType === "Prismatic" || jointType === "Cylindrical")) {
    params.push(`s_offset = ${Number(s_offset.toFixed(4))}`);
  }

  const paramStr = params.length > 0 ? `(${params.join(", ")})` : "";
  const jointDecl = `  Modelica.Mechanics.MultiBody.Joints.${jointType} ${jointName}${paramStr};`;

  const connA = frameA ? `${partA}.${frameA}` : `${partA}.frame_b`;
  const connB = frameB ? `${partB}.${frameB}` : `${partB}.frame_a`;
  const connEquations = `  connect(${connA}, ${jointName}.frame_a);\n  connect(${jointName}.frame_b, ${connB});`;

  const effectiveRootCst = options?.rootCst !== undefined ? options.rootCst : joint.rootCst;
  if (effectiveRootCst !== undefined && effectiveRootCst !== null) {
    const root = unwrapCstRoot(effectiveRootCst);
    if (root) {
      const scopeNode = findEnclosingClassNodeInCst(root, source, [partA, partB]);
      const eqSpan = findEquationKeywordSpanInCst(scopeNode, source);
      if (eqSpan) {
        const eqHeader = source.slice(eqSpan.lineBreakIdx, eqSpan.keywordEnd);
        const updatedSource =
          source.slice(0, eqSpan.lineBreakIdx) +
          `\n${jointDecl}\n` +
          eqHeader +
          `\n${connEquations}` +
          source.slice(eqSpan.keywordEnd);

        return {
          updatedSource,
          replacedRange: { start: eqSpan.lineBreakIdx, end: eqSpan.keywordEnd },
          newText: `\n${jointDecl}\n${eqHeader}\n${connEquations}`,
        };
      }

      const endIdx = findEndKeywordLineStartInCst(scopeNode, source);
      if (endIdx !== null) {
        const insertion = `\n${jointDecl}\n\nequation\n${connEquations}\n`;
        const updatedSource = source.slice(0, endIdx) + insertion + source.slice(endIdx);
        return {
          updatedSource,
          replacedRange: { start: endIdx, end: endIdx },
          newText: insertion,
        };
      }

      const appendStr = `\n${jointDecl}\n\nequation\n${connEquations}\n`;
      return {
        updatedSource: source + appendStr,
        replacedRange: { start: source.length, end: source.length },
        newText: appendStr,
      };
    }
  }

  // Fallback when rootCst is not passed: mask comments/strings so comments do not hijack equation/end lookup.
  const masked = maskCommentsAndStringsSameLen(source);

  // Check if an equation section already exists
  const eqMatch = /\n([ \t]*)equation\b/m.exec(masked);
  if (eqMatch) {
    const eqIdx = eqMatch.index;
    const afterEq = eqIdx + eqMatch[0].length;
    const eqHeader = source.slice(eqIdx, afterEq);
    const updatedSource =
      source.slice(0, eqIdx) + `\n${jointDecl}\n` + eqHeader + `\n${connEquations}` + source.slice(afterEq);

    return {
      updatedSource,
      replacedRange: { start: eqIdx, end: afterEq },
      newText: `\n${jointDecl}\n${eqHeader}\n${connEquations}`,
    };
  }

  // If no equation section exists, search for end <ModelName>;
  const endMatch = /\n([ \t]*)end\s+([A-Za-z0-9_]+)\s*;/m.exec(masked);
  if (endMatch) {
    const endIdx = endMatch.index;
    const insertion = `\n${jointDecl}\n\nequation\n${connEquations}\n`;
    const updatedSource = source.slice(0, endIdx) + insertion + source.slice(endIdx);
    return {
      updatedSource,
      replacedRange: { start: endIdx, end: endIdx },
      newText: insertion,
    };
  }

  // Fallback: append at the end
  const appendStr = `\n${jointDecl}\n\nequation\n${connEquations}\n`;
  return {
    updatedSource: source + appendStr,
    replacedRange: { start: source.length, end: source.length },
    newText: appendStr,
  };
}
