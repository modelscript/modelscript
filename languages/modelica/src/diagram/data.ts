// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Server-side diagram data builder for the VS Code webview.
// Mirrors morsel's renderDiagram() + x6.ts but produces serializable JSON
// that the webview can feed to an X6 Graph.

import {
  computeHeight,
  computeIconPlacement,
  computePortPlacement,
  computeTransform,
  computeWidth,
  convertColor,
  convertPoint,
  convertSmoothPath,
  evaluateCondition,
  FillPattern,
  formatUnit,
  LinePattern,
  Smooth,
  TextAlignment,
  TextStyle,
  type IBitmap,
  type IColor,
  type ICoordinateSystem,
  type IDiagram,
  type IEllipse,
  type IFilledShape,
  type IGraphicItem,
  type IIcon,
  type ILine,
  type IPoint,
  type IPolygon,
  type IRectangle,
  type IText,
  type ModelicaClassInstance,
  type ModelicaComponentInstance,
} from "./index.js";

import { Cst } from "../../src-gen/bindings.js";
import {
  collapseAsciiWhitespace,
  containsWholeWordOutsideStrings,
  expandModelicaTextMacros,
  isAsciiDigitsOnly,
  isAsciiIdentContinue,
  isAsciiWhitespaceCode,
  isSignedAsciiNumberText,
  stripLeadingEquals,
  stripOuterDoubleQuotes,
} from "../flattener/expressions/index.js";
import { ModelicaClassKind, ModelicaVariability } from "../types.js";

function matchesCiKeywordAt(text: string, pos: number, kwLower: string): boolean {
  const end = pos + kwLower.length;
  if (end > text.length) return false;
  if (pos > 0 && isAsciiIdentContinue(text.charCodeAt(pos - 1))) return false;
  if (end < text.length && isAsciiIdentContinue(text.charCodeAt(end))) return false;
  return text.slice(pos, end).toLowerCase() === kwLower;
}

function hasTrailingNumericArraySubscript(name: string): boolean {
  if (!name.endsWith("]")) return false;
  const open = name.lastIndexOf("[");
  if (open === -1) return false;
  const inner = name.slice(open + 1, -1).trim();
  return inner.length > 0 && isAsciiDigitsOnly(inner);
}

function readValueAfterEqualsAt(
  text: string,
  eqPos: number,
  stopChars: string,
  trackBalancedParens: boolean,
): string | undefined {
  let start = eqPos + 1;
  while (start < text.length && isAsciiWhitespaceCode(text.charCodeAt(start))) start++;
  let pos = start;
  let depth = 0;
  while (pos < text.length) {
    const ch = text[pos]!;
    if (trackBalancedParens) {
      if (ch === "(") {
        depth++;
        pos++;
        continue;
      }
      if (ch === ")") {
        if (depth > 0) {
          depth--;
          pos++;
          continue;
        }
        break;
      }
    }
    if (depth === 0 && stopChars.includes(ch)) break;
    pos++;
  }
  const val = text.slice(start, pos).trim();
  return val.length > 0 ? val : undefined;
}

function readValueAfterEqualsExcluding(
  text: string,
  stopChars: string,
  stopOnUnbalancedParens = false,
): string | undefined {
  const eqPos = text.indexOf("=");
  if (eqPos === -1) return undefined;
  return readValueAfterEqualsAt(text, eqPos, stopChars, stopOnUnbalancedParens);
}

function extractNamedModAssignmentFallback(text: string, name: string, caseInsensitive: boolean): string | undefined {
  if (!text || !name) return undefined;
  const hay = caseInsensitive ? text.toLowerCase() : text;
  const needle = caseInsensitive ? name.toLowerCase() : name;
  let pos = 0;
  while (pos <= hay.length - needle.length) {
    const idx = hay.indexOf(needle, pos);
    if (idx === -1) return undefined;
    const prevOk = idx === 0 || !isAsciiIdentContinue(hay.charCodeAt(idx - 1));
    const afterName = idx + needle.length;
    const nextOk = afterName >= hay.length || !isAsciiIdentContinue(hay.charCodeAt(afterName));
    if (prevOk && nextOk) {
      let j = afterName;
      while (j < text.length && isAsciiWhitespaceCode(text.charCodeAt(j))) j++;
      if (j < text.length && text[j] === "=") {
        const val = readValueAfterEqualsAt(text, j, ",", true);
        if (val !== undefined) return val;
      }
    }
    pos = idx + needle.length;
  }
  return undefined;
}

function stripLeadingEqualsAndTrailingSemi(s: string): string {
  let res = stripLeadingEquals(s);
  if (res.endsWith(";")) res = res.slice(0, -1).trim();
  return res;
}

function stripTransformStyleDecls(style: string, fnName: "scale" | "rotate"): string {
  let s = style;
  let searchFrom = 0;
  for (;;) {
    const idx = s.indexOf("transform-origin:", searchFrom);
    if (idx === -1) break;
    const valStart = idx + "transform-origin:".length;
    const semi = s.indexOf(";", valStart);
    const end = semi === -1 ? s.length : semi + 1;
    if ((semi === -1 ? s.length : semi) <= valStart) {
      searchFrom = valStart;
      continue;
    }
    s = s.slice(0, idx) + s.slice(end);
    searchFrom = idx;
  }
  const fnPrefix = `${fnName}(`;
  searchFrom = 0;
  for (;;) {
    const idx = s.indexOf("transform:", searchFrom);
    if (idx === -1) break;
    let p = idx + "transform:".length;
    while (p < s.length && isAsciiWhitespaceCode(s.charCodeAt(p))) p++;
    if (!s.startsWith(fnPrefix, p)) {
      searchFrom = p;
      continue;
    }
    const argStart = p + fnPrefix.length;
    const closeParen = s.indexOf(")", argStart);
    if (closeParen <= argStart) {
      searchFrom = argStart;
      continue;
    }
    let end = closeParen + 1;
    if (end < s.length && s[end] === ";") end++;
    s = s.slice(0, idx) + s.slice(end);
    searchFrom = idx;
  }
  return s.trim();
}

function postfixSvgDefRefs(svg: string, openMarker: string, closeCh: string, suffix: string): string {
  let out = "";
  let pos = 0;
  while (pos < svg.length) {
    const idx = svg.indexOf(openMarker, pos);
    if (idx === -1) {
      out += svg.slice(pos);
      break;
    }
    const valStart = idx + openMarker.length;
    const endIdx = svg.indexOf(closeCh, valStart);
    if (endIdx === -1) {
      out += svg.slice(pos);
      break;
    }
    const id = svg.slice(valStart, endIdx);
    if (id.startsWith("gradient-") || id.startsWith("pattern-")) {
      out += svg.slice(pos, endIdx) + suffix + closeCh;
      pos = endIdx + closeCh.length;
    } else {
      out += svg.slice(pos, valStart);
      pos = valStart;
    }
  }
  return out;
}

function toDashedSlugId(label: string): string {
  const lower = label.toLowerCase();
  let out = "";
  let lastDash = false;
  for (let i = 0; i < lower.length; i++) {
    const code = lower.charCodeAt(i);
    const isAlnum = (code >= 97 && code <= 122) || (code >= 48 && code <= 57);
    if (isAlnum) {
      out += lower[i]!;
      lastDash = false;
    } else if (out.length > 0 && !lastDash) {
      out += "-";
      lastDash = true;
    }
  }
  return out.endsWith("-") ? out.slice(0, -1) : out;
}

// Import canonical types from the protocol module and re-export for
// backward compatibility with consumers that import from diagramData.
export type {
  ComponentPropertyData,
  CoordinateSystem,
  DiagramData,
  DiagramEdge,
  DiagramNode,
  DiagramPort,
  X6Markup,
} from "@modelscript/diagram/protocol";

import { healOrthogonalVertices } from "@modelscript/diagram/port-router";
import type {
  ComponentPropertyData,
  DiagramData,
  DiagramEdge,
  DiagramEdgeMarker,
  DiagramNode,
  DiagramPort,
  EntityPropertySchema,
  PropertyFieldConfig,
  PropertyGroupConfig,
  PropertyTabConfig,
  X6Markup,
} from "@modelscript/diagram/protocol";
import { computeSolderDots, solderDotToDiagramNode, type EdgePath } from "@modelscript/diagram/solder-dots";
import { AnnotationEvaluator, evaluateIconWasm, renderInheritedIconSvgWasm } from "./annotation-evaluator.js";

// ── Build diagram data from a class instance ──

/** Yield control back to the event loop so the WebWorker can process incoming LSP messages. */
const yieldToEventLoop = () => new Promise<void>((r) => setTimeout(r, 0));

function formatPropertyValue(expr: any): string | undefined {
  if (expr == null) return undefined;
  if (typeof expr === "string" || typeof expr === "number" || typeof expr === "boolean") {
    return String(expr);
  }
  if (typeof expr === "object") {
    if ("text" in expr && typeof expr.text === "string") return expr.text;
    if (
      "value" in expr &&
      (typeof expr.value === "string" || typeof expr.value === "number" || typeof expr.value === "boolean")
    ) {
      return String(expr.value);
    }
    const json = typeof expr.toJSON === "function" ? expr.toJSON() : expr.toJSON;
    if (json != null && typeof json !== "object") {
      return String(json);
    }
  }
  return undefined;
}

function collectAllComponents(ci: ModelicaClassInstance, visited = new Set<any>()): ModelicaComponentInstance[] {
  if (!ci || visited.has(ci)) return [];
  visited.add(ci);
  const byName = new Map<string, ModelicaComponentInstance>();
  const extendsList = ci.extendsClassInstances ?? [];
  for (const ext of extendsList) {
    const base = (ext as any)?.classInstance ?? ext;
    if (base && typeof base === "object") {
      for (const comp of collectAllComponents(base, visited)) {
        if (comp.name) byName.set(comp.name, comp);
      }
    }
  }
  if (ci.components) {
    for (const comp of ci.components) {
      if (comp.name) byName.set(comp.name, comp);
    }
  }
  return Array.from(byName.values());
}

function collectAllConnectEquations(ci: ModelicaClassInstance, visited = new Set<any>()): any[] {
  if (!ci || visited.has(ci)) return [];
  visited.add(ci);
  const result: any[] = [];
  const extendsList = ci.extendsClassInstances ?? [];
  for (const ext of extendsList) {
    const base = (ext as any)?.classInstance ?? ext;
    if (base && typeof base === "object") {
      result.push(...collectAllConnectEquations(base, visited));
    }
  }
  if (ci["connectEquations"]) {
    result.push(...ci["connectEquations"]);
  }
  return result;
}

function splitComponentRef(ref: string): string[] {
  const parts: string[] = [];
  let current = "";
  let depth = 0;
  let inQuote = false;
  for (let i = 0; i < ref.length; i++) {
    const ch = ref[i];
    if (ch === "'" && (i === 0 || ref[i - 1] !== "\\")) {
      inQuote = !inQuote;
      current += ch;
    } else if (!inQuote && (ch === "[" || ch === "(")) {
      depth++;
      current += ch;
    } else if (!inQuote && (ch === "]" || ch === ")")) {
      depth = Math.max(0, depth - 1);
      current += ch;
    } else if (!inQuote && ch === "." && depth === 0) {
      parts.push(current.trim());
      current = "";
    } else {
      current += ch;
    }
  }
  if (current.trim()) {
    parts.push(current.trim());
  }
  return parts;
}

/** Standard Modelica physical domain connection line colors */
export const MSL_DOMAIN_COLORS: Record<string, [number, number, number]> = {
  electrical: [0, 0, 255], // Blue (Pins, terminals)
  rotational: [128, 128, 128], // Gray (Flanges, rotational mechanics)
  translational: [0, 128, 0], // Green (Translational 1D/3D mechanics)
  thermal: [191, 0, 0], // Red (Heat ports)
  fluid: [0, 128, 128], // Teal (Fluid ports, flow)
  magnetic: [255, 128, 0], // Orange (Magnetic flux ports)
  control: [255, 0, 255], // Magenta / Purple (Signals, boolean)
  default: [0, 0, 255], // Default electrical blue
};

/**
 * Infers the MSL physical domain color for a connection based on port identifiers
 * and enclosing component types.
 */
export function inferModelicaDomainColor(
  source: string,
  target?: string,
  classInstance?: ModelicaClassInstance,
): [number, number, number] {
  const checkStr = (s: string) => {
    const parts = s.split(".");
    const port = (parts[parts.length - 1] ?? "").toLowerCase();
    const compName = parts.length > 1 ? parts[0] : "";
    let compTypeName = "";
    if (classInstance && compName) {
      const comp = (classInstance.components || []).find((c: any) => c.name === compName);
      compTypeName = (comp?.["typeName"] || comp?.["className"] || comp?.name || "").toLowerCase();
    }
    const combined = `${port} ${compTypeName}`;

    if (combined.includes("heat") || combined.includes("thermal") || port === "port_a" || port === "port_b") {
      if (
        combined.includes("thermal") ||
        combined.includes("heat") ||
        compTypeName.includes("thermal") ||
        compTypeName.includes("heat")
      ) {
        return MSL_DOMAIN_COLORS["thermal"];
      }
    }
    if (port.includes("heat") || port.includes("thermal")) {
      return MSL_DOMAIN_COLORS["thermal"];
    }
    if (
      port.includes("flange_b") ||
      port.includes("flange_a") ||
      port.includes("flange") ||
      port.includes("rotational") ||
      port.includes("support") ||
      port.includes("housing")
    ) {
      if (port.includes("translat") || compTypeName.includes("translat")) {
        return MSL_DOMAIN_COLORS["translational"];
      }
      return MSL_DOMAIN_COLORS["rotational"];
    }
    if (port.includes("translat")) {
      return MSL_DOMAIN_COLORS["translational"];
    }
    if (port.includes("fluid") || port.includes("flow") || port.includes("inlet") || port.includes("outlet")) {
      return MSL_DOMAIN_COLORS["fluid"];
    }
    if (port.includes("mag") || port.includes("flux")) {
      return MSL_DOMAIN_COLORS["magnetic"];
    }
    if (port.includes("bool") || port.includes("boolean")) {
      return MSL_DOMAIN_COLORS["control"];
    }
    if (port.includes("pin") || port === "p" || port === "n" || port.includes("plug") || port.includes("terminal")) {
      return MSL_DOMAIN_COLORS["electrical"];
    }
    return null;
  };

  const c1 = checkStr(source);
  if (c1) return c1;
  if (target) {
    const c2 = checkStr(target);
    if (c2) return c2;
  }
  return MSL_DOMAIN_COLORS["default"]!;
}

interface StaticPortTemplate {
  connector: ModelicaComponentInstance;
  connectorTransform: NonNullable<ReturnType<typeof computePortPlacement>>;
  connectorMarkup: X6Markup;
  connCenterX: number;
  connCenterY: number;
}

const staticPortTemplatesCache = new WeakMap<ModelicaClassInstance, StaticPortTemplate[]>();

export async function buildDiagramData(
  classInstance: ModelicaClassInstance,
  diagramType?: string,
): Promise<DiagramData> {
  const isIconMode = diagramType?.toLowerCase() === "icon";
  const nodes: DiagramNode[] = [];
  const edges: DiagramEdge[] = [];

  // Gather components (including inherited ones)
  const components: any[] = classInstance ? collectAllComponents(classInstance) : [];
  if (components.length === 0 && classInstance?.db && classInstance.id !== undefined) {
    const db = classInstance.db;
    const children = db.childrenOf ? (db.childrenOf(classInstance.id) ?? []) : [];
    for (const child of children) {
      if (child.kind === "Component" || child.kind === "Variable") {
        const childClassId = db.query ? db.query("classInstance", child.id) : null;
        const childClassEntry = childClassId ? db.symbol(childClassId) : null;
        components.push({
          name: child.name,
          annotation: () => null,
          classInstance: childClassEntry
            ? {
                id: childClassId,
                db,
                entry: childClassEntry,
                name: childClassEntry.name,
                compositeName:
                  (child.metadata as any)?.typeSpecifier ||
                  (childClassEntry.metadata as any)?.typeSpecifier ||
                  childClassEntry.name,
                classKind: (childClassEntry.metadata as any)?.classKind ?? (childClassEntry as any).classKind,
                annotation: () => null,
                components: [],
                extendsClassInstances: [],
              }
            : null,
          annotations: [],
          declaration: child,
        });
      }
    }
  }

  // Pre-gather all connect equations (including inherited ones)
  const connectEquations = !isIconMode && classInstance ? collectAllConnectEquations(classInstance) : [];
  const classObj = classInstance as
    | { context?: unknown; entry?: { resourceId?: string }; db?: { cstNode?: unknown } }
    | null
    | undefined;
  const isRealClass = Boolean(classObj?.context || classObj?.entry?.resourceId || classObj?.db?.cstNode);

  let lastYield = performance.now();
  // Build nodes for each component
  for (let _ci = 0; _ci < components.length; _ci++) {
    const component = components[_ci];
    if (!component.name) continue;

    // Yield cooperatively to the event loop when work budget is exceeded (20ms)
    // so the LSP worker remains responsive without incurring 1-4ms timer penalties per component.
    if (performance.now() - lastYield > 20) {
      await yieldToEventLoop();
      lastYield = performance.now();
    }

    const placement = typeof component?.annotation === "function" ? component.annotation("Placement") : null;
    if (isIconMode) {
      const compCi = component.classInstance;
      const compKind = compCi?.classKind ?? compCi?.entry?.metadata?.classKind;
      const compPrefix = compCi?.entry?.metadata?.classPrefixes;
      const isConnector =
        compKind === ModelicaClassKind.CONNECTOR ||
        compKind === ModelicaClassKind.EXPANDABLE_CONNECTOR ||
        Boolean(compPrefix?.includes("connector"));
      const isProtected = component.visibility === "protected" || component.declaration?.visibility === "protected";
      if (!isConnector || isProtected) {
        continue;
      }
    } else if (
      isRealClass &&
      (!placement || placement.visible === false || (!placement.transformation && placement.iconTransformation))
    ) {
      continue;
    }

    const condition = evaluateCondition(component, classInstance);
    if (condition === false) continue;

    const componentClassInstance = component.classInstance;
    const isUnresolved = !componentClassInstance;

    let componentTransform = isIconMode
      ? computePortPlacement(component, placement)
      : computeIconPlacement(component, placement);
    if (!componentTransform && placement && !placement.iconTransformation) {
      const icon =
        typeof componentClassInstance?.annotation === "function"
          ? (componentClassInstance.annotation("Icon") as IIcon)
          : null;
      componentTransform = computeTransform(
        placement.transformation ?? {
          extent: [
            [-10, -10],
            [10, 10],
          ],
          origin: [0, 0],
        },
        icon?.coordinateSystem,
      );
    }
    const autoLayout = !componentTransform;
    if (!componentTransform) {
      // In real parsed Modelica classes from MSL / source code, components without a diagram
      // transformation (e.g. outer scoping declarations like 'system', parameters, variables,
      // or icon-only connectors) are never diagram nodes in OpenModelica or the Modelica spec.
      if (isRealClass) {
        continue;
      }

      if (placement) {
        // Has a Placement annotation, but no diagram transformation (e.g. icon-only port)
        continue;
      }

      const kind = componentClassInstance?.classKind ?? componentClassInstance?.entry?.metadata?.classKind;
      const classPrefix = componentClassInstance?.entry?.metadata?.classPrefixes;
      const isOuter =
        Boolean(component.isOuter) ||
        Boolean((component.declaration as any)?.isOuter) ||
        Boolean((component.entry?.metadata as any)?.isOuter) ||
        component.name === "system";
      const isParam =
        component.variability === ModelicaVariability.PARAMETER ||
        (component.declaration as any)?.variability === "parameter" ||
        (component.entry?.metadata as any)?.variability === "parameter" ||
        (component.entry?.metadata as any)?.typePrefixes?.includes("parameter");
      const isExcludedKind =
        kind === ModelicaClassKind.TYPE ||
        kind === ModelicaClassKind.FUNCTION ||
        kind === ModelicaClassKind.RECORD ||
        kind === ModelicaClassKind.PACKAGE ||
        kind === ModelicaClassKind.CONNECTOR ||
        Boolean(classPrefix?.includes("package")) ||
        Boolean(classPrefix?.includes("connector")) ||
        Boolean(classPrefix?.includes("type")) ||
        Boolean(classPrefix?.includes("function")) ||
        Boolean(classPrefix?.includes("record"));
      const isPrimitive =
        !componentClassInstance ||
        (componentClassInstance?.name &&
          [
            "Real",
            "Integer",
            "Boolean",
            "String",
            "ExternalObject",
            "Voltage",
            "Current",
            "Resistance",
            "Frequency",
            "Angle",
            "Inductance",
            "Capacitance",
            "Power",
          ].includes(componentClassInstance.name));

      if (isOuter || isParam || isExcludedKind || isPrimitive) {
        continue;
      }

      const icon = componentClassInstance?.annotation
        ? (componentClassInstance.annotation("Icon", component) as IIcon | null)
        : null;
      const naturalWidth = computeWidth(icon?.coordinateSystem?.extent) || 200;
      const naturalHeight = computeHeight(icon?.coordinateSystem?.extent) || 200;
      const scaleX = 20 / naturalWidth;
      const scaleY = 20 / naturalHeight;
      componentTransform = {
        originX: 0,
        originY: 0,
        rotate: 0,
        scaleX,
        scaleY,
        translateX: -(naturalWidth * scaleX) / 2,
        translateY: -(naturalHeight * scaleY) / 2,
        width: naturalWidth * scaleX,
        height: naturalHeight * scaleY,
      };
    }

    const absScaleX = Math.abs(componentTransform.scaleX);
    const absScaleY = Math.abs(componentTransform.scaleY);
    const absWidth = Math.abs(componentTransform.width);
    const absHeight = Math.abs(componentTransform.height);
    const flipX = componentTransform.scaleX < 0;
    const flipY = componentTransform.scaleY < 0;
    const needsMarkupMutation = flipX || flipY || componentTransform.rotate !== 0;

    let componentMarkup: any;
    if (isUnresolved) {
      componentMarkup = {
        tagName: "g",
        children: [
          {
            tagName: "rect",
            attrs: {
              x: 0,
              y: 0,
              width: absWidth,
              height: absHeight,
              fill: "#fee2e2",
              stroke: "#ef4444",
              strokeWidth: 1.5,
              strokeDasharray: "4 2",
              rx: 4,
            },
          },
          {
            tagName: "text",
            attrs: {
              x: absWidth / 2,
              y: absHeight / 2 + 3,
              "text-anchor": "middle",
              fill: "#dc2626",
              "font-size": Math.max(6, Math.min(10, absHeight * 0.4)),
              "font-family": "sans-serif",
              "font-weight": "bold",
              stroke: "none",
            },
            children: component.name ?? "?",
          },
        ],
      };
    } else {
      componentMarkup = renderIconX6(
        componentClassInstance,
        component,
        false,
        undefined,
        needsMarkupMutation,
        Math.min(absScaleX, absScaleY),
      );
    }

    if (flipX || flipY) {
      const sx = flipX ? -1 : 1;
      const sy = flipY ? -1 : 1;
      unflipText(componentMarkup, sx, sy);
      const tx = flipX ? absWidth : 0;
      const ty = flipY ? absHeight : 0;
      componentMarkup = {
        tagName: "g",
        attrs: { transform: `translate(${tx}, ${ty}) scale(${sx}, ${sy})` },
        children: [componentMarkup],
      };
    }

    if (componentTransform.rotate !== 0) {
      // unflipText() precedes unrotateText() on <text>, so outer S * inner S = I before R(rot) runs;
      // pass componentTransform.rotate unnegated so R(theta) * R(-theta) = I even when flipped.
      unrotateText(componentMarkup, componentTransform.rotate);
    }

    // Multi-instance array cascading stacked icons (e.g. Resistor R[5])
    const isArrayComponent =
      (component.dimensions && component.dimensions.length > 0) ||
      (Array.isArray(component.arraySubscripts) && component.arraySubscripts.length > 0) ||
      hasTrailingNumericArraySubscript(component.name ?? "");
    if (isArrayComponent) {
      componentMarkup = {
        tagName: "g",
        children: [
          {
            tagName: "rect",
            attrs: {
              x: 4,
              y: -4,
              width: absWidth,
              height: absHeight,
              fill: "none",
              stroke: "#94a3b8",
              strokeWidth: 1,
              strokeDasharray: "2 2",
              rx: 2,
            },
          },
          {
            tagName: "rect",
            attrs: {
              x: 8,
              y: -8,
              width: absWidth,
              height: absHeight,
              fill: "none",
              stroke: "#94a3b8",
              strokeWidth: 1,
              strokeDasharray: "2 2",
              rx: 2,
            },
          },
          componentMarkup,
        ],
      };
    }

    // Helper: synthesize interactive ports referenced in connect() for unresolved or expandable components
    const ports: DiagramPort[] = [];
    const appendSynthesizedConnectPorts = (existingIds?: Set<string>) => {
      const referencedPorts = new Map<string, { x?: number; y?: number }>();
      const compName = component.name ?? "";
      const extractPortSegment = (ref: string | undefined): string | null => {
        if (!ref || !compName) return null;
        let rawSeg: string | null = null;
        if (ref.startsWith(`${compName}.`)) {
          rawSeg = ref.substring(compName.length + 1).split(".")[0] ?? null;
        } else if (ref.startsWith(`${compName}[`)) {
          const closeIdx = ref.indexOf("].");
          if (closeIdx > compName.length) {
            rawSeg = ref.substring(closeIdx + 2).split(".")[0] ?? null;
          }
        }
        if (!rawSeg) return null;
        const brIdx = rawSeg.indexOf("[");
        return brIdx >= 0 ? rawSeg.slice(0, brIdx).trim() : rawSeg.trim();
      };
      for (const eq of connectEquations) {
        const p1 =
          eq.lhs ?? eq.componentReference1?.parts?.map((c: any) => c.identifier?.text ?? c.text ?? "").join(".");
        const p2 =
          eq.rhs ?? eq.componentReference2?.parts?.map((c: any) => c.identifier?.text ?? c.text ?? "").join(".");
        const line: ILine | null = typeof eq.annotation === "function" ? (eq.annotation("Line") as ILine | null) : null;
        const linePoints = line?.points;
        const port1 = extractPortSegment(typeof p1 === "string" ? p1 : undefined);
        if (port1 && !existingIds?.has(port1) && !referencedPorts.has(port1)) {
          let hint: { x?: number; y?: number } = {};
          if (linePoints && linePoints.length > 0) {
            const [px, py] = convertPoint(linePoints[0]!);
            hint = { x: px, y: py };
          }
          referencedPorts.set(port1, hint);
        }
        const port2 = extractPortSegment(typeof p2 === "string" ? p2 : undefined);
        if (port2 && !existingIds?.has(port2) && !referencedPorts.has(port2)) {
          let hint: { x?: number; y?: number } = {};
          if (linePoints && linePoints.length > 0) {
            const [px, py] = convertPoint(linePoints[linePoints.length - 1]!);
            hint = { x: px, y: py };
          }
          referencedPorts.set(port2, hint);
        }
      }
      if (isUnresolved && referencedPorts.size === 0 && (!existingIds || existingIds.size === 0)) {
        referencedPorts.set("p", {});
        referencedPorts.set("n", {});
      }
      const nodeX = componentTransform.translateX;
      const nodeY = componentTransform.translateY;
      let idx = existingIds ? existingIds.size : 0;
      const total = Math.max(1, referencedPorts.size);
      for (const [portName, hint] of referencedPorts.entries()) {
        let portX = idx % 2 === 0 ? 0 : absWidth;
        let portY = total > 1 ? ((idx + 1) * absHeight) / (total + 1) : absHeight / 2;
        if (typeof hint.x === "number" && typeof hint.y === "number") {
          const relX = hint.x - nodeX;
          const relY = hint.y - nodeY;
          if (relX >= -5 && relX <= absWidth + 5 && relY >= -5 && relY <= absHeight + 5) {
            portX = Math.max(0, Math.min(absWidth, relX));
            portY = Math.max(0, Math.min(absHeight, relY));
          }
        }
        ports.push({
          id: portName,
          group: "absolute",
          args: { x: portX, y: portY, angle: 0 },
          markup: {
            tagName: "rect",
            attrs: {
              width: 8,
              height: 8,
              x: -4,
              y: -4,
              fill: isUnresolved ? "#ef4444" : "#3b82f6",
              magnet: "true",
            },
          },
        });
        idx++;
      }
    };

    // Build ports
    if (isUnresolved) {
      appendSynthesizedConnectPorts();
    } else if (componentClassInstance) {
      let portTemplates = staticPortTemplatesCache.get(componentClassInstance);
      if (!portTemplates) {
        portTemplates = [];
        for (const connector of collectAllComponents(componentClassInstance)) {
          const connPlacement = typeof connector?.annotation === "function" ? connector.annotation("Placement") : null;
          if (!connPlacement) continue;
          if (
            connPlacement.iconVisible === false ||
            (connPlacement.iconVisible === undefined && connPlacement.visible === false)
          ) {
            continue;
          }
          const connectorClassInstance = connector.classInstance;
          if (
            connectorClassInstance &&
            connectorClassInstance["classKind"] !== ModelicaClassKind.CONNECTOR &&
            connectorClassInstance["classKind"] !== ModelicaClassKind.EXPANDABLE_CONNECTOR &&
            connectorClassInstance["classKind"] !== undefined
          ) {
            continue;
          }
          const connectorTransform = computePortPlacement(connector, connPlacement);
          if (!connectorTransform) continue;

          let connectorMarkup = connectorClassInstance
            ? renderIconX6(connectorClassInstance, undefined, false, undefined, false)
            : null;
          if (!connectorMarkup) {
            const domainColor = inferModelicaDomainColor(connector.name ?? "", undefined, componentClassInstance);
            const colorStr = `rgb(${domainColor[0]}, ${domainColor[1]}, ${domainColor[2]})`;
            connectorMarkup = {
              tagName: "rect",
              attrs: {
                x: -5,
                y: -5,
                width: 10,
                height: 10,
                fill: colorStr,
                stroke: colorStr,
                "stroke-width": 1,
              },
            };
          }
          const a = connectorTransform.rotate * (Math.PI / 180);
          const extCenterOffX =
            connectorTransform.translateX - connectorTransform.originX + connectorTransform.width / 2;
          const extCenterOffY =
            connectorTransform.translateY - connectorTransform.originY + connectorTransform.height / 2;
          const connCenterX = connectorTransform.originX + extCenterOffX * Math.cos(a) - extCenterOffY * Math.sin(a);
          const connCenterY = connectorTransform.originY + extCenterOffX * Math.sin(a) + extCenterOffY * Math.cos(a);
          portTemplates.push({
            connector,
            connectorTransform,
            connectorMarkup,
            connCenterX,
            connCenterY,
          });
        }
        staticPortTemplatesCache.set(componentClassInstance, portTemplates);
      }

      for (const tpl of portTemplates) {
        const { connector, connectorTransform, connectorMarkup, connCenterX, connCenterY } = tpl;
        const connectorCondition = evaluateCondition(connector, component);
        if (connectorCondition === false) continue;

        const portWidth = connectorTransform.width * absScaleX;
        const portHeight = connectorTransform.height * absScaleY;
        const desiredCenterX =
          absWidth / 2 + (connCenterX - (componentTransform.csMidX ?? 0)) * componentTransform.scaleX;
        const desiredCenterY =
          absHeight / 2 + (connCenterY - (componentTransform.csMidY ?? 0)) * componentTransform.scaleY;

        const hasOddFlip = Boolean(flipX) !== Boolean(flipY);
        const portAngle = hasOddFlip ? -connectorTransform.rotate : connectorTransform.rotate;
        const portIconChildren =
          flipX || flipY
            ? [
                {
                  tagName: "g",
                  attrs: {
                    transform: `translate(${flipX ? portWidth : 0}, ${flipY ? portHeight : 0}) scale(${flipX ? -1 : 1}, ${flipY ? -1 : 1})`,
                  },
                  children: [connectorMarkup],
                },
              ]
            : [connectorMarkup];

        ports.push({
          id: connector.name ?? "",
          group: "absolute",
          args: { x: desiredCenterX, y: desiredCenterY, angle: portAngle },
          markup: {
            tagName: "g",
            children: [
              {
                tagName: "rect",
                attrs: {
                  x: -portWidth / 2,
                  y: -portHeight / 2,
                  width: portWidth,
                  height: portHeight,
                  fill: "transparent",
                  stroke: "none",
                  cursor: "crosshair",
                },
              },
              {
                tagName: "svg",
                children: portIconChildren,
                attrs: {
                  x: -portWidth / 2,
                  y: -portHeight / 2,
                  width: portWidth,
                  height: portHeight,
                  style: "overflow: visible",
                },
              },
            ],
            attrs: {
              magnet: "true",
              x: -portWidth / 2,
              y: -portHeight / 2,
              width: portWidth,
              height: portHeight,
              style: `overflow: visible${connectorCondition === undefined ? "; opacity: 0.5" : ""}`,
            },
          },
        });
      }

      const compClassPrefixes = (componentClassInstance.entry?.metadata as any)?.classPrefixes as string[] | undefined;
      const isExpandableConnector =
        componentClassInstance.classKind === ModelicaClassKind.EXPANDABLE_CONNECTOR ||
        Boolean(compClassPrefixes?.includes("expandable")) ||
        Boolean((componentClassInstance as any).isExpandable);
      if (isExpandableConnector) {
        const declaredPortIds = new Set(ports.map((p) => p.id).filter(Boolean));
        appendSynthesizedConnectPorts(declaredPortIds);
      }
    }

    const a = componentTransform.rotate * (Math.PI / 180);
    const relTranslateX = absWidth / 2 + componentTransform.translateX - componentTransform.originX;
    const relTranslateY = absHeight / 2 + componentTransform.translateY - componentTransform.originY;

    // Lightweight property metadata — expensive fields (parameters, docInfo,
    // docRevisions, iconSvg) are deferred to buildComponentProperties() and
    // loaded on-demand when the user clicks a node.
    const resolvedClassName =
      componentClassInstance?.compositeName ||
      (component as any).declaration?.metadata?.typeSpecifier ||
      (component as any).typeName ||
      (component as any).typeSpecifier ||
      componentClassInstance?.name ||
      "Unknown";

    const properties: ComponentPropertyData = {
      classKind: componentClassInstance?.classKind ?? "unknown",
      className: resolvedClassName,
      name: component.name ?? "",
      description: component.description ?? (isUnresolved ? "Unresolved component type" : ""),
      parameters: [],
    };
    if ((componentClassInstance as any)?.entry?.metadata?.iconSvg) {
      properties.iconSvg = (componentClassInstance as any).entry.metadata.iconSvg;
    } else if ((componentClassInstance as any)?.iconSvg) {
      properties.iconSvg = (componentClassInstance as any).iconSvg;
    }

    nodes.push({
      id: component.name,
      x: relTranslateX * Math.cos(a) - relTranslateY * Math.sin(a) - absWidth / 2 + componentTransform.originX,
      y: relTranslateX * Math.sin(a) + relTranslateY * Math.cos(a) - absHeight / 2 + componentTransform.originY,
      angle: componentTransform.rotate,
      width: absWidth,
      height: absHeight,
      zIndex: 10,
      opacity: condition === undefined ? 0.5 : 1,
      markup: {
        tagName: "svg",
        children: [
          { tagName: "rect", attrs: { style: "fill: transparent; stroke:none", width: absWidth, height: absHeight } },
          componentMarkup,
        ],
        attrs: { preserveAspectRatio: "none", width: absWidth, height: absHeight, style: "overflow: visible" },
      },
      autoLayout,
      ports: {
        items: ports,
        groups: { absolute: { position: "absolute", zIndex: 100 } },
      },
      properties,
    });
  }

  // Precompute world port centers and declared port sets so vector-port subscripts (e.g. set1.u[1], gain.y[1]) bind to X6 ports
  const portWorldMap = new Map<string, { x: number; y: number }>();
  const nodePortIdsMap = new Map<string, Set<string>>();
  for (const node of nodes) {
    const nx = node.x ?? 0;
    const ny = node.y ?? 0;
    const nw = node.width ?? 0;
    const nh = node.height ?? 0;
    const angleDeg = node.angle ?? 0;
    const portItems = Array.isArray(node.ports) ? node.ports : (node.ports as any)?.items;
    if (!portItems) continue;
    const idSet = new Set<string>();
    for (const p of portItems) {
      if (p?.id) idSet.add(p.id);
      if (!p.id || !p.args || typeof p.args.x !== "number" || typeof p.args.y !== "number") continue;
      let wx = nx + p.args.x;
      let wy = ny + p.args.y;
      if (angleDeg) {
        const cx = nw / 2;
        const cy = nh / 2;
        const rad = (angleDeg * Math.PI) / 180;
        const cos = Math.cos(rad);
        const sin = Math.sin(rad);
        const dx = p.args.x - cx;
        const dy = p.args.y - cy;
        wx = nx + cx + dx * cos - dy * sin;
        wy = ny + cy + dx * sin + dy * cos;
      }
      portWorldMap.set(`${node.id}.${p.id}`, { x: wx, y: wy });
    }
    nodePortIdsMap.set(node.id, idSet);
  }

  const resolvePortAnchor = (
    cellId: string,
    portRef: string,
    explicitPt: { x: number; y: number } | undefined,
  ): string | { name: string; args?: { dx?: number; dy?: number } } => {
    if (!explicitPt || !cellId || !portRef) return "center";
    const basePort = portRef.replace(/\[.*\]$/, "");
    const portPos = portWorldMap.get(`${cellId}.${portRef}`) ?? portWorldMap.get(`${cellId}.${basePort}`);
    if (!portPos) return "center";
    const dx = Math.round((explicitPt.x - portPos.x) * 100) / 100;
    const dy = Math.round((explicitPt.y - portPos.y) * 100) / 100;
    if ((Math.abs(dx) > 0.05 || Math.abs(dy) > 0.05) && Math.abs(dx) < 10 && Math.abs(dy) < 10) {
      return { name: "center", args: { dx, dy } };
    }
    return "center";
  };

  const resolveNodePortId = (cellId: string, rawPort: string): string => {
    if (!cellId || !rawPort) return rawPort;
    const idSet = nodePortIdsMap.get(cellId);
    if (!idSet || idSet.has(rawPort)) return rawPort;
    const brIdx = rawPort.indexOf("[");
    if (brIdx >= 0) {
      const basePort = rawPort.slice(0, brIdx).trim();
      if (idSet.has(basePort)) return basePort;
    }
    return rawPort;
  };

  // Build edges from connect equations
  const nodeIds = new Set(nodes.map((n) => n.id));
  const allCompNames = new Set(components.map((c) => c.name));

  for (const connectEquation of connectEquations) {
    let c1 = connectEquation.componentReference1?.parts?.map((c: any) => c.identifier?.text ?? c.text ?? "");
    let c2 = connectEquation.componentReference2?.parts?.map((c: any) => c.identifier?.text ?? c.text ?? "");
    if ((!c1 || c1.length === 0) && connectEquation.lhs) {
      c1 = typeof connectEquation.lhs === "string" ? splitComponentRef(connectEquation.lhs) : undefined;
    }
    if ((!c2 || c2.length === 0) && connectEquation.rhs) {
      c2 = typeof connectEquation.rhs === "string" ? splitComponentRef(connectEquation.rhs) : undefined;
    }
    if (!c1 || !c2 || c1.length === 0 || c2.length === 0) continue;
    const baseC1 = c1[0].indexOf("[") >= 0 ? c1[0].slice(0, c1[0].indexOf("[")).trim() : c1[0].trim();
    const baseC2 = c2[0].indexOf("[") >= 0 ? c2[0].slice(0, c2[0].indexOf("[")).trim() : c2[0].trim();
    const isC1Valid = nodeIds.has(baseC1) || allCompNames.has(baseC1) || c1.length === 1;
    const isC2Valid = nodeIds.has(baseC2) || allCompNames.has(baseC2) || c2.length === 1;
    if (!isC1Valid || !isC2Valid) continue;

    const line: ILine | null =
      typeof connectEquation.annotation === "function" ? connectEquation.annotation("Line") : null;
    let strokeColor = `rgb(${line?.color?.[0] ?? 0}, ${line?.color?.[1] ?? 0}, ${line?.color?.[2] ?? 255})`;
    if (!line?.color) {
      const srcName = c1 ? c1.join(".") : "";
      const tgtName = c2 ? c2.join(".") : "";
      const [r, g, b] = inferModelicaDomainColor(srcName, tgtName, classInstance);
      strokeColor = `rgb(${r}, ${g}, ${b})`;
    }
    const strokeWidth = (line?.thickness ?? 0.25) * 2;
    const stroke = line?.visible === false || line?.pattern === LinePattern.NONE ? "none" : strokeColor;

    let strokeDasharray: string | undefined;
    switch (line?.pattern) {
      case LinePattern.DASH:
        strokeDasharray = "4, 2";
        break;
      case LinePattern.DASH_DOT:
        strokeDasharray = "4, 2, 1, 2";
        break;
      case LinePattern.DASH_DOT_DOT:
        strokeDasharray = "4, 2, 1, 2, 1, 2";
        break;
      case LinePattern.DOT:
        strokeDasharray = "1, 2";
        break;
    }

    const sourceMarker = buildMarker(line?.arrow?.[0], strokeColor, strokeWidth);
    const targetMarker = buildMarker(line?.arrow?.[1], strokeColor, strokeWidth);

    const hasExplicitBends = Boolean(line?.points && line.points.length > 2);
    const explicitLinePoints =
      line?.points && line.points.length >= 2
        ? line.points.map((p: IPoint) => convertPoint(p)).map((p: [number, number]) => ({ x: p[0], y: p[1] }))
        : null;

    const isC1TopLevelNode = c1.length === 1 && nodeIds.has(baseC1);
    const isC2TopLevelNode = c2.length === 1 && nodeIds.has(baseC2);
    const srcCell = c1.length > 1 ? baseC1 : isC1TopLevelNode ? baseC1 : "";
    const rawSrcPort = c1.length > 1 ? (c1[1] ?? "") : isC1TopLevelNode ? "" : c1[0];
    const srcPort = resolveNodePortId(srcCell, rawSrcPort);
    const tgtCell = c2.length > 1 ? baseC2 : isC2TopLevelNode ? baseC2 : "";
    const rawTgtPort = c2.length > 1 ? (c2[1] ?? "") : isC2TopLevelNode ? "" : c2[0];
    const tgtPort = resolveNodePortId(tgtCell, rawTgtPort);

    edges.push({
      id: `${c1.join(".")}-${c2.join(".")}`,
      zIndex: 1,
      source: {
        cell: srcCell,
        port: srcPort,
        anchor: resolvePortAnchor(srcCell, rawSrcPort, explicitLinePoints?.[0]),
        connectionPoint: { name: "anchor" },
      },
      target: {
        cell: tgtCell,
        port: tgtPort,
        anchor: resolvePortAnchor(tgtCell, rawTgtPort, explicitLinePoints?.[explicitLinePoints.length - 1]),
        connectionPoint: { name: "anchor" },
      },
      vertices: line?.points
        ?.slice(1, -1)
        ?.map((p: IPoint) => convertPoint(p))
        .map((p: [number, number]) => ({ x: p[0], y: p[1] })),
      router: hasExplicitBends ? undefined : { name: "port-orthogonal-astar" },
      connector: line?.smooth === Smooth.BEZIER ? "smooth" : "normal",
      data: explicitLinePoints ? { points: explicitLinePoints } : undefined,
      attrs: {
        line: {
          stroke,
          strokeWidth,
          strokeDasharray,
          sourceMarker,
          targetMarker,
          "vector-effect": "non-scaling-stroke",
          "pointer-events": "stroke",
        },
      },
    });
  }

  // Coordinate system & background graphics (Icon layer vs Diagram layer)
  const layerAnnotation: IDiagram | IIcon | null =
    typeof classInstance?.annotation === "function"
      ? (classInstance.annotation(isIconMode ? "Icon" : "Diagram") as IDiagram | IIcon | null)
      : null;
  const ext0 = layerAnnotation?.coordinateSystem?.extent?.[0] ?? [-100, -100];
  const ext1 = layerAnnotation?.coordinateSystem?.extent?.[1] ?? [100, 100];
  const bgWidth = computeWidth(layerAnnotation?.coordinateSystem?.extent);
  const bgHeight = computeHeight(layerAnnotation?.coordinateSystem?.extent);
  const csX = Math.min(ext0[0], ext1[0]);
  const csY = -Math.max(ext0[1], ext1[1]);

  // Background graphics & interactive Icon primitives
  let diagramBackground: X6Markup | null = null;
  if (isIconMode) {
    // 1. Render inherited (extends) Icon graphics as non-editable background layer
    const inheritedDefs: X6Markup[] = [];
    const inheritedItems: X6Markup[] = [];
    const collectInheritedIcons = (ci: ModelicaClassInstance) => {
      for (const ext of ci?.extendsClassInstances ?? []) {
        const base = ext?.["classInstance"];
        if (base) {
          collectInheritedIcons(base);
          const baseIcon = typeof base.annotation === "function" ? (base.annotation("Icon") as IIcon | null) : null;
          if (baseIcon?.graphics) {
            for (const g of baseIcon.graphics) {
              inheritedItems.push(renderGraphicItemX6(g, inheritedDefs, base));
            }
          }
        }
      }
    };
    collectInheritedIcons(classInstance);
    if (inheritedItems.length > 0 || inheritedDefs.length > 0) {
      const children: X6Markup[] = [];
      if (inheritedDefs.length > 0) children.push({ tagName: "defs", children: inheritedDefs });
      children.push({ tagName: "g", children: inheritedItems });
      diagramBackground = {
        tagName: "svg",
        attrs: {
          width: "100%",
          height: "100%",
          viewBox: `${csX} ${csY} ${bgWidth} ${bgHeight}`,
          preserveAspectRatio: "none",
          overflow: "visible",
        },
        children,
      };
    }

    // 2. Emit own Icon.graphics primitives as selectable/editable DiagramNodes
    const ownGraphics = (layerAnnotation as IIcon | null)?.graphics ?? [];
    const iconPrimitiveNodes: DiagramNode[] = [];
    for (let gi = 0; gi < ownGraphics.length; gi++) {
      const g = ownGraphics[gi]!;
      let minX = -20;
      let maxX = 20;
      let minY = -20;
      let maxY = 20;
      const gExtent = (g as any).extent as [[number, number], [number, number]] | undefined;
      const gPoints = (g as any).points as Array<[number, number]> | undefined;
      if (Array.isArray(gExtent) && gExtent.length >= 2) {
        minX = Math.min(gExtent[0][0], gExtent[1][0]);
        maxX = Math.max(gExtent[0][0], gExtent[1][0]);
        minY = Math.min(gExtent[0][1], gExtent[1][1]);
        maxY = Math.max(gExtent[0][1], gExtent[1][1]);
      } else if (Array.isArray(gPoints) && gPoints.length > 0) {
        minX = Math.min(...gPoints.map((p) => p[0]));
        maxX = Math.max(...gPoints.map((p) => p[0]));
        minY = Math.min(...gPoints.map((p) => p[1]));
        maxY = Math.max(...gPoints.map((p) => p[1]));
      }
      const origX = Array.isArray((g as any).origin) ? Number((g as any).origin[0]) || 0 : 0;
      const origY = Array.isArray((g as any).origin) ? Number((g as any).origin[1]) || 0 : 0;
      const nodeW = Math.max(4, maxX - minX);
      const nodeH = Math.max(4, maxY - minY);
      const nodeX = minX + origX;
      const nodeY = -(maxY + origY);
      const vbX = minX;
      const vbY = -maxY;

      const itemDefs: X6Markup[] = [];
      const itemShape = renderGraphicItemX6(g, itemDefs, classInstance);
      const svgChildren: X6Markup[] = [];
      if (itemDefs.length > 0) svgChildren.push({ tagName: "defs", children: itemDefs });
      svgChildren.push(itemShape);

      iconPrimitiveNodes.push({
        id: `__icon_gfx_${gi}`,
        x: nodeX,
        y: nodeY,
        width: nodeW,
        height: nodeH,
        angle: typeof (g as any).rotation === "number" ? -(g as any).rotation : 0,
        opacity: 1,
        zIndex: gi + 1,
        markup: {
          tagName: "svg",
          attrs: {
            width: nodeW,
            height: nodeH,
            viewBox: `${vbX} ${vbY} ${nodeW} ${nodeH}`,
            preserveAspectRatio: "none",
            overflow: "visible",
          },
          children: svgChildren,
        },
        ports: { items: [], groups: {} },
        properties: {
          name: `${g["@type"]} #${gi + 1}`,
          className: g["@type"],
          classKind: "iconGraphic",
          description: "",
          parameters: [],
        },
        data: {
          isIconPrimitive: true,
          primitiveIndex: gi,
          primitiveType: g["@type"],
          primitive: g,
          diagramType: "icon",
        },
      });
    }
    if (iconPrimitiveNodes.length > 0) {
      // Place graphic primitives behind connector port nodes
      nodes.unshift(...iconPrimitiveNodes);
    }
  } else if (layerAnnotation) {
    diagramBackground = renderDiagramX6(classInstance, layerAnnotation as IDiagram);
  }

  // Pre-compute solder dots for edges with known vertices/connections
  const resolveWorldPortPoint = (node: DiagramNode, px: number, py: number): { x: number; y: number } => {
    const nx = node.x ?? 0;
    const ny = node.y ?? 0;
    const width = node.width ?? 0;
    const height = node.height ?? 0;
    const flipX = Boolean(node.data?.["flipX"] || (node as any).flipX);
    const flipY = Boolean(node.data?.["flipY"] || (node as any).flipY);
    const lx = flipX ? width - px : px;
    const ly = flipY ? height - py : py;

    const angleDeg = node.angle ?? 0;
    if (!angleDeg) {
      return { x: nx + lx, y: ny + ly };
    }
    const cx = width / 2;
    const cy = height / 2;
    const rad = (angleDeg * Math.PI) / 180;
    const cos = Math.cos(rad);
    const sin = Math.sin(rad);
    const dx = lx - cx;
    const dy = ly - cy;
    return {
      x: nx + cx + dx * cos - dy * sin,
      y: ny + cy + dx * sin + dy * cos,
    };
  };
  const validEdgePaths: EdgePath[] = [];
  const knownPortPoints: { x: number; y: number }[] = [];
  for (const node of nodes) {
    const portItems = Array.isArray(node.ports) ? node.ports : (node.ports as any)?.items;
    if (portItems) {
      for (const p of portItems) {
        if (p.args && typeof p.args.x === "number" && typeof p.args.y === "number") {
          knownPortPoints.push(resolveWorldPortPoint(node, p.args.x, p.args.y));
        }
      }
    }
  }
  const componentBoxes = nodes
    .filter((n) => !n.id.startsWith("solder_dot_") && !n.id.startsWith("wire_crossing_"))
    .map((n) => {
      const angle = n.angle ?? 0;
      const w = n.width ?? 0;
      const h = n.height ?? 0;
      if (!angle) {
        return { x: n.x ?? 0, y: n.y ?? 0, width: w, height: h };
      }
      const rad = (Math.abs(angle) * Math.PI) / 180;
      const cos = Math.abs(Math.cos(rad));
      const sin = Math.abs(Math.sin(rad));
      const rotW = w * cos + h * sin;
      const rotH = w * sin + h * cos;
      const cx = (n.x ?? 0) + w / 2;
      const cy = (n.y ?? 0) + h / 2;
      return { x: cx - rotW / 2, y: cy - rotH / 2, width: rotW, height: rotH };
    });

  const segmentImpalesAnyComponent = (a: { x: number; y: number }, b: { x: number; y: number }): boolean => {
    const minX = Math.min(a.x, b.x);
    const maxX = Math.max(a.x, b.x);
    const minY = Math.min(a.y, b.y);
    const maxY = Math.max(a.y, b.y);
    const shrink = 2;
    for (const box of componentBoxes) {
      if (box.width <= shrink * 2 || box.height <= shrink * 2) continue;
      const bx0 = box.x + shrink;
      const bx1 = box.x + box.width - shrink;
      const by0 = box.y + shrink;
      const by1 = box.y + box.height - shrink;
      if (maxX > bx0 && minX < bx1 && maxY > by0 && minY < by1) {
        return true;
      }
    }
    return false;
  };

  for (const edge of edges) {
    const srcNode = nodes.find((n) => n.id === edge.source.cell);
    const srcPortItems = Array.isArray(srcNode?.ports) ? srcNode.ports : (srcNode?.ports as any)?.items;
    const srcPort = srcPortItems?.find((p: any) => p.id === edge.source.port);
    const srcPt =
      srcNode && srcPort?.args && typeof srcPort.args.x === "number" && typeof srcPort.args.y === "number"
        ? resolveWorldPortPoint(srcNode, srcPort.args.x, srcPort.args.y)
        : null;

    const tgtNode = nodes.find((n) => n.id === edge.target.cell);
    const tgtPortItems = Array.isArray(tgtNode?.ports) ? tgtNode.ports : (tgtNode?.ports as any)?.items;
    const tgtPort = tgtPortItems?.find((p: any) => p.id === edge.target.port);
    const tgtPt =
      tgtNode && tgtPort?.args && typeof tgtPort.args.x === "number" && typeof tgtPort.args.y === "number"
        ? resolveWorldPortPoint(tgtNode, tgtPort.args.x, tgtPort.args.y)
        : null;

    const explicitPts = (edge as any).data?.points as { x: number; y: number }[] | undefined;
    const p0 = explicitPts && explicitPts.length >= 2 ? explicitPts[0]! : null;
    const pN = explicitPts && explicitPts.length >= 2 ? explicitPts[explicitPts.length - 1]! : null;
    const healSrc = srcPt ?? p0;
    const healTgt = tgtPt ?? pN;

    // If an explicit 2-point Line(points={{x1,y1},{x2,y2}}) is a clean, non-degenerate, axis-aligned wire
    // matching its ports and not impaling any component interior, lock it as author-committed geometry
    // (router: undefined) so adding other connections or components never dynamically reroutes it.
    if (
      explicitPts &&
      explicitPts.length === 2 &&
      p0 &&
      pN &&
      healSrc &&
      healTgt &&
      Math.hypot(p0.x - pN.x, p0.y - pN.y) > 1 &&
      (!srcPt || Math.hypot(srcPt.x - p0.x, srcPt.y - p0.y) <= 8) &&
      (!tgtPt || Math.hypot(tgtPt.x - pN.x, tgtPt.y - pN.y) <= 8) &&
      (Math.abs(healSrc.x - healTgt.x) <= 2 || Math.abs(healSrc.y - healTgt.y) <= 2) &&
      !segmentImpalesAnyComponent(healSrc, healTgt)
    ) {
      delete edge.router;
    }

    if (healSrc && healTgt && edge.vertices && edge.vertices.length > 0 && edge.connector !== "smooth") {
      edge.vertices = healOrthogonalVertices(healSrc, healTgt, edge.vertices);
    }

    const intermediate = edge.vertices ?? [];
    let pathPoints: { x: number; y: number }[] | null = null;
    if (healSrc && healTgt) {
      pathPoints = [healSrc, ...intermediate, healTgt];
    } else if (explicitPts) {
      pathPoints = explicitPts;
    }

    if (pathPoints && pathPoints.length >= 2) {
      const sourceKey =
        edge.source?.cell && edge.source?.port
          ? `${edge.source.cell}.${edge.source.port}`
          : edge.source?.cell
            ? String(edge.source.cell)
            : undefined;
      const targetKey =
        edge.target?.cell && edge.target?.port
          ? `${edge.target.cell}.${edge.target.port}`
          : edge.target?.cell
            ? String(edge.target.cell)
            : undefined;
      validEdgePaths.push({
        id: edge.id,
        points: pathPoints,
        color: (edge.attrs?.line?.stroke as string) || "#1890ff",
        sourceKey,
        targetKey,
      });
    }
  }
  if (validEdgePaths.length > 0) {
    const precomputedDots = computeSolderDots(validEdgePaths, {
      cellSize: 40,
      tolerance: 3.0,
      portPoints: knownPortPoints,
      componentBoxes,
    });
    for (const dot of precomputedDots) {
      nodes.push(solderDotToDiagramNode(dot, 1.8));
    }
  }

  return {
    nodes,
    edges,
    coordinateSystem: {
      x: csX,
      y: csY,
      width: bgWidth,
      height: bgHeight,
      extent: [ext0, ext1],
      grid: layerAnnotation?.coordinateSystem?.grid ?? [2, 2],
      preserveAspectRatio: layerAnnotation?.coordinateSystem?.preserveAspectRatio ?? true,
      initialScale: layerAnnotation?.coordinateSystem?.initialScale ?? 0.1,
      boundsStyle: {
        visible: true,
        stroke: "#999",
        strokeWidth: 1,
      },
      axesStyle: {
        visible: true,
        stroke: "#999",
        strokeWidth: 1,
        boundsOnly: false,
      },
    },
    diagramBackground,
    metadata: {
      language: "modelica",
      diagramType: isIconMode ? "icon" : "diagram",
      defaultConnector: "normal",
    },
  };
}

// ── X6 Markup rendering (ported from morsel's x6.ts, DOM-free) ──

function renderDiagramX6(classInstance: ModelicaClassInstance, precomputedDiagram?: IDiagram | null): X6Markup | null {
  const defs: X6Markup[] = [];
  const graphicItems: X6Markup[] = [];

  function collectGraphics(ci: ModelicaClassInstance) {
    const extendsList = ci?.extendsClassInstances ?? [];
    for (const extendsClassInstance of extendsList) {
      if (extendsClassInstance?.["classInstance"]) {
        collectGraphics(extendsClassInstance["classInstance"]);
      }
    }
    const diagram: IDiagram | null =
      ci === classInstance && precomputedDiagram !== undefined
        ? precomputedDiagram
        : typeof ci?.annotation === "function"
          ? ci.annotation("Diagram")
          : null;
    if (diagram?.graphics) {
      for (const graphicItem of diagram.graphics) {
        graphicItems.push(renderGraphicItemX6(graphicItem, defs, ci));
      }
    }
  }

  collectGraphics(classInstance);
  if (graphicItems.length === 0 && defs.length === 0) return null;

  const diagram: IDiagram | null =
    precomputedDiagram !== undefined
      ? precomputedDiagram
      : typeof classInstance?.annotation === "function"
        ? classInstance.annotation("Diagram")
        : null;
  const [x1, y1] = convertPoint(diagram?.coordinateSystem?.extent?.[0], [-100, -100]);
  const [x2, y2] = convertPoint(diagram?.coordinateSystem?.extent?.[1], [100, 100]);
  const vbX = Math.min(x1, x2);
  const vbY = Math.min(y1, y2);
  const vbW = computeWidth(diagram?.coordinateSystem?.extent);
  const vbH = computeHeight(diagram?.coordinateSystem?.extent);

  const children: X6Markup[] = [];
  if (defs.length > 0) {
    children.push({ tagName: "defs", children: defs });
  }
  children.push({ tagName: "g", children: graphicItems });

  return {
    tagName: "svg",
    attrs: {
      width: "100%",
      height: "100%",
      viewBox: `${vbX} ${vbY} ${vbW} ${vbH}`,
      preserveAspectRatio: "none",
      overflow: "visible",
    },
    children,
  };
}

const iconCache = new Map<string, { svg: X6Markup; defs: X6Markup[] }>();
const standaloneIconSvgCache = new Map<string, string>();

/** Clear the cached icon markup. Call when MSL finishes loading or the model changes. */
export function clearIconCache() {
  iconCache.clear();
  standaloneIconSvgCache.clear();
}

export const MODELICA_PACKAGE_FALLBACK_INSTANCE: ModelicaClassInstance = {
  name: "Package",
  components: [],
  extendsClassInstances: [],
  connectEquations: [],
  annotation: (annName: string) => {
    if (annName === "Icon") {
      return {
        "@type": "Icon",
        coordinateSystem: {
          "@type": "coordinateSystem",
          preserveAspectRatio: false,
          extent: [
            [-100, -100],
            [100, 100],
          ],
        },
        graphics: [
          {
            "@type": "Rectangle",
            lineColor: [200, 200, 200],
            fillColor: [248, 248, 248],
            fillPattern: FillPattern.HORIZONTAL_CYLINDER,
            extent: [
              [-100, -100],
              [100, 100],
            ],
            radius: 25,
          },
          {
            "@type": "Rectangle",
            lineColor: [128, 128, 128],
            extent: [
              [-100, -100],
              [100, 100],
            ],
            radius: 25,
          },
        ],
      };
    }
    return null;
  },
} as any;

const ownOnlyCtxCache = new WeakMap<object, unknown>();
const STATIC_OWN_ONLY_CTX = Object.freeze({ ownOnly: true });

function getOwnOnlyCtx(componentInstance?: ModelicaComponentInstance): unknown {
  if (!componentInstance || typeof componentInstance !== "object") {
    return STATIC_OWN_ONLY_CTX;
  }
  let wrapped = ownOnlyCtxCache.get(componentInstance);
  if (!wrapped) {
    wrapped = Object.create(componentInstance, {
      ownOnly: { value: true, enumerable: true },
      _rawComponent: { value: componentInstance, enumerable: false },
    });
    ownOnlyCtxCache.set(componentInstance, wrapped);
  }
  return wrapped;
}

const staticIconClassCache = new WeakMap<object, boolean>();

function isClassIconStatic(ci: ModelicaClassInstance | null | undefined, visited?: Set<unknown>): boolean {
  if (!ci || typeof ci !== "object") return false;
  const cached = staticIconClassCache.get(ci);
  if (cached !== undefined) return cached;
  const seen = visited ?? new Set<unknown>();
  if (seen.has(ci)) return true;
  seen.add(ci);

  for (const ext of ci.extendsClassInstances ?? []) {
    const base = ext?.["classInstance"];
    if (base && !isClassIconStatic(base, seen)) {
      staticIconClassCache.set(ci, false);
      return false;
    }
  }

  let ownStatic = false;
  if (ci === MODELICA_PACKAGE_FALLBACK_INSTANCE) {
    ownStatic = true;
  } else {
    const ciNode = ci as
      | { cstNode?: { tree?: unknown; ptr?: number }; abstractSyntaxNode?: { tree?: unknown; ptr?: number } }
      | null
      | undefined;
    const cstNode = ciNode?.cstNode ?? ciNode?.abstractSyntaxNode;
    if (cstNode && cstNode.tree && typeof cstNode.ptr === "number" && cstNode.ptr > 0) {
      const wasmIcon = evaluateIconWasm(cstNode);
      if (wasmIcon !== undefined && wasmIcon !== null) {
        ownStatic = true;
        if (wasmIcon.graphics) {
          for (const g of wasmIcon.graphics) {
            if (g["@type"] === "Text") {
              const s = g.string ?? g.textString ?? "";
              if (typeof s === "string" && s.includes("%")) {
                ownStatic = false;
                break;
              }
            }
          }
        }
      }
    } else if (typeof (ci as { annotation?: (name: string) => unknown } | null)?.annotation === "function") {
      const metaIcon = (
        ci as { annotation: (name: string) => { graphics?: Array<Record<string, unknown>> } | null }
      ).annotation("Icon");
      if (metaIcon && Array.isArray(metaIcon.graphics)) {
        ownStatic = true;
        for (const g of metaIcon.graphics) {
          if (g["@type"] === "Text") {
            const s = (g["string"] ?? g["textString"] ?? "") as unknown;
            if (typeof s === "string" && s.includes("%")) {
              ownStatic = false;
              break;
            }
          }
        }
      }
    }
  }

  staticIconClassCache.set(ci, ownStatic);
  return ownStatic;
}

function cloneMarkupForTextTransform(node: X6Markup, isRootNode = true): X6Markup {
  if (!node || typeof node !== "object") return node;
  if (node.tagName === "text") {
    return {
      ...node,
      attrs: node.attrs ? { ...node.attrs } : undefined,
    };
  }
  if (!Array.isArray(node.children) || node.children.length === 0) {
    if (isRootNode) {
      return {
        ...node,
        attrs: node.attrs ? { ...node.attrs } : undefined,
        children: node.children ? [...node.children] : undefined,
      };
    }
    return node;
  }
  let childCloned = false;
  const nextChildren = new Array<X6Markup>(node.children.length);
  for (let i = 0; i < node.children.length; i++) {
    const child = node.children[i]!;
    const clonedChild = cloneMarkupForTextTransform(child, false);
    if (clonedChild !== child) {
      childCloned = true;
    }
    nextChildren[i] = clonedChild;
  }
  if (childCloned || isRootNode) {
    return {
      ...node,
      attrs: isRootNode && node.attrs ? { ...node.attrs } : node.attrs,
      children: nextChildren,
    };
  }
  return node;
}

export function renderIconX6(
  classInstance: ModelicaClassInstance,
  componentInstance?: ModelicaComponentInstance,
  ports?: boolean,
  defs?: X6Markup[],
  clone = true,
  iconScale?: number,
): X6Markup {
  const isRoot = !defs;
  const localDefs = defs ?? [];
  const isTopLevel = !ports;
  const effectiveComponent =
    componentInstance && isTopLevel && isClassIconStatic(classInstance) ? undefined : componentInstance;
  const ciNameObj = classInstance as {
    fullName?: string;
    compositeName?: string;
    entry?: { fullName?: string; name?: string; resourceId?: string };
  };
  const qualifiedName =
    ciNameObj.compositeName ??
    ciNameObj.fullName ??
    ciNameObj.entry?.fullName ??
    (ciNameObj.entry?.resourceId ? `${ciNameObj.entry.resourceId}#${classInstance.id ?? classInstance.name}` : null) ??
    (classInstance.id !== undefined ? `id:${classInstance.id}` : classInstance.name);
  const identityKey = !effectiveComponent && isTopLevel && qualifiedName ? qualifiedName : null;
  const cacheKey = identityKey ? `${isRoot ? "r:" : "n:"}${identityKey}` : null;
  const canCache = Boolean(cacheKey);

  if (canCache && cacheKey) {
    const cached = iconCache.get(cacheKey);
    if (cached) {
      if (cached.defs && cached.defs.length > 0) {
        localDefs.push(...cached.defs);
      }
      // Return a targeted copy-on-write clone when caller may mutate root attrs or flip/rotate <text>
      const res = clone ? cloneMarkupForTextTransform(cached.svg, true) : cached.svg;
      if (isRoot && localDefs.length > 0 && res.children) {
        if (clone) {
          res.children.unshift({ tagName: "defs", children: localDefs });
          return res;
        }
        return {
          ...res,
          children: [{ tagName: "defs", children: localDefs }, ...res.children],
        };
      }
      return res;
    }
  }

  const defsStartLength = localDefs.length;
  const svg: X6Markup = {
    tagName: "svg",
    attrs: { width: "100%", height: "100%", style: "overflow: visible" },
    children: [],
  };

  const extendsList = classInstance.extendsClassInstances ?? [];
  let renderedBaseIcon = false;
  for (const extendsClassInstance of extendsList) {
    if (extendsClassInstance["classInstance"] && svg.children) {
      const baseCls = extendsClassInstance["classInstance"];
      const baseComp = isTopLevel && isClassIconStatic(baseCls) ? undefined : effectiveComponent;
      svg.children.push(renderIconX6(baseCls, baseComp, ports, localDefs, false, iconScale));
      renderedBaseIcon = true;
    } else if (
      extendsClassInstance.name &&
      (extendsClassInstance.name === "Modelica.Icons.Package" ||
        extendsClassInstance.name === "Icons.Package" ||
        extendsClassInstance.name.endsWith(".Icons.Package") ||
        extendsClassInstance.name.endsWith(".Package") ||
        extendsClassInstance.name === "Package") &&
      svg.children
    ) {
      svg.children.push(renderIconX6(MODELICA_PACKAGE_FALLBACK_INSTANCE, undefined, ports, localDefs));
      renderedBaseIcon = true;
    }
  }

  const hasExtends = extendsList.some((e: any) => e.classInstance) || renderedBaseIcon;

  const hasAnnotationFn = typeof classInstance.annotation === "function";
  let icon: IIcon | null = null;
  if (hasAnnotationFn) {
    if (hasExtends) {
      icon = classInstance.annotation?.("Icon", getOwnOnlyCtx(effectiveComponent));
    } else {
      icon = classInstance.annotation?.("Icon", effectiveComponent);
    }
  }
  const coordSys = icon?.coordinateSystem ?? undefined;

  if (isRoot) {
    applyCoordinateSystemX6(svg, coordSys, true);
  }

  if (!icon && (!hasExtends || !svg.children || svg.children.length === 0)) {
    if (isRoot && localDefs.length > 0 && svg.children) {
      svg.children.unshift({ tagName: "defs", children: localDefs });
    }
    return svg;
  }

  if (!isRoot && coordSys) {
    applyCoordinateSystemX6(svg, coordSys, false);
  }

  const group: X6Markup = { tagName: "g", children: [] };
  if (group.children && icon?.graphics) {
    for (const graphicItem of icon.graphics ?? []) {
      group.children.push(renderGraphicItemX6(graphicItem, localDefs, classInstance, componentInstance, iconScale));
    }
  }

  if (ports && group.children) {
    for (const component of classInstance?.components ?? []) {
      const compPlacement = typeof component?.annotation === "function" ? component.annotation("Placement") : null;
      const condition = evaluateCondition(
        component,
        componentInstance ? { componentInstance, classInstance } : classInstance,
      );
      if (condition === false) continue;

      const connectorClassInstance = component.classInstance;
      if (
        !connectorClassInstance ||
        (connectorClassInstance["classKind"] !== ModelicaClassKind.CONNECTOR &&
          connectorClassInstance["classKind"] !== ModelicaClassKind.EXPANDABLE_CONNECTOR &&
          connectorClassInstance["classKind"] !== undefined)
      )
        continue;

      const connectorSvg = renderIconX6(connectorClassInstance, undefined, false, localDefs);
      if (connectorSvg) {
        const attrs = connectorSvg.attrs ?? {};
        connectorSvg.attrs = attrs;
        if (condition === undefined) attrs["opacity"] = 0.5;

        const transform = computePortPlacement(component, compPlacement);
        if (!transform) {
          attrs["visibility"] = "hidden";
          group.children.push(connectorSvg);
        } else {
          // Instead of translate/scale which CSS engines misinterpret on SVGs,
          // we use absolute viewport positioning (x, y, width, height) which is bulletproof.
          const w = Math.abs(transform.width);
          const h = Math.abs(transform.height);
          attrs["x"] = transform.translateX;
          attrs["y"] = transform.translateY;
          attrs["width"] = w;
          attrs["height"] = h;

          if (transform.rotate !== 0 || transform.scaleX < 0 || transform.scaleY < 0) {
            const rot =
              transform.rotate !== 0 ? `rotate(${transform.rotate}, ${transform.originX}, ${transform.originY}) ` : "";
            // If flipped, scale from the center of the port
            const cx = transform.translateX + w / 2;
            const cy = transform.translateY + h / 2;
            let flip = "";
            if (transform.scaleX < 0 || transform.scaleY < 0) {
              const sx = transform.scaleX < 0 ? -1 : 1;
              const sy = transform.scaleY < 0 ? -1 : 1;
              flip = `translate(${cx}, ${cy}) scale(${sx}, ${sy}) translate(${-cx}, ${-cy})`;
            }

            const wrapper: X6Markup = {
              tagName: "g",
              attrs: { transform: `${rot}${flip}`.trim() },
              children: [connectorSvg],
            };
            group.children.push(wrapper);
          } else {
            group.children.push(connectorSvg);
          }
        }
      }
    }
  }

  if (svg.children && group.children && group.children.length > 0) {
    svg.children.push(group);
  }

  if (isRoot && localDefs.length > 0 && svg.children) {
    svg.children.unshift({ tagName: "defs", children: localDefs });
  }

  if (canCache && cacheKey) {
    const defsAdded = localDefs.slice(defsStartLength);
    // We don't cache the root-injected `<defs>` element, we cache the raw svg + defsAdded
    // to allow the caller to handle defs injection consistently.
    if (isRoot && svg.children?.[0]?.tagName === "defs") {
      const svgWithoutDefs = { ...svg, children: svg.children.slice(1) };
      iconCache.set(cacheKey, { svg: svgWithoutDefs, defs: defsAdded });
    } else {
      iconCache.set(cacheKey, { svg, defs: defsAdded });
    }
  }

  return svg;
}

function renderGraphicItemX6(
  graphicItem: IGraphicItem,
  defs: X6Markup[],
  classInstance?: ModelicaClassInstance,
  componentInstance?: ModelicaComponentInstance,
  iconScale?: number,
): X6Markup {
  let shape: X6Markup;
  switch (graphicItem["@type"]) {
    case "Bitmap":
      shape = renderBitmapX6(graphicItem as IBitmap, defs, classInstance);
      break;
    case "Ellipse":
      shape = renderEllipseX6(graphicItem as IEllipse, defs);
      break;
    case "Line":
      shape = renderLineX6(graphicItem as ILine);
      break;
    case "Polygon":
      shape = renderPolygonX6(graphicItem as IPolygon, defs);
      break;
    case "Rectangle":
      shape = renderRectangleX6(graphicItem as IRectangle, defs);
      break;
    case "Text":
      shape = renderTextX6(graphicItem as IText, classInstance, componentInstance, iconScale);
      break;
    default:
      return { tagName: "g", children: [] };
  }
  const [ox, oy] = convertPoint(graphicItem.origin, [0, 0]);
  const visibility = graphicItem.visible === undefined || graphicItem.visible === true ? "visible" : "hidden";

  return {
    tagName: "g",
    children: [shape],
    attrs: {
      visibility,
      transform: `translate(${ox}, ${oy}) rotate(${-(graphicItem.rotation ?? 0)})`,
    },
  };
}

function renderBitmapX6(graphicItem: IBitmap, defs: X6Markup[], classInstance?: ModelicaClassInstance): X6Markup {
  const [x1, y1] = convertPoint(graphicItem.extent?.[0], [-100, -100]);
  const [x2, y2] = convertPoint(graphicItem.extent?.[1], [100, 100]);
  const x = Math.min(x1, x2);
  const y = Math.min(y1, y2);
  let href = graphicItem.imageSource
    ? graphicItem.imageSource.startsWith("data:")
      ? graphicItem.imageSource
      : `data:image/png;base64,${graphicItem.imageSource}`
    : graphicItem.fileName;

  if (href && href.startsWith("modelica://")) {
    const resolved = resolveModelicaBitmapUri(href, classInstance);
    if (resolved) {
      href = resolved;
    }
  }

  const shape: X6Markup = {
    tagName: "image",
    attrs: {
      href: href ?? "",
      width: computeWidth(graphicItem.extent),
      height: computeHeight(graphicItem.extent),
      x,
      y,
    },
  };
  renderFilledShapeX6(shape, graphicItem, defs);
  return shape;
}

function renderEllipseX6(graphicItem: IEllipse, defs: X6Markup[]): X6Markup {
  const [cx1, cy1] = convertPoint(graphicItem.extent?.[0], [-100, -100]);
  const [cx2, cy2] = convertPoint(graphicItem.extent?.[1], [100, 100]);
  const rx = computeWidth(graphicItem.extent) / 2;
  const ry = computeHeight(graphicItem.extent) / 2;
  const shape: X6Markup = {
    tagName: "ellipse",
    attrs: { cx: Math.min(cx1, cx2) + rx, cy: Math.min(cy1, cy2) + ry, rx, ry },
  };
  renderFilledShapeX6(shape, graphicItem, defs);
  return shape;
}

function renderLineX6(graphicItem: ILine): X6Markup {
  let shape: X6Markup;
  if ((graphicItem.points?.length ?? 0) > 2) {
    if (graphicItem.smooth === Smooth.BEZIER) {
      shape = {
        tagName: "path",
        attrs: {
          d: convertSmoothPath(graphicItem.points)
            .map((cmd: (string | number)[]) => cmd.join(" "))
            .join(" "),
        },
      };
    } else {
      shape = {
        tagName: "polyline",
        attrs: { points: graphicItem.points?.map((p: IPoint) => convertPoint(p, [0, 0]) ?? []).join(" ") ?? "" },
      };
    }
  } else {
    const p1 = convertPoint(graphicItem?.points?.[0]);
    const p2 = convertPoint(graphicItem?.points?.[1]);
    shape = {
      tagName: "line",
      attrs: { x1: p1[0], y1: p1[1], x2: p2[0], y2: p2[1] },
    };
  }
  applyLineStyleX6(shape, graphicItem);
  if (!shape.attrs) shape.attrs = {};
  shape.attrs["fill"] = "none";
  return shape;
}

function renderPolygonX6(graphicItem: IPolygon, defs: X6Markup[]): X6Markup {
  let shape: X6Markup;
  if (graphicItem.smooth === Smooth.BEZIER && (graphicItem.points?.length ?? 0) > 2) {
    shape = {
      tagName: "path",
      attrs: {
        d: [...convertSmoothPath(graphicItem.points), ["Z"]].map((cmd: (string | number)[]) => cmd.join(" ")).join(" "),
      },
    };
  } else {
    shape = {
      tagName: "polygon",
      attrs: { points: graphicItem.points?.map((p: IPoint) => convertPoint(p, [0, 0]) ?? []).join(" ") ?? "" },
    };
  }
  renderFilledShapeX6(shape, graphicItem, defs);
  return shape;
}

function renderRectangleX6(graphicItem: IRectangle, defs: X6Markup[]): X6Markup {
  const [x1, y1] = convertPoint(graphicItem.extent?.[0], [0, 0]);
  const [x2, y2] = convertPoint(graphicItem.extent?.[1], [0, 0]);
  const x = Math.min(x1, x2);
  const y = Math.min(y1, y2);
  const width = computeWidth(graphicItem.extent);
  const height = computeHeight(graphicItem.extent);

  const rawRadius = graphicItem.radius ?? (graphicItem as { cornerRadius?: number | undefined }).cornerRadius ?? 0;
  let d: string;

  if (rawRadius > 0) {
    const r = Math.min(rawRadius, width / 2, height / 2);
    d = [
      `M ${x + r} ${y}`,
      `H ${x + width - r}`,
      `A ${r} ${r} 0 0 1 ${x + width} ${y + r}`,
      `V ${y + height - r}`,
      `A ${r} ${r} 0 0 1 ${x + width - r} ${y + height}`,
      `H ${x + r}`,
      `A ${r} ${r} 0 0 1 ${x} ${y + height - r}`,
      `V ${y + r}`,
      `A ${r} ${r} 0 0 1 ${x + r} ${y}`,
      `Z`,
    ].join(" ");
  } else {
    d = `M ${x} ${y} H ${x + width} V ${y + height} H ${x} Z`;
  }

  const shape: X6Markup = { tagName: "path", attrs: { d } };

  renderFilledShapeX6(shape, graphicItem, defs);
  return shape;
}

export function stripQuotes(val: string): string {
  if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
    return val.slice(1, -1);
  }
  return val;
}

export function evalMacroCondition(
  cond: string,
  classInstance?: ModelicaClassInstance,
  componentInstance?: ModelicaComponentInstance,
): boolean {
  let c = cond.trim();
  let negate = false;
  if (c.startsWith("not ")) {
    negate = true;
    c = c.slice(4).trim();
  }

  // Equality or comparison operator: ==, !=, <=, >=, <, >
  const comparisonOps = ["==", "!=", "<=", ">=", "<", ">"];
  for (const op of comparisonOps) {
    if (c.includes(op)) {
      const parts = c.split(op).map((s) => s.trim());
      if (parts.length === 2) {
        const lhs = stripQuotes(evaluateMacroExpression(parts[0]!, classInstance, componentInstance));
        const rhs = stripQuotes(evaluateMacroExpression(parts[1]!, classInstance, componentInstance));
        let res = false;
        if (op === "==") res = lhs === rhs;
        else if (op === "!=") res = lhs !== rhs;
        else if (op === "<=") res = parseFloat(lhs) <= parseFloat(rhs);
        else if (op === ">=") res = parseFloat(lhs) >= parseFloat(rhs);
        else if (op === "<") res = parseFloat(lhs) < parseFloat(rhs);
        else if (op === ">") res = parseFloat(lhs) > parseFloat(rhs);
        return negate ? !res : res;
      }
    }
  }

  // Single identifier or literal
  const val = evaluateMacroExpression(c, classInstance, componentInstance);
  const normalized = val.trim().toLowerCase();
  const truthy = normalized === "true" || normalized === "1" || normalized === "yes";
  return negate ? !truthy : truthy;
}

function findArgsInCst(node: any): any[] {
  const results: any[] = [];
  if (!node) return results;
  if (Cst.AnnotationClause.is(node) || node.type === "annotation_clause" || node.type === "AnnotationClause") {
    return results;
  }
  if (Cst.Argument.is(node) || node.type === "argument" || node.typeId === 134) {
    results.push(node);
    return results;
  }
  for (const ch of node.children || []) {
    results.push(...findArgsInCst(ch));
  }
  return results;
}

function findElemModInCst(node: any): any {
  if (!node) return null;
  if (Cst.ElementModification.is(node) || node.type === "element_modification" || node.typeId === 136) return node;
  for (const ch of node.children || []) {
    const found = findElemModInCst(ch);
    if (found) return found;
  }
  return null;
}

function findNameInCst(node: any): any {
  if (!node) return null;
  if (Cst.Identifier.is(node) || node.type === "identifier" || node.type === "name") return node;
  for (const ch of node.children || []) {
    const found = findNameInCst(ch);
    if (found) return found;
  }
  return null;
}

function findClassModInCst(node: any): any {
  if (!node) return null;
  if (Cst.ClassModification.is(node) || node.type === "class_modification" || node.typeId === 132) return node;
  for (const ch of node.children || []) {
    const found = findClassModInCst(ch);
    if (found) return found;
  }
  return null;
}

function findDeclarationsInCst(node: any): any[] {
  const results: any[] = [];
  if (!node) return results;
  if (Cst.AnnotationClause.is(node) || node.type === "annotation_clause" || node.type === "AnnotationClause") {
    return results;
  }
  if (Cst.Declaration.is(node) || node.type === "declaration") {
    results.push(node);
    return results;
  }
  for (const ch of node.children || []) {
    results.push(...findDeclarationsInCst(ch));
  }
  return results;
}

export function stripCommentsAndStrings(text: string): string {
  let out = "";
  let i = 0;
  const len = text.length;
  while (i < len) {
    const ch = text[i]!;
    if (ch === "/" && i + 1 < len && text[i + 1] === "*") {
      const end = text.indexOf("*/", i + 2);
      if (end !== -1) {
        out += " ";
        i = end + 2;
        continue;
      }
    } else if (ch === "/" && i + 1 < len && text[i + 1] === "/") {
      const nl = text.indexOf("\n", i + 2);
      out += " ";
      i = nl === -1 ? len : nl;
      continue;
    } else if (ch === '"') {
      let j = i + 1;
      let closed = false;
      while (j < len) {
        if (text[j] === "\\") {
          j += 2;
        } else if (text[j] === '"') {
          j++;
          closed = true;
          break;
        } else {
          j++;
        }
      }
      if (closed) {
        out += " ";
        i = j;
        continue;
      }
    }
    out += ch;
    i++;
  }
  return out;
}

export function stripAnnotationsAndComments(text: string): string {
  const stripped = stripCommentsAndStrings(text);
  let out = "";
  let i = 0;
  const len = stripped.length;
  while (i < len) {
    if (matchesCiKeywordAt(stripped, i, "annotation")) {
      let j = i + "annotation".length;
      while (j < len && isAsciiWhitespaceCode(stripped.charCodeAt(j))) j++;
      if (j < len && stripped[j] === "(") {
        let depth = 1;
        let k = j + 1;
        let stoppedOnSemi = false;
        while (k < len && depth > 0) {
          const c = stripped[k]!;
          if (c === ";") {
            stoppedOnSemi = true;
            break;
          }
          if (c === "(") depth++;
          else if (c === ")") depth--;
          k++;
        }
        if (!stoppedOnSemi && depth === 0) {
          out += " ";
          i = k;
          continue;
        }
      }
    }
    out += stripped[i]!;
    i++;
  }
  return out;
}

export function extractCstModifierValue(cstNode: any, paramName: string): string | undefined {
  if (!cstNode || !paramName) return undefined;
  if (typeof cstNode.tree?.sourceCode === "string") {
    const src: string = cstNode.tree.sourceCode;
    const sIdx = cstNode.startIndex ?? 0;
    const eIdx = cstNode.endIndex ?? src.length;
    const pos = src.indexOf(paramName, sIdx);
    if (pos === -1 || pos >= eIdx) return undefined;
  }

  // 1. Direct declaration binding: e.g. parameter Real R = 100
  const decls =
    Cst.Declaration.is(cstNode) || cstNode.type === "declaration" ? [cstNode] : findDeclarationsInCst(cstNode);
  for (const decl of decls) {
    const nameNode = (Cst.Declaration.is(decl) ? (Cst.Declaration as any).name?.(decl) : null) ?? findNameInCst(decl);
    const identifier = nameNode?.text?.trim() ?? nameNode?.name ?? nameNode?.value;
    if (identifier === paramName) {
      const valModNode =
        (Cst.Declaration.is(decl) ? (Cst.Declaration as any).modification?.(decl) : null) ??
        (decl.children || []).find((c: any) => Cst.Modification.is(c) || c.type === "modification");
      if (valModNode) {
        const text = valModNode.text?.trim() ?? valModNode.value;
        if (text?.startsWith("=")) {
          return stripLeadingEquals(text);
        }
        if (text && !text.startsWith("(") && !text.startsWith("{")) {
          return text;
        }
      }
    }
  }

  // 2. Class modification arguments: e.g. Resistor R(R = 100)
  const args = findArgsInCst(cstNode);
  for (const arg of args) {
    const elemMod = findElemModInCst(arg);
    if (!elemMod) continue;

    const nameNode =
      (Cst.ElementModification.is(elemMod) ? Cst.ElementModification.name(elemMod) : null) ?? findNameInCst(elemMod);
    const identifier = nameNode?.text?.trim() ?? nameNode?.name ?? nameNode?.value;
    if (identifier === paramName) {
      const valModNode =
        (Cst.ElementModification.is(elemMod) ? Cst.ElementModification.modification(elemMod) : null) ??
        (elemMod.children || []).find((c: any) => Cst.Modification.is(c) || c.type === "modification");
      if (valModNode) {
        const text = valModNode.text?.trim() ?? valModNode.value;
        if (text?.startsWith("=")) {
          return stripLeadingEquals(text);
        }
        return text;
      }
    }
  }
  return undefined;
}

export function extractCstNestedModifierValue(
  cstNode: any,
  paramName: string,
  subParamName: string,
): string | undefined {
  if (!cstNode || !paramName) return undefined;
  if (typeof cstNode.tree?.sourceCode === "string") {
    const src: string = cstNode.tree.sourceCode;
    const sIdx = cstNode.startIndex ?? 0;
    const eIdx = cstNode.endIndex ?? src.length;
    const pos = src.indexOf(paramName, sIdx);
    if (pos === -1 || pos >= eIdx) return undefined;
  }
  // 1. Direct dotted notation: e.g. V.start = 5
  const dotted = extractCstModifierValue(cstNode, `${paramName}.${subParamName}`);
  if (dotted) return dotted;

  // 2. Nested class modification: e.g. V(start = 5)
  const args = findArgsInCst(cstNode);
  for (const arg of args) {
    const elemMod = findElemModInCst(arg);
    if (!elemMod) continue;
    const nameNode = findNameInCst(elemMod);
    if (nameNode && nameNode.text?.trim() === paramName) {
      const classMod = findClassModInCst(elemMod);
      if (classMod) {
        const nestedVal = extractCstModifierValue(classMod, subParamName);
        if (nestedVal) return nestedVal;
      }
    }
  }
  return undefined;
}

export function parseIfThenElse(expr: string): { cond: string; thenVal: string; elseVal: string } | null {
  const trimmed = expr.trim();
  if (!matchesCiKeywordAt(trimmed, 0, "if")) return null;

  let pos = 2;
  const len = trimmed.length;
  let parenDepth = 0;
  let ifDepth = 1;
  let inString = false;
  let thenStart = -1;
  let thenEnd = -1;
  let elseStart = -1;

  while (pos < len) {
    const ch = trimmed[pos]!;

    if (inString) {
      if (ch === "\\") {
        pos += 2;
        continue;
      }
      if (ch === '"') {
        inString = false;
      }
      pos++;
      continue;
    }

    if (ch === '"') {
      inString = true;
      pos++;
      continue;
    }

    if (ch === "(") {
      parenDepth++;
      pos++;
      continue;
    }
    if (ch === ")") {
      if (parenDepth > 0) parenDepth--;
      pos++;
      continue;
    }

    if (parenDepth === 0) {
      if (matchesCiKeywordAt(trimmed, pos, "if")) {
        ifDepth++;
        pos += 2;
        continue;
      }
      if (matchesCiKeywordAt(trimmed, pos, "then")) {
        if (ifDepth === 1 && thenStart === -1) {
          thenStart = pos + 4;
        }
        pos += 4;
        continue;
      }
      if (matchesCiKeywordAt(trimmed, pos, "else")) {
        if (ifDepth === 1 && thenStart !== -1 && elseStart === -1) {
          thenEnd = pos;
          elseStart = pos + 4;
        } else if (ifDepth > 1) {
          ifDepth--;
        }
        pos += 4;
        continue;
      }
    }

    pos++;
  }

  if (thenStart !== -1 && elseStart !== -1) {
    const cond = trimmed.slice(2, thenStart - 4).trim();
    const thenVal = trimmed.slice(thenStart, thenEnd).trim();
    const elseVal = trimmed.slice(elseStart).trim();
    return { cond, thenVal, elseVal };
  }

  return null;
}

function resolveElementUnit(element: unknown): string | undefined {
  if (!element || typeof element !== "object") return undefined;
  const el = element as {
    modification?: { getModificationArgument?: (n: string) => { expression?: unknown } };
    classInstance?: {
      name?: string;
      modification?: { getModificationArgument?: (n: string) => { expression?: unknown } };
    };
    declaration?: { metadata?: { unit?: unknown; typeSpecifier?: string } };
    unit?: unknown;
  };
  const unitExpr =
    el.modification?.getModificationArgument?.("unit")?.expression ??
    el.classInstance?.modification?.getModificationArgument?.("unit")?.expression;
  const rawUnitVal = formatPropertyValue(unitExpr);
  const rawUnit = rawUnitVal !== undefined ? stripOuterDoubleQuotes(rawUnitVal) : undefined;
  if (rawUnit) return formatUnit(rawUnit);

  const metaUnit = el.declaration?.metadata?.unit ?? el.unit;
  if (typeof metaUnit === "string" && metaUnit.length > 0) return formatUnit(metaUnit);

  const typeSpec = el.declaration?.metadata?.typeSpecifier ?? el.classInstance?.name ?? "";
  if (typeSpec.includes("LinearTemperatureCoefficient")) return "1/K";
  if (typeSpec.includes("Resistance")) return "Ω";
  if (typeSpec.includes("Inductance")) return "H";
  if (typeSpec.includes("Capacitance")) return "F";
  if (typeSpec.includes("Voltage") || typeSpec.includes("Potential")) return "V";
  if (typeSpec.includes("Current")) return "A";
  if (typeSpec.includes("TemperatureSlope")) return "K/s";
  if (typeSpec.includes("Temperature")) return "K";
  if (typeSpec.includes("Time")) return "s";
  if (typeSpec.includes("Frequency")) return "Hz";
  if (typeSpec.includes("Power")) return "W";
  return undefined;
}

export function evaluateMacroExpression(
  expr: string,
  classInstance?: ModelicaClassInstance,
  componentInstance?: ModelicaComponentInstance,
): string {
  const trimmed = expr.trim();
  const ifBranch = parseIfThenElse(trimmed);
  if (ifBranch) {
    const isTrue = evalMacroCondition(ifBranch.cond, classInstance, componentInstance);
    const chosen = isTrue ? ifBranch.thenVal : ifBranch.elseVal;
    return stripQuotes(evaluateMacroExpression(chosen, classInstance, componentInstance));
  }

  const name = trimmed.startsWith("%") ? trimmed.slice(1) : trimmed;
  // 1. Check if the specific component instance overrides this parameter
  let compVal: string | undefined;
  const compNode = componentInstance as
    | {
        cstNode?: {
          tree?: { sourceCode?: string };
          startIndex?: number;
          endIndex?: number;
          text?: string;
          children?: any[];
        };
        abstractSyntaxNode?: {
          tree?: { sourceCode?: string };
          startIndex?: number;
          endIndex?: number;
          text?: string;
          children?: any[];
        };
        modification?: { getModificationArgument?: (n: string) => { expression?: unknown } };
        text?: string;
      }
    | undefined;
  const compCst = compNode?.cstNode ?? compNode?.abstractSyntaxNode;
  if (compCst) {
    compVal = extractCstModifierValue(compCst, name);
    if (!compVal) {
      const nonAnnChildren = (compCst.children || []).filter(
        (c: any) => c.type !== "annotation_clause" && c.type !== "AnnotationClause",
      );
      for (const ch of nonAnnChildren) {
        compVal = extractCstModifierValue(ch, name);
        if (compVal) break;
      }
    }
    if (!compVal && typeof compCst.text === "string") {
      const sanitized = stripAnnotationsAndComments(compCst.text);
      const extracted = extractNamedModAssignmentFallback(sanitized, name, true);
      if (extracted) {
        compVal = extracted;
      }
    }
  }

  if (!compVal && componentInstance) {
    const compArgExpr = compNode?.modification?.getModificationArgument?.(name)?.expression;
    compVal = formatPropertyValue(compArgExpr);
    if (!compVal && typeof compNode?.text === "string") {
      const sanitized = stripAnnotationsAndComments(compNode.text);
      const extracted = extractNamedModAssignmentFallback(sanitized, name, true);
      if (extracted) {
        compVal = extracted;
      }
    }
    const compInstanceVals = (componentInstance as { values?: Record<string, unknown> }).values;
    if (!compVal && compInstanceVals && compInstanceVals[name] !== undefined) {
      compVal = String(compInstanceVals[name]);
    }
  }

  const namedElement =
    typeof classInstance?.["resolveName"] === "function" ? classInstance["resolveName"](name.split(".")) : null;

  // 2. Check if the class provides a default value for this parameter
  let elemVal: string | undefined;
  if (!compVal && namedElement) {
    const elemObj = namedElement as {
      value?: unknown;
      cstNode?: { text?: string };
      abstractSyntaxNode?: { text?: string };
      modification?: { expression?: unknown; getModificationArgument?: (n: string) => { expression?: unknown } };
    };
    elemVal = formatPropertyValue(elemObj.value);
    if (!elemVal) {
      const elemCst = elemObj.cstNode ?? elemObj.abstractSyntaxNode;
      if (elemCst) {
        elemVal = extractCstModifierValue(elemCst, "start") ?? extractCstModifierValue(elemCst, name);
        if (!elemVal && typeof elemCst.text === "string" && elemCst.text.includes("=")) {
          const cleanText = stripAnnotationsAndComments(elemCst.text);
          const extracted = readValueAfterEqualsExcluding(cleanText, ";", true);
          if (extracted) {
            elemVal = extracted;
          }
        }
      } else {
        const elemMod = elemObj.modification;
        const elemExpr = elemMod?.expression ?? elemMod?.getModificationArgument?.("start")?.expression;
        elemVal = formatPropertyValue(elemExpr);
      }
    }
  }

  const finalVal = compVal ?? elemVal;

  const resolvedUnit = resolveElementUnit(namedElement);
  const unitString = resolvedUnit ? " " + resolvedUnit : "";

  if (finalVal !== undefined && finalVal !== "") {
    return finalVal + unitString;
  }

  if ((name.startsWith('"') && name.endsWith('"')) || (name.startsWith("'") && name.endsWith("'"))) {
    return name.slice(1, -1);
  }

  if (trimmed.startsWith("%")) {
    return "";
  }

  return name;
}

/**
 * DOM-free text rendering — generates X6Markup directly without using
 * document.createElementNS or @svgdotjs/svg.js (unavailable in Web Worker).
 */
function renderTextX6(
  graphicItem: IText,
  classInstance?: ModelicaClassInstance,
  componentInstance?: ModelicaComponentInstance,
  iconScale?: number,
): X6Markup {
  const [x1, y1] = convertPoint(graphicItem?.extent?.[0], [0, 0]);
  const [x2, y2] = convertPoint(graphicItem?.extent?.[1], [0, 0]);
  const _x = Math.min(x1, x2);
  void _x;
  const _y = Math.min(y1, y2);
  void _y;
  const width = computeWidth(graphicItem.extent);
  const height = computeHeight(graphicItem.extent);

  // Text substitution — matches core svg.ts renderText() with advanced conditional macro evaluation
  const rawText = graphicItem.string ?? (graphicItem as any).textString ?? "";
  let textContent: string;
  if (!rawText.includes("%")) {
    textContent = rawText;
  } else if (rawText === "%name") {
    textContent = componentInstance?.name ?? "";
  } else {
    const nameText = componentInstance?.name ?? "";
    const classText = classInstance?.name ?? "";
    const commentText = componentInstance?.["description"] ?? classInstance?.["description"] ?? "";
    textContent = expandModelicaTextMacros(rawText, nameText, classText, commentText, (expr) =>
      evaluateMacroExpression(expr, classInstance, componentInstance),
    );
  }

  if (!textContent || textContent.trim().length === 0) {
    return { tagName: "g", children: [] };
  }

  // fontSize=0 means "auto-size to fit extent" in Modelica.
  // For external component labels (%name, %period, etc.), OMEdit keeps a readable
  // minimum font size and truncates overflow with "..." rather than shrinking to illegible sizes.
  let fontSize = graphicItem.fontSize ?? 0;
  const isExternalLabel = rawText.includes("%") && (rawText === "%name" || Math.max(Math.abs(y1), Math.abs(y2)) > 100);
  if (fontSize === 0) {
    if (isExternalLabel) {
      const scale = iconScale && iconScale > 0 ? iconScale : 0.1;
      const minIconFontSize = 2.85 / scale;
      fontSize = Math.max(height * 0.72, minIconFontSize);
      const charWidth = fontSize * 0.54;
      if (width > 0 && textContent.length * charWidth > width) {
        const maxChars = Math.max(1, Math.floor(width / charWidth) - 2);
        if (maxChars < textContent.length) {
          textContent = textContent.slice(0, maxChars) + "...";
        }
      }
    } else {
      const charCount = Math.max(textContent.length, 1);
      // Approximate: each character is ~0.6x the font size in width
      // So: charCount * 0.6 * fontSize <= width => fontSize <= width / (charCount * 0.6)
      const maxByWidth = width / (charCount * 0.6);
      const maxByHeight = height;
      fontSize = Math.min(maxByWidth, maxByHeight) * 0.78; // leave clean margin like OMEdit
      fontSize = Math.max(fontSize, 4); // minimum legible size
    }
  }
  const fontName = graphicItem.fontName ?? "sans-serif";
  const textColor = convertColor(graphicItem.lineColor ?? (graphicItem as any).textColor, "rgb(0,0,0)");

  let textAnchor = "middle";
  if (graphicItem.horizontalAlignment === TextAlignment.LEFT) textAnchor = "start";
  else if (graphicItem.horizontalAlignment === TextAlignment.RIGHT) textAnchor = "end";

  const textX =
    graphicItem.horizontalAlignment === TextAlignment.LEFT
      ? x1
      : graphicItem.horizontalAlignment === TextAlignment.RIGHT
        ? x2
        : (x1 + x2) / 2;
  const textY = (y1 + y2) / 2;

  const fontStyle = graphicItem.textStyle?.find((e: TextStyle) => e === TextStyle.ITALIC) ? "italic" : "normal";
  const fontWeight = graphicItem.textStyle?.find((e: TextStyle) => e === TextStyle.BOLD) ? "bold" : "normal";
  const textDecoration = graphicItem.textStyle?.find(
    (e: TextStyle) => e === TextStyle.UNDER_LINE || (e as any) === "UnderLine",
  )
    ? "underline"
    : "none";

  return {
    tagName: "g",
    attrs: {
      overflow: "visible",
    },
    children: [
      {
        tagName: "text",
        textContent,
        attrs: {
          style: `dominant-baseline: central; fill: ${textColor}; stroke: none; font-family: ${fontName}; font-size: ${fontSize}px; font-style: ${fontStyle}; font-weight: ${fontWeight}; text-decoration: ${textDecoration}; text-anchor: ${textAnchor};`,
          x: textX,
          y: textY,
        },
      },
    ],
  };
}

// ── Shape styling helpers (matching morsel's x6.ts) ──

function renderFilledShapeX6(shape: X6Markup, filledShape: IFilledShape, defs: X6Markup[]): void {
  applyFillX6(shape, filledShape, defs);
  applyLineStyleX6(shape, filledShape);
}

function applyCoordinateSystemX6(markup: X6Markup, coordinateSystem?: ICoordinateSystem, isRoot = true): void {
  const [x1, y1] = convertPoint(coordinateSystem?.extent?.[0], [-100, -100]);
  const [x2, y2] = convertPoint(coordinateSystem?.extent?.[1], [100, 100]);
  const x = Math.min(x1, x2);
  const y = Math.min(y1, y2);
  const width = computeWidth(coordinateSystem?.extent);
  const height = computeHeight(coordinateSystem?.extent);
  if (!markup.attrs) markup.attrs = {};
  markup.attrs["viewBox"] = `${x} ${y} ${width} ${height}`;
  markup.attrs["preserveAspectRatio"] = "none";
  markup.attrs["overflow"] = "visible";
  if (!isRoot) {
    markup.attrs["x"] = x;
    markup.attrs["y"] = y;
    markup.attrs["width"] = width;
    markup.attrs["height"] = height;
  }
}

function applyFillX6(shape: X6Markup, filledShape: IFilledShape, defs: X6Markup[]) {
  if (!shape.attrs) shape.attrs = {};
  const rawPattern = filledShape.fillPattern;
  let pattern = "none";
  if (typeof rawPattern === "string") {
    pattern = rawPattern.toLowerCase();
  } else if (typeof rawPattern === "number") {
    const enumMap = [
      "none",
      "solid",
      "horizontal",
      "vertical",
      "cross",
      "forward",
      "backward",
      "crossdiag",
      "horizontalcylinder",
      "verticalcylinder",
      "sphere",
    ];
    pattern = enumMap[rawPattern] ?? "none";
  }
  let fillValue;

  switch (pattern) {
    case "solid":
      fillValue = convertColor(filledShape.fillColor, convertColor(filledShape.lineColor, "rgb(0,0,0)"));
      break;
    case "horizontal":
      fillValue = createLinePatternX6(defs, 0, filledShape.lineColor, filledShape.fillColor);
      break;
    case "vertical":
      fillValue = createLinePatternX6(defs, 90, filledShape.lineColor, filledShape.fillColor);
      break;
    case "cross":
      fillValue = createCrossPatternX6(defs, 0, filledShape.lineColor, filledShape.fillColor);
      break;
    case "forward":
      fillValue = createLinePatternX6(defs, -45, filledShape.lineColor, filledShape.fillColor);
      break;
    case "backward":
      fillValue = createLinePatternX6(defs, 45, filledShape.lineColor, filledShape.fillColor);
      break;
    case "crossdiag":
      fillValue = createCrossPatternX6(defs, 45, filledShape.lineColor, filledShape.fillColor);
      break;
    case "horizontalcylinder":
      fillValue = createLinearGradientX6(defs, "vertical", filledShape.lineColor, filledShape.fillColor);
      break;
    case "verticalcylinder":
      fillValue = createLinearGradientX6(defs, "horizontal", filledShape.lineColor, filledShape.fillColor);
      break;
    case "sphere":
      fillValue = createRadialGradientX6(defs, filledShape.lineColor, filledShape.fillColor);
      break;
    default:
      fillValue = "none";
  }

  shape.attrs["fill"] = fillValue;
  if (!shape.attrs["style"]) shape.attrs["style"] = "";
  shape.attrs["style"] = (shape.attrs["style"] as string) + `; fill: ${fillValue} !important;`;
}

function applyLineStyleX6(shape: X6Markup, graphicItem: IFilledShape | ILine): void {
  if (!shape.attrs) shape.attrs = {};
  let color, thickness, pattern;

  if (graphicItem["@type"] === "Line") {
    const line = graphicItem as ILine;
    color = line.color;
    thickness = line.thickness;
    pattern = line.pattern;
  } else {
    const filled = graphicItem as IFilledShape;
    color = filled.lineColor;
    thickness = filled.lineThickness;
    pattern = filled.pattern;
  }

  const strokeColor = convertColor(color, "rgb(0,0,0)");
  const rawThickness = thickness ?? 0.25;
  const strokeWidth =
    rawThickness <= 0.25
      ? graphicItem["@type"] === "Line"
        ? 1.0
        : 0.85
      : Math.min(3.5, Math.round((0.85 + (rawThickness - 0.25) * 0.35) * 100) / 100);
  const rawLinePattern = pattern;
  let linePattern = "solid";
  if (typeof rawLinePattern === "string") {
    linePattern = rawLinePattern.toLowerCase();
  } else if (typeof rawLinePattern === "number") {
    const enumMap = ["none", "solid", "dash", "dot", "dashdot", "dashdotdot"];
    linePattern = enumMap[rawLinePattern] ?? "solid";
  }

  let strokeDasharray = "none";
  switch (linePattern) {
    case "dash":
      strokeDasharray = "4, 2";
      break;
    case "dot":
      strokeDasharray = "1, 2";
      break;
    case "dashdot":
      strokeDasharray = "4, 2, 1, 2";
      break;
    case "dashdotdot":
      strokeDasharray = "4, 2, 1, 2, 1, 2";
      break;
    case "none":
      shape.attrs["stroke"] = "none";
      if (!shape.attrs["style"]) shape.attrs["style"] = "";
      shape.attrs["style"] = (shape.attrs["style"] as string) + "; stroke: none !important;";
      return;
  }

  shape.attrs["stroke"] = strokeColor;
  shape.attrs["stroke-width"] = strokeWidth;
  if (strokeDasharray !== "none") shape.attrs["stroke-dasharray"] = strokeDasharray;
  if (!shape.attrs["style"]) shape.attrs["style"] = "";
  shape.attrs["style"] =
    (shape.attrs["style"] as string) +
    `; stroke: ${strokeColor} !important; stroke-width: ${strokeWidth}px !important; stroke-dasharray: ${strokeDasharray} !important;`;
  shape.attrs["vector-effect"] = "non-scaling-stroke";
}

// ── Pattern/gradient helpers ──

let defsCounter = 0;

function getStableId(prefix: string, params: unknown, defs: X6Markup[]): string {
  const str = JSON.stringify(params);
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    const char = str.charCodeAt(i);
    hash = (hash << 5) - hash + char;
    hash |= 0;
  }

  let defsId = (defs as any).__defsId;
  if (!defsId) {
    defsId = ++defsCounter;
    Object.defineProperty(defs, "__defsId", { value: defsId, enumerable: false });
  }

  return `${prefix}-${Math.abs(hash).toString(36)}-${defsId}`;
}

function addDefIfMissing(defs: X6Markup[], def: X6Markup) {
  const id = def.attrs?.["id"];
  if (!id) {
    defs.push(def);
    return;
  }
  let idSet: Set<string | number> = (defs as any).__idSet;
  if (!idSet) {
    idSet = new Set(defs.map((d) => d.attrs?.["id"]).filter((v): v is string | number => v !== undefined && v !== ""));
    Object.defineProperty(defs, "__idSet", { value: idSet, enumerable: false, writable: true });
  }
  if (!idSet.has(id)) {
    idSet.add(id);
    defs.push(def);
  }
}

function createLinePatternX6(defs: X6Markup[], rotation: number, lineColor?: IColor, fillColor?: IColor): string {
  const id = getStableId("pattern-line", { rotation, lineColor, fillColor }, defs);
  const children: X6Markup[] = [];
  if (fillColor) children.push({ tagName: "rect", attrs: { width: 4, height: 4, fill: convertColor(fillColor) } });
  children.push({
    tagName: "line",
    attrs: { x1: 0, y1: 2, x2: 4, y2: 2, stroke: convertColor(lineColor), "stroke-width": 0.5 },
  });
  addDefIfMissing(defs, {
    tagName: "pattern",
    attrs: {
      id,
      x: 0,
      y: 0,
      width: 4,
      height: 4,
      patternUnits: "userSpaceOnUse",
      patternTransform: `rotate(${rotation})`,
    },
    children,
  });
  return `url(#${id})`;
}

function createCrossPatternX6(defs: X6Markup[], rotation: number, lineColor?: IColor, fillColor?: IColor): string {
  const id = getStableId("pattern-cross", { rotation, lineColor, fillColor }, defs);
  const children: X6Markup[] = [];
  if (fillColor) children.push({ tagName: "rect", attrs: { width: 4, height: 4, fill: convertColor(fillColor) } });
  children.push({
    tagName: "line",
    attrs: { x1: 0, y1: 2, x2: 4, y2: 2, stroke: convertColor(lineColor), "stroke-width": 0.5 },
  });
  children.push({
    tagName: "line",
    attrs: { x1: 2, y1: 0, x2: 2, y2: 4, stroke: convertColor(lineColor), "stroke-width": 0.5 },
  });
  addDefIfMissing(defs, {
    tagName: "pattern",
    attrs: {
      id,
      x: 0,
      y: 0,
      width: 4,
      height: 4,
      patternUnits: "userSpaceOnUse",
      patternTransform: `rotate(${rotation})`,
    },
    children,
  });
  return `url(#${id})`;
}

function createLinearGradientX6(
  defs: X6Markup[],
  direction: "horizontal" | "vertical",
  lineColor?: IColor,
  fillColor?: IColor,
): string {
  const id = getStableId("gradient-linear", { direction, lineColor, fillColor }, defs);
  const c = convertColor(fillColor, "rgb(255,255,255)");
  const h = convertColor(lineColor, "rgb(0,0,0)");
  addDefIfMissing(defs, {
    tagName: "linearGradient",
    attrs: { id, x1: 0, y1: 0, x2: direction === "horizontal" ? 1 : 0, y2: direction === "vertical" ? 1 : 0 },
    children: [
      { tagName: "stop", attrs: { offset: "0%", "stop-color": h } },
      { tagName: "stop", attrs: { offset: "50%", "stop-color": c } },
      { tagName: "stop", attrs: { offset: "100%", "stop-color": h } },
    ],
  });
  return `url(#${id})`;
}

function createRadialGradientX6(defs: X6Markup[], lineColor?: IColor, fillColor?: IColor): string {
  const id = getStableId("gradient-radial", { lineColor, fillColor }, defs);
  const c = convertColor(fillColor, "rgb(255,255,255)");
  const h = convertColor(lineColor, "rgb(0,0,0)");
  addDefIfMissing(defs, {
    tagName: "radialGradient",
    attrs: { id, cx: "30%", cy: "30%", r: "70%" },
    children: [
      { tagName: "stop", attrs: { offset: "0%", "stop-color": c } },
      { tagName: "stop", attrs: { offset: "100%", "stop-color": h } },
    ],
  });
  return `url(#${id})`;
}

// ── Helpers ──

function unflipText(node: X6Markup, sx: number, sy: number): void {
  if (!node?.children) return;
  for (const child of node.children) {
    if (child.tagName === "text") {
      if (!child.attrs) child.attrs = {};
      const textX = Number(child.attrs["x"] ?? 0);
      const textY = Number(child.attrs["y"] ?? 0);
      const existingTransform = (child.attrs["transform"] as string) || "";
      const scaleTransform = `translate(${textX} ${textY}) scale(${sx} ${sy}) translate(${-textX} ${-textY})`;
      child.attrs["transform"] = existingTransform ? `${existingTransform} ${scaleTransform}` : scaleTransform;
      if (child.attrs["style"] && typeof child.attrs["style"] === "string") {
        child.attrs["style"] = stripTransformStyleDecls(child.attrs["style"], "scale");
      }
    }
    unflipText(child, sx, sy);
  }
}

function unrotateText(node: X6Markup, rotateAngle: number): void {
  if (!node?.children || rotateAngle === 0) return;
  for (const child of node.children) {
    if (child.tagName === "text") {
      if (!child.attrs) child.attrs = {};
      const textX = Number(child.attrs["x"] ?? 0);
      const textY = Number(child.attrs["y"] ?? 0);
      let rot = -rotateAngle % 360;
      if (rot < 0) rot += 360;
      // Keep text right-side up and readable from left-to-right or bottom-to-top
      if (rot > 90 && rot <= 270) {
        rot = (rot + 180) % 360;
      }
      const existingTransform = (child.attrs["transform"] as string) || "";
      const rotTransform = `rotate(${rot} ${textX} ${textY})`;
      child.attrs["transform"] = existingTransform ? `${existingTransform} ${rotTransform}` : rotTransform;
      if (child.attrs["style"] && typeof child.attrs["style"] === "string") {
        child.attrs["style"] = stripTransformStyleDecls(child.attrs["style"], "rotate");
      }
    }
    unrotateText(child, rotateAngle);
  }
}

function buildMarker(arrow: string | null | undefined, strokeColor: string, strokeWidth: number): DiagramEdgeMarker {
  if (!arrow) return null;
  const normalized = arrow.toLowerCase();
  switch (normalized) {
    case "filled":
      return {
        tagName: "path",
        d: "M 0 0 L 10 5 L 0 10 Z",
        "stroke-width": strokeWidth,
        fill: strokeColor,
        stroke: strokeColor,
        refX: 10,
        refY: 5,
        markerUnits: "userSpaceOnUse",
      };
    case "half":
      return {
        tagName: "path",
        d: "M 0 0 L 10 5",
        "stroke-width": strokeWidth,
        fill: "none",
        stroke: strokeColor,
        refX: 10,
        refY: 5,
        markerUnits: "userSpaceOnUse",
      };
    case "open":
      return {
        tagName: "path",
        d: "M 0 0 L 10 5 L 0 10",
        "stroke-width": strokeWidth,
        fill: "none",
        stroke: strokeColor,
        refX: 10,
        refY: 5,
        markerUnits: "userSpaceOnUse",
      };
    default:
      return null;
  }
}

export function x6MarkupToSvg(markup: X6Markup): string {
  const attrs = markup.attrs
    ? Object.entries(markup.attrs)
        .filter(([, v]) => v !== undefined)
        .map(([k, v]) => `${k}="${String(v).replaceAll('"', "&quot;")}"`)
        .join(" ")
    : "";
  const open = attrs ? `<${markup.tagName} ${attrs}` : `<${markup.tagName}`;
  const childrenStr = Array.isArray(markup.children)
    ? markup.children.map(x6MarkupToSvg).join("")
    : typeof markup.children === "string"
      ? markup.children
      : "";
  const text = markup.textContent ?? "";
  if (!childrenStr && !text) return `${open}/>`;
  return `${open}>${text}${childrenStr}</${markup.tagName}>`;
}

export function hasGraphicElements(node: X6Markup): boolean {
  const shapeTags = new Set(["rect", "ellipse", "circle", "polygon", "polyline", "path", "line", "image", "text"]);
  if (shapeTags.has(node.tagName)) return true;
  return Array.isArray(node.children) ? node.children.some(hasGraphicElements) : false;
}

function findStrokeWidthPxSpan(
  style: string,
  requireImportant: boolean,
): { start: number; end: number; numStr: string } | null {
  const key = "stroke-width:";
  let from = 0;
  while (from <= style.length - key.length) {
    const start = style.indexOf(key, from);
    if (start < 0) return null;
    let i = start + key.length;
    while (i < style.length && isAsciiWhitespaceCode(style.charCodeAt(i))) i++;
    const numStart = i;
    while (i < style.length && ((style.charCodeAt(i) >= 48 && style.charCodeAt(i) <= 57) || style[i] === ".")) i++;
    const numStr = style.slice(numStart, i);
    if (numStr.length > 0 && style.startsWith("px", i)) {
      let end = i + 2;
      if (!requireImportant) return { start, end, numStr };
      let j = end;
      while (j < style.length && isAsciiWhitespaceCode(style.charCodeAt(j))) j++;
      if (style.startsWith("!important", j)) {
        j += "!important".length;
        if (style[j] === ";") j++;
        return { start, end: j, numStr };
      }
    }
    from = start + key.length;
  }
  return null;
}

function bakeVectorEffect(markup: X6Markup, scale: number): void {
  if (markup.attrs) {
    if (markup.attrs["vector-effect"] === "non-scaling-stroke") {
      delete markup.attrs["vector-effect"];

      let sw = 1;
      if (markup.attrs["stroke-width"] !== undefined) {
        sw = parseFloat(String(markup.attrs["stroke-width"]));
      } else if (typeof markup.attrs["style"] === "string") {
        const span = findStrokeWidthPxSpan(markup.attrs["style"], false);
        if (span) sw = parseFloat(span.numStr);
      }

      const newSw = sw * scale;
      markup.attrs["stroke-width"] = newSw;

      if (typeof markup.attrs["style"] === "string") {
        const span = findStrokeWidthPxSpan(markup.attrs["style"], true);
        if (span) {
          markup.attrs["style"] =
            markup.attrs["style"].slice(0, span.start) +
            `stroke-width: ${newSw}px !important;` +
            markup.attrs["style"].slice(span.end);
        }
      }
    }

    // Clean up style if it's empty
    if (markup.attrs["style"] === "") {
      delete markup.attrs["style"];
    }
  }

  if (Array.isArray(markup.children)) {
    for (const child of markup.children) {
      bakeVectorEffect(child, scale);
    }
  }
}

function collectInheritedCstNodesBottomUp(
  cls: ModelicaClassInstance | null | undefined,
  visiting = new Set<unknown>(),
): unknown[] | null {
  if (!cls || typeof cls !== "object") return null;
  if (visiting.has(cls)) return null;
  visiting.add(cls);

  const nodes: unknown[] = [];
  for (const ext of cls.extendsClassInstances ?? []) {
    const base = ext?.["classInstance"];
    if (!base) {
      visiting.delete(cls);
      return null;
    }
    const baseNodes = collectInheritedCstNodesBottomUp(base, visiting);
    if (!baseNodes) {
      visiting.delete(cls);
      return null;
    }
    nodes.push(...baseNodes);
  }

  visiting.delete(cls);
  const ciNode = cls as
    | { cstNode?: { tree?: unknown; ptr?: number }; abstractSyntaxNode?: { tree?: unknown; ptr?: number } }
    | null
    | undefined;
  const cstNode = ciNode?.cstNode ?? ciNode?.abstractSyntaxNode;
  if (!cstNode || !cstNode.tree || typeof cstNode.ptr !== "number" || cstNode.ptr <= 0) {
    return null;
  }
  nodes.push(cstNode);
  return nodes;
}

export function getClassIconSvg(
  cls: ModelicaClassInstance,
  size = 16,
  includePorts = false,
  componentInstance?: ModelicaComponentInstance,
): string | undefined {
  if (!cls) return undefined;

  const clsObj = cls as {
    fullName?: string;
    compositeName?: string;
    entry?: { fullName?: string; name?: string; resourceId?: string };
  };
  const qualifiedName =
    clsObj.compositeName ??
    clsObj.fullName ??
    clsObj.entry?.fullName ??
    (clsObj.entry?.resourceId ? `${clsObj.entry.resourceId}#${cls.id ?? cls.name}` : null) ??
    (cls.id !== undefined ? `id:${cls.id}` : cls.name);
  const identityKey = !includePorts && !componentInstance && qualifiedName ? `${qualifiedName}:${size}` : null;

  if (identityKey && standaloneIconSvgCache.has(identityKey)) {
    return standaloneIconSvgCache.get(identityKey);
  }

  if (!includePorts && !componentInstance) {
    const cstNodes = collectInheritedCstNodesBottomUp(cls);
    if (cstNodes && cstNodes.length > 0) {
      const wasmSvg = renderInheritedIconSvgWasm(cstNodes, size);
      if (wasmSvg) {
        if (identityKey) {
          standaloneIconSvgCache.set(identityKey, wasmSvg);
        }
        return wasmSvg;
      }
    }
  }

  try {
    const rawMarkup = renderIconX6(cls, componentInstance, includePorts, undefined, false);
    if (!rawMarkup || !hasGraphicElements(rawMarkup)) return undefined;
    const markup = structuredClone(rawMarkup);

    // Patch root SVG for standalone icon use: add xmlns, fixed size, viewBox
    if (markup.attrs) {
      markup.attrs["xmlns"] = "http://www.w3.org/2000/svg";
      markup.attrs["width"] = size * 2;
      markup.attrs["height"] = size * 2;
      delete markup.attrs["style"];

      if (typeof markup.attrs["viewBox"] === "string") {
        const vbRaw = markup.attrs["viewBox"];
        const vbParts = collapseAsciiWhitespace(vbRaw).split(" ");
        if (vbRaw.trim() === vbRaw && vbParts.length === 4 && vbParts.every((p) => isSignedAsciiNumberText(p))) {
          const vx = parseFloat(vbParts[0]!);
          const vy = parseFloat(vbParts[1]!);
          const vw = parseFloat(vbParts[2]!);
          const vh = parseFloat(vbParts[3]!);

          // Pad the viewbox by 2% to ensure Chromium doesn't clip outer stroke bounds
          const padX = vw * 0.02;
          const padY = vh * 0.02;

          markup.attrs["viewBox"] = `0 0 ${vw + padX * 2} ${vh + padY * 2}`;

          const defsIdx = (markup.children ?? []).findIndex((c) => c.tagName === "defs");
          let defsNode;
          if (defsIdx >= 0 && markup.children) {
            defsNode = markup.children.splice(defsIdx, 1)[0];
          }

          markup.children = [
            {
              tagName: "g",
              attrs: { transform: `translate(${-vx + padX}, ${-vy + padY})` },
              children: markup.children,
            },
          ];

          if (defsNode) {
            markup.children.unshift(defsNode);
          }

          // Fix Chromium bug where `vector-effect="non-scaling-stroke"`
          // causes path arcs to distort or render as straight lines when placed inside an <img> or data URI.
          // We remove the vector-effect and manually bake the scaled stroke-width.
          const scale = Math.max(vw / size, vh / size);
          bakeVectorEffect(markup, scale);
        }
      }
    }
    let svgString = x6MarkupToSvg(markup);

    // Ensure all defs IDs are uniquely postfixed for this specific standalone icon rendering
    // to prevent Chromium SVG cache collisions across different image tags
    const uniqueSuffix = "-" + Math.random().toString(36).substring(2, 8);
    svgString = postfixSvgDefRefs(svgString, 'id="', '"', uniqueSuffix);
    svgString = postfixSvgDefRefs(svgString, "url(#", ")", uniqueSuffix);

    if (identityKey) {
      standaloneIconSvgCache.set(identityKey, svgString);
    }

    return svgString;
  } catch {
    // ignore icon rendering errors
  }
  return undefined;
}

// ── On-demand component property builder ──
// Called lazily when the user clicks a component in the diagram.
// This avoids the expensive parameter/doc/icon computation during initial diagram load.

function stripEnvelopeTagPair(html: string, tagName: string): string {
  let s = html.trim();
  const lowerStart = `<${tagName}`;
  if (s.toLowerCase().startsWith(lowerStart)) {
    const nextCh = s[lowerStart.length];
    if (nextCh === ">" || (nextCh !== undefined && isAsciiWhitespaceCode(s.charCodeAt(lowerStart.length)))) {
      const closeBracket = s.indexOf(">", lowerStart.length);
      if (closeBracket >= 0) {
        s = s.slice(closeBracket + 1).trimStart();
      }
    }
  }
  const lowerClose = `</${tagName}`;
  if (s.endsWith(">")) {
    const closeIdx = s.toLowerCase().lastIndexOf(lowerClose);
    if (closeIdx >= 0 && closeIdx + lowerClose.length < s.length) {
      const between = s.slice(closeIdx + lowerClose.length, s.length - 1);
      if (between.trim() === "") {
        s = s.slice(0, closeIdx).trimEnd();
      }
    }
  }
  return s;
}

function stripHtmlEnvelope(html: string): string {
  return stripEnvelopeTagPair(stripEnvelopeTagPair(html, "html"), "body").trim();
}

const bitmapDataUriCache = new Map<string, string | null>();

/**
 * Resolves a `modelica://` URI into a base64 data URI for bitmaps/images.
 */
export function resolveModelicaBitmapUri(uri: string, classInstance?: ModelicaClassInstance): string | null {
  if (!uri) return null;
  if (uri.startsWith("data:")) return uri;
  if (bitmapDataUriCache.has(uri)) return bitmapDataUriCache.get(uri) ?? null;

  let normalizedUri = uri;
  if (
    !normalizedUri.startsWith("modelica://") &&
    !normalizedUri.startsWith("http://") &&
    !normalizedUri.startsWith("https://")
  ) {
    const rawLib = (classInstance as any)?.compositeName || classInstance?.name || "";
    const libName = rawLib.split(".")[0];
    if (libName) {
      const cleanRel = uri.startsWith("./") ? uri.slice(2) : uri.startsWith("/") ? uri.slice(1) : uri;
      normalizedUri = `modelica://${libName}/${cleanRel}`;
    }
  }

  if (!normalizedUri.startsWith("modelica://")) {
    bitmapDataUriCache.set(uri, null);
    return null;
  }
  const afterScheme = normalizedUri.slice("modelica://".length);
  const slashIdx = afterScheme.indexOf("/");
  if (slashIdx <= 0) {
    bitmapDataUriCache.set(uri, null);
    return null;
  }
  const libraryName = afterScheme.slice(0, slashIdx);
  const relativePath = afterScheme.slice(slashIdx + 1);

  // 1. Try classInstance.context or classInstance.db?.context
  const ctx = (classInstance as any)?.context ?? (classInstance as any)?.db?.context;
  let resolved: string | null = null;
  if (typeof ctx?.resolveURI === "function") {
    resolved = ctx.resolveURI(normalizedUri) ?? null;
    if (resolved && typeof ctx?.fs?.readBinary === "function") {
      try {
        const binary = ctx.fs.readBinary(resolved);
        if (binary && binary.length > 0) {
          const chunks: string[] = [];
          const chunkSize = 8192;
          for (let i = 0; i < binary.length; i += chunkSize) {
            chunks.push(String.fromCharCode(...binary.subarray(i, i + chunkSize)));
          }
          const base64 = btoa(chunks.join(""));
          const ext = (resolved.split(".").pop() || "png").toLowerCase();
          const mime = ext === "svg" ? "image/svg+xml" : ext === "jpg" || ext === "jpeg" ? "image/jpeg" : "image/png";
          const dataUri = `data:${mime};base64,${base64}`;
          bitmapDataUriCache.set(uri, dataUri);
          return dataUri;
        }
      } catch {}
    }
  }

  // 2. Node.js environment resolution fallback (works dynamically without static fs imports)
  try {
    let nodeFs: any = null;
    let nodePath: any = null;
    if (typeof (globalThis as any).process?.getBuiltinModule === "function") {
      nodeFs = (globalThis as any).process.getBuiltinModule("node:fs");
      nodePath = (globalThis as any).process.getBuiltinModule("node:path");
    }
    if (nodeFs && nodePath) {
      const candidates: string[] = [];
      if (resolved) {
        candidates.push(resolved);
      }

      if (classInstance?.id && classInstance.db?.symbol) {
        const sym = classInstance.db.symbol(classInstance.id);
        if (sym?.resourceId) {
          let dir = nodePath.dirname(sym.resourceId);
          while (dir && dir !== nodePath.dirname(dir)) {
            const base = nodePath.basename(dir);
            if (base === libraryName || base.startsWith(`${libraryName} `) || base.startsWith(`${libraryName}+`)) {
              candidates.push(nodePath.join(dir, relativePath));
              break;
            }
            dir = nodePath.dirname(dir);
          }
        }
      }

      const cwd = (globalThis as any).process?.cwd?.();
      const roots: string[] = [];
      if (cwd) {
        roots.push(cwd);
        let curr = cwd;
        while (curr && curr !== nodePath.dirname(curr)) {
          if (
            nodeFs.existsSync(nodePath.join(curr, ".git")) ||
            nodeFs.existsSync(nodePath.join(curr, "nx.json")) ||
            nodeFs.existsSync(nodePath.join(curr, "pnpm-workspace.yaml"))
          ) {
            if (!roots.includes(curr)) roots.push(curr);
            break;
          }
          curr = nodePath.dirname(curr);
        }
      }
      try {
        if (typeof import.meta !== "undefined" && (import.meta as unknown as { dirname?: string }).dirname) {
          let metaCurr = (import.meta as unknown as { dirname?: string }).dirname;
          while (metaCurr && metaCurr !== nodePath.dirname(metaCurr)) {
            if (
              nodeFs.existsSync(nodePath.join(metaCurr, ".git")) ||
              nodeFs.existsSync(nodePath.join(metaCurr, "nx.json")) ||
              nodeFs.existsSync(nodePath.join(metaCurr, "pnpm-workspace.yaml"))
            ) {
              if (!roots.includes(metaCurr)) roots.push(metaCurr);
              break;
            }
            metaCurr = nodePath.dirname(metaCurr);
          }
        }
      } catch {}
      for (const root of roots) {
        candidates.push(nodePath.join(root, "scripts", "msl", `${libraryName} 4.0.0`, relativePath));
        candidates.push(nodePath.join(root, "scripts", "msl", libraryName, relativePath));
        candidates.push(nodePath.join(root, "scripts", libraryName, relativePath));
        candidates.push(nodePath.join(root, "scripts", relativePath));
        candidates.push(nodePath.join(root, ".cache", "test-openipsl", libraryName, relativePath));
        candidates.push(nodePath.join(root, "data", libraryName, relativePath));
        candidates.push(
          nodePath.join(root, "data", "libraries", libraryName, "3.1.0", "extracted", libraryName, relativePath),
        );
        candidates.push(nodePath.join(root, "data", "libraries", libraryName, relativePath));
        // Search across any version directory under data/libraries/<libraryName>/*/extracted/<libraryName>/
        const libDataDir = nodePath.join(root, "data", "libraries", libraryName);
        if (nodeFs.existsSync(libDataDir)) {
          try {
            const versionEntries = nodeFs.readdirSync(libDataDir, { withFileTypes: true });
            for (const vEntry of versionEntries) {
              if (vEntry.isDirectory()) {
                candidates.push(nodePath.join(libDataDir, vEntry.name, "extracted", libraryName, relativePath));
                candidates.push(nodePath.join(libDataDir, vEntry.name, libraryName, relativePath));
                candidates.push(nodePath.join(libDataDir, vEntry.name, relativePath));
              }
            }
          } catch {}
        }
        if (libraryName) {
          const libLower = libraryName.toLowerCase();
          candidates.push(nodePath.join(root, "languages", libLower, "assets", relativePath));
          candidates.push(nodePath.join(root, "languages", libLower, "assets", nodePath.basename(relativePath)));
          candidates.push(nodePath.join(root, "languages", libLower, "assets", "icon-light.png"));
          candidates.push(nodePath.join(root, "languages", libLower, "assets", "icon-dark.png"));
        }
        candidates.push(nodePath.join(root, "languages", "modelica", "assets", relativePath));
        candidates.push(nodePath.join(root, "languages", "modelica", "assets", nodePath.basename(relativePath)));
        candidates.push(nodePath.join(root, "languages", "modelica", "assets", "icon-light.png"));
      }
      const home = (globalThis as any).process?.env?.HOME;
      if (home) {
        candidates.push(
          nodePath.join(home, ".openmodelica", "libraries", `${libraryName} 4.0.0+maint.om`, relativePath),
        );
        candidates.push(nodePath.join(home, ".openmodelica", "libraries", `${libraryName} 4.0.0`, relativePath));
        candidates.push(nodePath.join(home, ".openmodelica", "libraries", libraryName, relativePath));
      }

      for (const candidate of candidates) {
        if (nodeFs.existsSync(candidate)) {
          const buf = nodeFs.readFileSync(candidate);
          const ext = (candidate.split(".").pop() || "png").toLowerCase();
          const mime = ext === "svg" ? "image/svg+xml" : ext === "jpg" || ext === "jpeg" ? "image/jpeg" : "image/png";
          const dataUri = `data:${mime};base64,${buf.toString("base64")}`;
          bitmapDataUriCache.set(uri, dataUri);
          return dataUri;
        }
      }
    }
  } catch {}

  bitmapDataUriCache.set(uri, null);
  return null;
}

function processHtml(html: string | undefined, context: any): string | undefined {
  if (!html) return html;
  const stripped = stripHtmlEnvelope(html);
  if (!context) return stripped;

  const lower = stripped.toLowerCase();
  let out = "";
  let pos = 0;

  while (pos < stripped.length) {
    const imgStart = lower.indexOf("<img", pos);
    if (imgStart < 0) {
      out += stripped.slice(pos);
      break;
    }
    if (imgStart + 4 >= stripped.length || !isAsciiWhitespaceCode(stripped.charCodeAt(imgStart + 4))) {
      out += stripped.slice(pos, imgStart + 4);
      pos = imgStart + 4;
      continue;
    }
    // Find tag closing '>' outside quotes
    let quoteChar: string | null = null;
    let tagEnd = -1;
    for (let k = imgStart + 4; k < stripped.length; k++) {
      const ch = stripped[k]!;
      if (quoteChar) {
        if (ch === quoteChar) quoteChar = null;
      } else if (ch === '"' || ch === "'") {
        quoteChar = ch;
      } else if (ch === ">") {
        tagEnd = k;
        break;
      }
    }
    if (tagEnd < 0) {
      out += stripped.slice(pos);
      break;
    }

    const tag = stripped.slice(imgStart, tagEnd + 1);
    const tagLower = tag.toLowerCase();
    let srcAttrStart = -1;
    let srcValStart = -1;
    let srcValEnd = -1;
    let srcScan = 4;
    while (srcScan < tagLower.length) {
      const sIdx = tagLower.indexOf("src=", srcScan);
      if (sIdx < 0) break;
      const beforeWs = isAsciiWhitespaceCode(tagLower.charCodeAt(sIdx - 1));
      const q = tag[sIdx + 4];
      if (beforeWs && (q === '"' || q === "'")) {
        const closeQ = tag.indexOf(q, sIdx + 5);
        if (closeQ > sIdx + 5 && tag.startsWith("modelica://", sIdx + 5)) {
          srcAttrStart = sIdx;
          srcValStart = sIdx + 5;
          srcValEnd = closeQ;
          break;
        }
      }
      srcScan = sIdx + 4;
    }

    out += stripped.slice(pos, imgStart);
    if (srcAttrStart < 0) {
      out += tag;
    } else {
      const fullUri = tag.slice(srcValStart, srcValEnd);
      const resolvedPath = context.resolveURI(fullUri);
      let replacement: string | null = null;
      if (resolvedPath) {
        try {
          const binary = context.fs.readBinary(resolvedPath);
          const chunks: string[] = [];
          const chunkSize = 8192;
          for (let i = 0; i < binary.length; i += chunkSize) {
            chunks.push(String.fromCharCode(...binary.subarray(i, i + chunkSize)));
          }
          const base64 = btoa(chunks.join(""));
          const ext = context.fs.extname(resolvedPath).toLowerCase().substring(1);
          const mimeType = ext === "svg" ? "image/svg+xml" : `image/${ext}`;
          replacement = tag.slice(0, srcValStart) + `data:${mimeType};base64,${base64}` + tag.slice(srcValEnd);
        } catch (e) {
          console.warn(`Failed to read image ${fullUri}:`, e);
        }
      }
      if (replacement !== null) {
        out += replacement;
      } else {
        out += tag.slice(0, srcAttrStart) + 'style="display:none"' + tag.slice(srcValEnd + 1);
      }
    }
    pos = tagEnd + 1;
  }

  return out;
}

function extractFirstQuotedString(text?: string): string | undefined {
  if (!text) return undefined;
  const start = text.indexOf('"');
  if (start === -1) return undefined;
  let end = start + 1;
  const len = text.length;
  while (end < len) {
    if (text[end] === "\\") {
      end += 2;
    } else if (text[end] === '"') {
      return text.slice(start + 1, end);
    } else {
      end++;
    }
  }
  return undefined;
}

export function buildComponentProperties(
  classInstance: ModelicaClassInstance,
  componentName: string,
): ComponentPropertyData | null {
  const component = classInstance?.components?.find((c: any) => c.name === componentName);
  if (!component) return null;

  const componentClassInstance = component.classInstance;
  if (!componentClassInstance) return null;

  const evaluator = new AnnotationEvaluator(componentClassInstance);

  // Extract parameters and build structured tabs & groups
  const parameters: ComponentPropertyData["parameters"] = [];
  const tabMap = new Map<string, Map<string, PropertyFieldConfig[]>>();
  const values: Record<string, any> = {
    name: component.name ?? "",
    description: component["description"] ?? "",
  };

  const getOrCreateGroup = (tabName: string, groupName: string): PropertyFieldConfig[] => {
    if (!tabMap.has(tabName)) {
      tabMap.set(tabName, new Map());
    }
    const groups = tabMap.get(tabName)!;
    if (!groups.has(groupName)) {
      groups.set(groupName, []);
    }
    return groups.get(groupName)!;
  };

  // Collect candidate elements across elements (tests), inherited components, and direct components
  const candidateElements: any[] = [];
  const visitedNames = new Set<string>();

  if (Array.isArray(componentClassInstance["elements"])) {
    for (const el of componentClassInstance["elements"]) {
      if (el && el.name && !visitedNames.has(el.name)) {
        visitedNames.add(el.name);
        candidateElements.push(el);
      }
    }
  }

  const inheritedComponents = collectAllComponents(componentClassInstance);
  for (const comp of inheritedComponents) {
    if (comp && comp.name && !visitedNames.has(comp.name)) {
      visitedNames.add(comp.name);
      candidateElements.push(comp);
    }
  }

  if (Array.isArray(componentClassInstance.components)) {
    for (const comp of componentClassInstance.components) {
      if (comp && comp.name && !visitedNames.has(comp.name)) {
        visitedNames.add(comp.name);
        candidateElements.push(comp);
      }
    }
  }

  for (const element of candidateElements) {
    const isComp =
      element.isComponentInstance === true ||
      element.kind === "Component" ||
      element.declaration?.kind === "Component" ||
      element.kind === "Variable" ||
      element.declaration?.kind === "Variable";

    let variability = element.variability;
    if (!variability && element.declaration?.metadata?.variability) {
      variability = element.declaration.metadata.variability;
    }
    if (!variability && element.declaration?.id != null && componentClassInstance.db?.query) {
      try {
        variability = componentClassInstance.db.query("variability", element.declaration.id);
      } catch {}
    }
    if (!variability) {
      let node = element.cstNode ?? element.abstractSyntaxNode;
      let p = node?.parent;
      while (p && !variability) {
        if (Cst.ComponentClause.is(p)) {
          const tp =
            (Cst.ComponentClause.is(p) ? Cst.ComponentClause.typePrefix(p) : null) ??
            p.children?.find((c: any) => Cst.TypePrefix.is(c));
          if (tp?.text?.includes("parameter")) variability = ModelicaVariability.PARAMETER;
          else if (tp?.text?.includes("constant")) variability = ModelicaVariability.CONSTANT;
          break;
        }
        p = p.parent;
      }
      if (!variability) {
        const text = node?.parent?.text || node?.text || "";
        const cleanText = stripCommentsAndStrings(text);
        if (containsWholeWordOutsideStrings(cleanText, "parameter")) {
          variability = ModelicaVariability.PARAMETER;
        }
      }
    }

    const isParameter = variability === ModelicaVariability.PARAMETER || variability === "parameter";

    if (isComp && isParameter) {
      // 1. Caller override (e.g. R(R = 100))
      let value: string | undefined = undefined;
      const compArgExpr = (component["modification"] as any)?.getModificationArgument?.(element.name ?? "")?.expression;
      if (compArgExpr != null) {
        value = formatPropertyValue(compArgExpr);
      }
      if (!value) {
        const compCst = (component as any)?.cstNode ?? (component as any)?.abstractSyntaxNode;
        value = extractCstModifierValue(compCst, element.name ?? "");
      }
      if (!value && component["cstNode"]) {
        const compCstText = stripAnnotationsAndComments(component["cstNode"].text ?? "");
        const extracted = extractNamedModAssignmentFallback(compCstText, element.name ?? "", true);
        if (extracted) {
          value = extracted;
        }
      }

      // 2. Element's own default or start attribute
      if (!value) {
        const elemExpr = (element.modification as any)?.expression;
        if (elemExpr != null) {
          value = formatPropertyValue(elemExpr);
        }
      }
      if (!value) {
        const elemStartMod = (element.modification as any)?.getModificationArgument?.("start")?.expression;
        if (elemStartMod != null) {
          value = formatPropertyValue(elemStartMod);
        }
      }
      if (!value) {
        const elemCst = (element as any)?.cstNode ?? (element as any)?.abstractSyntaxNode;
        value = extractCstModifierValue(elemCst, "start") ?? extractCstModifierValue(elemCst, element.name ?? "");
      }
      if (!value && element.cstNode) {
        const valModNode = (element.cstNode.children || []).find(
          (c: any) => Cst.Modification.is(c) || c.type === "modification",
        );
        if (valModNode) {
          const modText = valModNode.text?.trim();
          if (modText?.startsWith("=")) {
            value = stripLeadingEqualsAndTrailingSemi(modText);
          }
        }
        if (!value) {
          const elemText = stripAnnotationsAndComments(element.cstNode.text ?? "");
          const startExtracted = extractNamedModAssignmentFallback(elemText, "start", false);
          if (startExtracted) {
            value = startExtracted;
          } else {
            const assignVal = readValueAfterEqualsExcluding(elemText, ';"\n');
            if (assignVal) {
              value = assignVal;
            }
          }
        }
      }
      if (!value) {
        const metaDefault =
          element.declaration?.metadata?.defaultValue ?? (element as { defaultValue?: unknown }).defaultValue;
        if (metaDefault !== undefined && metaDefault !== null && String(metaDefault) !== "") {
          value = String(metaDefault);
        }
      }
      if (!value) {
        value = "-";
      }

      // Unit
      const unit = resolveElementUnit(element);

      // Description
      let elemDescription = element.description;
      if (!elemDescription && element.declaration?.metadata?.description) {
        elemDescription = element.declaration.metadata.description;
      }
      if (!elemDescription && element.cstNode?.text) {
        elemDescription = extractFirstQuotedString(element.cstNode.text);
      }
      if (elemDescription) {
        elemDescription = stripQuotes(elemDescription);
      }

      const isBoolean =
        element.classInstance?.name === "Boolean" ||
        element.declaration?.metadata?.typeSpecifier === "Boolean" ||
        value === "true" ||
        value === "false";

      // Extract Dialog(...) annotation
      let dialogAnn: any = null;
      if (typeof element.annotation === "function") {
        try {
          dialogAnn = element.annotation("Dialog");
        } catch {
          // ignore
        }
      }
      const compCst =
        element.cstNode ??
        element.abstractSyntaxNode ??
        (element.id && (element as any).db?.cstNode ? (element as any).db.cstNode(element.id) : null);
      if (!dialogAnn && compCst) {
        try {
          dialogAnn = evaluator.evaluate(compCst, "Dialog");
        } catch {
          // ignore
        }
      }

      const tabName =
        dialogAnn && typeof dialogAnn === "object" && typeof dialogAnn.tab === "string" ? dialogAnn.tab : "General";
      const groupName =
        dialogAnn && typeof dialogAnn === "object" && typeof dialogAnn.group === "string"
          ? dialogAnn.group
          : "Parameters";
      const enableCondition =
        dialogAnn && typeof dialogAnn === "object" && dialogAnn.enable !== undefined
          ? String(dialogAnn.enable)
          : undefined;

      // Extract choices/enumeration or choices(...) annotation
      let choices: string[] | undefined = undefined;
      const enumLits = element.classInstance?.enumLiterals;
      if (Array.isArray(enumLits) && enumLits.length > 0) {
        choices = enumLits.map((lit: any) => lit.name ?? String(lit));
      }

      let choicesAnn: any = null;
      if (typeof element.annotation === "function") {
        try {
          choicesAnn = element.annotation("choices");
        } catch {
          // ignore
        }
      }
      if (!choicesAnn && compCst) {
        try {
          choicesAnn = evaluator.evaluate(compCst, "choices");
        } catch {
          // ignore
        }
      }
      if (choicesAnn && typeof choicesAnn === "object") {
        const rawChoices = choicesAnn.choice || choicesAnn.choices;
        if (Array.isArray(rawChoices)) {
          choices = rawChoices.map((c: any) =>
            typeof c === "object" && c !== null ? String(c.value ?? c.name ?? c) : String(c),
          );
        } else if (rawChoices !== undefined) {
          choices = [String(rawChoices)];
        }
      }

      if (!choices) {
        const typeSpec = element.declaration?.metadata?.typeSpecifier ?? element.classInstance?.name ?? "";
        if (
          typeSpec.endsWith("Blocks.Types.Init") ||
          (typeSpec.endsWith(".Init") && element.name === "initType") ||
          (typeSpec === "Init" && element.name === "initType")
        ) {
          choices = [
            "Modelica.Blocks.Types.Init.NoInit",
            "Modelica.Blocks.Types.Init.SteadyState",
            "Modelica.Blocks.Types.Init.InitialState",
            "Modelica.Blocks.Types.Init.InitialOutput",
          ];
        } else if (typeSpec.endsWith("Blocks.Types.InitPID")) {
          choices = [
            "Modelica.Blocks.Types.InitPID.NoInit",
            "Modelica.Blocks.Types.InitPID.SteadyState",
            "Modelica.Blocks.Types.InitPID.InitialState",
            "Modelica.Blocks.Types.InitPID.InitialOutput",
            "Modelica.Blocks.Types.InitPID.DoNotUse_InitialIntegratorState",
          ];
        }
      }

      let kind: PropertyFieldConfig["kind"] = "expression";
      if (dialogAnn && typeof dialogAnn === "object" && dialogAnn.colorSelector) {
        kind = "color";
      } else if (dialogAnn && typeof dialogAnn === "object" && (dialogAnn.loadSelector || dialogAnn.saveSelector)) {
        kind = "filePicker";
      } else if (isBoolean) {
        kind = "boolean";
      } else if (choices && choices.length > 0) {
        kind = "choice";
      } else if (unit) {
        kind = "quantity";
      }

      parameters.push({
        name: element.name ?? "",
        value,
        description: elemDescription ?? undefined,
        isBoolean,
        unit,
        tab: tabName,
        group: groupName,
        enable: enableCondition,
      });

      values[element.name ?? ""] = value;

      const fieldConfig: PropertyFieldConfig = {
        key: element.name ?? "",
        label: element.name ?? "",
        kind,
        description: elemDescription ?? undefined,
        defaultValue: value,
        unit,
        choices,
        enabledIf: enableCondition,
      };

      getOrCreateGroup(tabName, groupName).push(fieldConfig);

      if (dialogAnn && typeof dialogAnn === "object" && dialogAnn.showStartAttribute) {
        const startMod =
          (element.classInstance?.modification as any)?.getModificationArgument?.("start") ??
          (element.modification as any)?.getModificationArgument?.("start");
        const compStartArg = (component["modification"] as any)
          ?.getModificationArgument?.(element.name ?? "")
          ?.classModification?.getModificationArgument?.("start");
        let startVal = formatPropertyValue(compStartArg?.expression) ?? formatPropertyValue(startMod?.expression);

        if (!startVal) {
          const compCst = (component as any)?.cstNode ?? (component as any)?.abstractSyntaxNode;
          const nestedStart = extractCstNestedModifierValue(compCst, element.name ?? "", "start");
          if (nestedStart) {
            startVal = nestedStart;
          } else {
            const elemCst = (element as any)?.cstNode ?? (element as any)?.abstractSyntaxNode;
            const elemStart = extractCstModifierValue(elemCst, "start");
            if (elemStart) {
              startVal = elemStart;
            }
          }
        }
        if (!startVal) {
          startVal = "-";
        }
        const startKey = `${element.name}.start`;
        values[startKey] = startVal;
        getOrCreateGroup(tabName, groupName).push({
          key: startKey,
          label: `${element.name}.start`,
          kind: unit ? "quantity" : "expression",
          description: `Start attribute for ${element.name}`,
          defaultValue: startVal,
          unit,
          enabledIf: enableCondition,
        });
      }
    }
  }

  // Extract documentation
  const docAnnotation =
    typeof componentClassInstance.annotation === "function"
      ? (componentClassInstance.annotation("Documentation") as {
          info?: string | undefined;
          revisions?: string | undefined;
        } | null)
      : null;

  const context = (classInstance as any).context;
  const docInfo = processHtml(docAnnotation?.info, context);
  const docRevisions = processHtml(docAnnotation?.revisions, context);
  if (docInfo) values["docInfo"] = docInfo;
  if (docRevisions) values["docRevisions"] = docRevisions;

  // Render icon SVG
  const iconSvg = getClassIconSvg(componentClassInstance, 80, true, component);

  // Assemble tabs
  const tabs: PropertyTabConfig[] = [];
  for (const [tabId, groupsMap] of tabMap.entries()) {
    const groups: PropertyGroupConfig[] = [];
    for (const [groupId, fields] of groupsMap.entries()) {
      groups.push({
        id: toDashedSlugId(groupId),
        label: groupId,
        fields,
      });
    }
    tabs.push({
      id: toDashedSlugId(tabId),
      label: tabId,
      groups,
    });
  }

  if (docInfo || docRevisions) {
    const docGroups: PropertyGroupConfig[] = [];
    if (docInfo) {
      docGroups.push({
        id: "info",
        label: "Information",
        fields: [
          {
            key: "docInfo",
            label: "Information",
            kind: "html",
            defaultValue: docInfo,
            readOnly: true,
          },
        ],
      });
    }
    if (docRevisions) {
      docGroups.push({
        id: "revisions",
        label: "Revisions",
        fields: [
          {
            key: "docRevisions",
            label: "Revisions",
            kind: "html",
            defaultValue: docRevisions,
            readOnly: true,
          },
        ],
      });
    }
    tabs.push({
      id: "documentation",
      label: "Documentation",
      groups: docGroups,
    });
  }

  const schema: EntityPropertySchema = {
    title: `${component.name ?? ""} : ${componentClassInstance.name ?? ""}`,
    icon: iconSvg,
    tabs,
  };

  return {
    classKind: componentClassInstance["classKind"],
    className: (componentClassInstance["compositeName"] as string | undefined) || componentClassInstance.name || "",
    name: component.name ?? "",
    description: component["description"] ?? "",
    parameters,
    docInfo,
    docRevisions,
    iconSvg,
    schema,
    values,
  };
}

/**
 * Renders the Diagram view of a Modelica class as a pure DOM-free SVG string.
 * Safe for headless LSP workers, CLI tools, and servers.
 */
export function renderDiagramSvg(
  classInstance: ModelicaClassInstance,
  precomputedBackground?: X6Markup | null,
): string {
  const bg = precomputedBackground !== undefined ? precomputedBackground : renderDiagramX6(classInstance);
  if (!bg) return "";
  return x6MarkupToSvg(bg);
}
