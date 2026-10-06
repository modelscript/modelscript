// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Server-side diagram data builder for the VS Code webview.
// Mirrors morsel's renderDiagram() + x6.ts but produces serializable JSON
// that the webview can feed to an X6 Graph.
/* eslint-disable @typescript-eslint/no-explicit-any */

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
import { ModelicaClassKind, ModelicaVariability } from "../types.js";

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

import type {
  ComponentPropertyData,
  DiagramData,
  DiagramEdge,
  DiagramNode,
  DiagramPort,
  EntityPropertySchema,
  PropertyFieldConfig,
  PropertyGroupConfig,
  PropertyTabConfig,
  X6Markup,
} from "@modelscript/diagram/protocol";
import { AnnotationEvaluator } from "./annotation-evaluator.js";

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
  if (ci.connectEquations) {
    result.push(...ci.connectEquations);
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
      compTypeName = (comp?.typeName || comp?.className || comp?.name || "").toLowerCase();
    }
    const combined = `${port} ${compTypeName}`;

    if (combined.includes("heat") || combined.includes("thermal") || port === "port_a" || port === "port_b") {
      if (
        combined.includes("thermal") ||
        combined.includes("heat") ||
        compTypeName.includes("thermal") ||
        compTypeName.includes("heat")
      ) {
        return MSL_DOMAIN_COLORS.thermal;
      }
    }
    if (port.includes("heat") || port.includes("thermal")) {
      return MSL_DOMAIN_COLORS.thermal;
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
        return MSL_DOMAIN_COLORS.translational;
      }
      return MSL_DOMAIN_COLORS.rotational;
    }
    if (port.includes("translat")) {
      return MSL_DOMAIN_COLORS.translational;
    }
    if (port.includes("fluid") || port.includes("flow") || port.includes("inlet") || port.includes("outlet")) {
      return MSL_DOMAIN_COLORS.fluid;
    }
    if (port.includes("mag") || port.includes("flux")) {
      return MSL_DOMAIN_COLORS.magnetic;
    }
    if (port.includes("bool") || port.includes("boolean")) {
      return MSL_DOMAIN_COLORS.control;
    }
    if (port.includes("pin") || port === "p" || port === "n" || port.includes("plug") || port.includes("terminal")) {
      return MSL_DOMAIN_COLORS.electrical;
    }
    return null;
  };

  const c1 = checkStr(source);
  if (c1) return c1;
  if (target) {
    const c2 = checkStr(target);
    if (c2) return c2;
  }
  return MSL_DOMAIN_COLORS.default;
}

export async function buildDiagramData(classInstance: ModelicaClassInstance): Promise<DiagramData> {
  const nodes: DiagramNode[] = [];
  const edges: DiagramEdge[] = [];

  const t0 = performance.now();
  let tIconRender = 0;
  let tPortRender = 0;
  let tCondition = 0;
  let tPlacement = 0;
  let componentCount = 0;

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
  const connectEquations = classInstance ? collectAllConnectEquations(classInstance) : [];

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
    const tc0 = performance.now();
    const condition = evaluateCondition(component, classInstance);
    tCondition += performance.now() - tc0;
    if (condition === false) continue;

    const componentClassInstance = component.classInstance;
    const isUnresolved = !componentClassInstance;
    componentCount++;

    const tp0 = performance.now();
    let componentTransform = computeIconPlacement(component);
    const placement = typeof component?.annotation === "function" ? component.annotation("Placement") : null;
    if (!componentTransform && placement && !placement.iconTransformation) {
      const icon =
        typeof component.classInstance?.annotation === "function"
          ? (component.classInstance.annotation("Icon") as IIcon)
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
      const isRealClass = Boolean(
        (classInstance as any)?.context ||
        (classInstance as any)?.entry?.resourceId ||
        (classInstance as any)?.db?.cstNode,
      );
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
    tPlacement += performance.now() - tp0;

    const absScaleX = Math.abs(componentTransform.scaleX);
    const absScaleY = Math.abs(componentTransform.scaleY);
    const absWidth = Math.abs(componentTransform.width);
    const absHeight = Math.abs(componentTransform.height);
    const flipX = componentTransform.scaleX < 0;
    const flipY = componentTransform.scaleY < 0;

    const ti0 = performance.now();
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
            },
            children: component.name ?? "?",
          },
        ],
      };
    } else {
      componentMarkup = renderIconX6(componentClassInstance, component, false);
    }
    tIconRender += performance.now() - ti0;

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

    // Multi-instance array cascading stacked icons (e.g. Resistor R[5])
    const isArrayComponent =
      (component.dimensions && component.dimensions.length > 0) ||
      (Array.isArray(component.arraySubscripts) && component.arraySubscripts.length > 0) ||
      /\[\s*\d+\s*\]$/.test(component.name ?? "");
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

    // Build ports
    const ports: DiagramPort[] = [];
    const tpr0 = performance.now();
    if (isUnresolved) {
      const referencedPorts = new Set<string>();
      for (const eq of connectEquations) {
        const p1 =
          eq.lhs ?? eq.componentReference1?.parts?.map((c: any) => c.identifier?.text ?? c.text ?? "").join(".");
        const p2 =
          eq.rhs ?? eq.componentReference2?.parts?.map((c: any) => c.identifier?.text ?? c.text ?? "").join(".");
        if (typeof p1 === "string" && p1.startsWith(`${component.name}.`)) {
          referencedPorts.add(p1.substring(component.name.length + 1).split(".")[0]);
        }
        if (typeof p2 === "string" && p2.startsWith(`${component.name}.`)) {
          referencedPorts.add(p2.substring(component.name.length + 1).split(".")[0]);
        }
      }
      if (referencedPorts.size === 0) {
        referencedPorts.add("p");
        referencedPorts.add("n");
      }
      let idx = 0;
      for (const portName of referencedPorts) {
        const portX = idx % 2 === 0 ? 0 : absWidth;
        const portY = absHeight / 2;
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
              fill: "#ef4444",
              magnet: "true",
            },
          },
        });
        idx++;
      }
    } else {
      for (const connector of collectAllComponents(componentClassInstance)) {
        const connectorCondition = evaluateCondition(connector, component);
        if (connectorCondition === false) continue;

        const connectorClassInstance = connector.classInstance;
        if (
          !connectorClassInstance ||
          (connectorClassInstance.classKind !== ModelicaClassKind.CONNECTOR &&
            connectorClassInstance.classKind !== ModelicaClassKind.EXPANDABLE_CONNECTOR &&
            connectorClassInstance.classKind !== undefined)
        )
          continue;
        const connectorTransform = computePortPlacement(connector);
        if (!connectorTransform) continue;

        let connectorMarkup = renderIconX6(connectorClassInstance);
        if (flipX || flipY) {
          const psx = flipX ? -1 : 1;
          const psy = flipY ? -1 : 1;
          const ptx = flipX ? connectorTransform.width * absScaleX : 0;
          const pty = flipY ? connectorTransform.height * absScaleY : 0;
          connectorMarkup = {
            tagName: "g",
            attrs: { transform: `translate(${ptx}, ${pty}) scale(${psx}, ${psy})` },
            children: [connectorMarkup],
          };
        }

        const a = connectorTransform.rotate * (Math.PI / 180);
        const extCenterOffX = connectorTransform.translateX - connectorTransform.originX + connectorTransform.width / 2;
        const extCenterOffY =
          connectorTransform.translateY - connectorTransform.originY + connectorTransform.height / 2;
        const connCenterX = connectorTransform.originX + extCenterOffX * Math.cos(a) - extCenterOffY * Math.sin(a);
        const connCenterY = connectorTransform.originY + extCenterOffX * Math.sin(a) + extCenterOffY * Math.cos(a);
        const portWidth = connectorTransform.width * absScaleX;
        const portHeight = connectorTransform.height * absScaleY;
        const desiredCenterX = absWidth / 2 + connCenterX * componentTransform.scaleX;
        const desiredCenterY = absHeight / 2 + connCenterY * componentTransform.scaleY;
        const portX = desiredCenterX - portWidth / 2;
        const portY = desiredCenterY - portHeight / 2;

        ports.push({
          id: connector.name ?? "",
          group: "absolute",
          args: { x: portX, y: portY, angle: connectorTransform.rotate },
          markup: {
            tagName: "svg",
            children: [connectorMarkup],
            attrs: {
              magnet: "true",
              width: connectorTransform.width * absScaleX,
              height: connectorTransform.height * absScaleY,
              style: `overflow: visible${connectorCondition === undefined ? "; opacity: 0.5" : ""}`,
            },
          },
        });
      }
    }
    tPortRender += performance.now() - tpr0;

    const a = componentTransform.rotate * (Math.PI / 180);
    const relTranslateX = absWidth / 2 + componentTransform.translateX - componentTransform.originX;
    const relTranslateY = absHeight / 2 + componentTransform.translateY - componentTransform.originY;

    // Lightweight property metadata — expensive fields (parameters, docInfo,
    // docRevisions, iconSvg) are deferred to buildComponentProperties() and
    // loaded on-demand when the user clicks a node.
    const properties: ComponentPropertyData = {
      classKind: componentClassInstance?.classKind ?? "unknown",
      className: componentClassInstance?.name ?? (component as any).typeName ?? "Unknown",
      name: component.name ?? "",
      description: component.description ?? (isUnresolved ? "Unresolved component type" : ""),
      parameters: [],
    };

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

  const tComponents = performance.now() - t0;
  console.log(
    `[diagram-perf] ${componentCount} components in ${tComponents.toFixed(0)}ms ` +
      `(condition=${tCondition.toFixed(0)}ms placement=${tPlacement.toFixed(0)}ms ` +
      `iconRender=${tIconRender.toFixed(0)}ms portRender=${tPortRender.toFixed(0)}ms)`,
  );

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
    edges.push({
      id: `${c1.join(".")}-${c2.join(".")}`,
      zIndex: 1,
      source: {
        cell: c1.length > 1 ? baseC1 : "",
        port: c1.length > 1 ? (c1[1] ?? "") : c1[0],
        anchor: "center",
        connectionPoint: { name: "anchor" },
      },
      target: {
        cell: c2.length > 1 ? baseC2 : "",
        port: c2.length > 1 ? (c2[1] ?? "") : c2[0],
        anchor: "center",
        connectionPoint: { name: "anchor" },
      },
      vertices: line?.points
        ?.slice(1, -1)
        ?.map((p: IPoint) => convertPoint(p))
        .map((p: [number, number]) => ({ x: p[0], y: p[1] })),
      router: hasExplicitBends ? undefined : { name: "port-orthogonal-astar" },
      connector: line?.smooth === Smooth.BEZIER ? "smooth" : undefined,
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

  // Coordinate system
  const diagram: IDiagram | null =
    typeof classInstance?.annotation === "function" ? classInstance.annotation("Diagram") : null;
  const ext0 = diagram?.coordinateSystem?.extent?.[0] ?? [-100, -100];
  const ext1 = diagram?.coordinateSystem?.extent?.[1] ?? [100, 100];
  const bgWidth = computeWidth(diagram?.coordinateSystem?.extent);
  const bgHeight = computeHeight(diagram?.coordinateSystem?.extent);
  const csX = Math.min(ext0[0], ext1[0]);
  const csY = -Math.max(ext0[1], ext1[1]);

  // Diagram background graphics
  let diagramBackground: X6Markup | null = null;
  if (diagram) {
    diagramBackground = renderDiagramX6(classInstance);
  }

  return {
    nodes,
    edges,
    coordinateSystem: { x: csX, y: csY, width: bgWidth, height: bgHeight },
    diagramBackground,
  };
}

// ── X6 Markup rendering (ported from morsel's x6.ts, DOM-free) ──

function renderDiagramX6(classInstance: ModelicaClassInstance): X6Markup | null {
  const defs: X6Markup[] = [];
  const graphicItems: X6Markup[] = [];

  function collectGraphics(ci: ModelicaClassInstance) {
    const extendsList = ci?.extendsClassInstances ?? [];
    for (const extendsClassInstance of extendsList) {
      if (extendsClassInstance?.classInstance) {
        collectGraphics(extendsClassInstance.classInstance);
      }
    }
    const diagram: IDiagram | null = typeof ci?.annotation === "function" ? ci.annotation("Diagram", ci) : null;
    if (diagram?.graphics) {
      for (const graphicItem of diagram.graphics) {
        graphicItems.push(renderGraphicItemX6(graphicItem, defs, ci));
      }
    }
  }

  collectGraphics(classInstance);
  if (graphicItems.length === 0 && defs.length === 0) return null;

  const diagram: IDiagram | null =
    typeof classInstance?.annotation === "function" ? classInstance.annotation("Diagram", classInstance) : null;
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

/** Clear the cached icon markup. Call when MSL finishes loading or the model changes. */
export function clearIconCache() {
  iconCache.clear();
}

export function renderIconX6(
  classInstance: ModelicaClassInstance,
  componentInstance?: ModelicaComponentInstance,
  ports?: boolean,
  defs?: X6Markup[],
): X6Markup {
  const isRoot = !defs;
  const localDefs = defs ?? [];
  const isTopLevel = !ports;
  let modKey = "";
  if (componentInstance) {
    if (componentInstance.name) modKey += `|${componentInstance.name}`;
    if (componentInstance.modification) {
      try {
        modKey += `|${JSON.stringify(componentInstance.modification)}`;
      } catch {
        modKey += `|${String(componentInstance.modification)}`;
      }
    }
  }
  const identityKey =
    classInstance.id !== undefined
      ? `id:${classInstance.id}`
      : ((classInstance as any).fullName ??
        (classInstance as any).entry?.fullName ??
        (classInstance as any).entry?.name ??
        classInstance.name);
  const cacheKey = isTopLevel && identityKey ? `${identityKey}${modKey}` : null;
  const canCache = Boolean(cacheKey);

  if (canCache && cacheKey) {
    const cached = iconCache.get(cacheKey);
    if (cached) {
      if (cached.defs && cached.defs.length > 0) {
        localDefs.push(...cached.defs);
      }
      // Return a clone to avoid mutating the cached SVG if it gets modified later
      return structuredClone(cached.svg);
    }
  }

  const defsStartLength = localDefs.length;
  const svg: X6Markup = {
    tagName: "svg",
    attrs: { width: "100%", height: "100%", style: "overflow: visible" },
    children: [],
  };

  const extendsList = classInstance.extendsClassInstances ?? [];
  const hasExtends = extendsList.some((e: any) => e.classInstance);
  for (const extendsClassInstance of extendsList) {
    if (extendsClassInstance.classInstance && svg.children) {
      svg.children.push(renderIconX6(extendsClassInstance.classInstance, componentInstance, ports, localDefs));
    }
  }

  const hasAnnotationFn = typeof classInstance.annotation === "function";
  const ownIcon: IIcon | null = hasExtends
    ? hasAnnotationFn
      ? classInstance.annotation("Icon", {
          ...(typeof componentInstance === "object" ? componentInstance : {}),
          ownOnly: true,
        })
      : null
    : hasAnnotationFn
      ? classInstance.annotation("Icon", componentInstance)
      : null;
  const icon: IIcon | null =
    ownIcon ?? (hasExtends || !hasAnnotationFn ? null : classInstance.annotation("Icon", componentInstance));
  const coordSys =
    ownIcon?.coordinateSystem ??
    (hasAnnotationFn ? classInstance.annotation("Icon", componentInstance)?.coordinateSystem : null);

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
      group.children.push(renderGraphicItemX6(graphicItem, localDefs, classInstance, componentInstance));
    }
  }

  if (ports && group.children) {
    for (const component of classInstance?.components ?? []) {
      const condition = evaluateCondition(component, componentInstance);
      if (condition === false) continue;

      const connectorClassInstance = component.classInstance;
      if (
        !connectorClassInstance ||
        (connectorClassInstance.classKind !== ModelicaClassKind.CONNECTOR &&
          connectorClassInstance.classKind !== ModelicaClassKind.EXPANDABLE_CONNECTOR &&
          connectorClassInstance.classKind !== undefined)
      )
        continue;

      const connectorSvg = renderIconX6(connectorClassInstance, undefined, false, localDefs);
      if (connectorSvg) {
        const attrs = connectorSvg.attrs ?? {};
        connectorSvg.attrs = attrs;
        if (condition === undefined) attrs["opacity"] = 0.5;

        const transform = computePortPlacement(component);
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
      shape = renderTextX6(graphicItem as IText, classInstance, componentInstance);
      break;
    default:
      return { tagName: "g", children: [] };
  }
  const [ox, oy] = convertPoint(graphicItem.origin, [0, 0]);
  const visibility = (graphicItem.visible ?? true) ? "visible" : "hidden";

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
      href,
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
        attrs: { points: graphicItem.points?.map((p: IPoint) => convertPoint(p, [0, 0]) ?? []).join(" ") },
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
      attrs: { points: graphicItem.points?.map((p: IPoint) => convertPoint(p, [0, 0]) ?? []).join(" ") },
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

  const rawRadius = graphicItem.radius ?? (graphicItem as { cornerRadius?: number }).cornerRadius ?? 0;
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
        const lhs = stripQuotes(evaluateMacroExpression(parts[0], classInstance, componentInstance));
        const rhs = stripQuotes(evaluateMacroExpression(parts[1], classInstance, componentInstance));
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
  if (Cst.Argument.is(node)) {
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
  if (Cst.ElementModification.is(node)) return node;
  for (const ch of node.children || []) {
    const found = findElemModInCst(ch);
    if (found) return found;
  }
  return null;
}

function findNameInCst(node: any): any {
  if (!node) return null;
  if (Cst.Identifier.is(node)) return node;
  for (const ch of node.children || []) {
    const found = findNameInCst(ch);
    if (found) return found;
  }
  return null;
}

function findClassModInCst(node: any): any {
  if (!node) return null;
  if (Cst.ClassModification.is(node)) return node;
  for (const ch of node.children || []) {
    const found = findClassModInCst(ch);
    if (found) return found;
  }
  return null;
}

export function extractCstModifierValue(cstNode: any, paramName: string): string | undefined {
  if (!cstNode) return undefined;
  const args = findArgsInCst(cstNode);
  for (const arg of args) {
    const elemMod = findElemModInCst(arg);
    if (!elemMod) continue;

    const nameNode =
      (Cst.ElementModification.is(elemMod) ? Cst.ElementModification.name(elemMod) : null) ?? findNameInCst(elemMod);
    if (nameNode && nameNode.text?.trim() === paramName) {
      const valModNode =
        (Cst.ElementModification.is(elemMod) ? Cst.ElementModification.modification(elemMod) : null) ??
        (elemMod.children || []).find((c: any) => Cst.Modification.is(c));
      if (valModNode) {
        const text = valModNode.text?.trim();
        if (text?.startsWith("=")) {
          return text.replace(/^=\s*/, "").trim();
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
  if (!cstNode) return undefined;
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

export function evaluateMacroExpression(
  expr: string,
  classInstance?: ModelicaClassInstance,
  componentInstance?: ModelicaComponentInstance,
): string {
  const trimmed = expr.trim();
  if (/^if\b/i.test(trimmed)) {
    const thenMatch = trimmed.match(/\bthen\b/i);
    if (thenMatch && thenMatch.index !== undefined) {
      const thenIdx = thenMatch.index;
      const afterThen = trimmed.slice(thenIdx + 4);
      const elseMatch = afterThen.match(/\belse\b/i);
      if (elseMatch && elseMatch.index !== undefined) {
        const condStr = trimmed.slice(2, thenIdx).trim();
        const thenVal = afterThen.slice(0, elseMatch.index).trim();
        const elseVal = afterThen.slice(elseMatch.index + 4).trim();

        const isTrue = evalMacroCondition(condStr, classInstance, componentInstance);
        const chosen = isTrue ? thenVal : elseVal;
        return stripQuotes(evaluateMacroExpression(chosen, classInstance, componentInstance));
      }
    }
  }

  const name = trimmed.startsWith("%") ? trimmed.slice(1) : trimmed;
  // 1. Check if the specific component instance overrides this parameter
  const compArgExpr = (componentInstance?.modification as any)?.getModificationArgument?.(name)?.expression;
  let compVal = formatPropertyValue(compArgExpr);
  if (!compVal) {
    const compCst = (componentInstance as any)?.cstNode ?? (componentInstance as any)?.abstractSyntaxNode;
    compVal = extractCstModifierValue(compCst, name);
  }

  const namedElement =
    typeof classInstance?.resolveName === "function" ? classInstance.resolveName(name.split(".")) : null;

  // 2. Check if the class provides a default value for this parameter
  const elemMod = (namedElement as any)?.modification;
  const elemExpr = elemMod?.expression ?? elemMod?.getModificationArgument?.("start")?.expression;
  const elemVal = formatPropertyValue(elemExpr) ?? formatPropertyValue((namedElement as any)?.value);

  const finalVal = compVal ?? elemVal;

  let unitString = "";
  if (namedElement && "classInstance" in namedElement) {
    const mod = (namedElement as ModelicaComponentInstance).classInstance?.modification as any;
    const unitExpr = mod?.getModificationArgument?.("unit")?.expression;
    const rawUnit = formatPropertyValue(unitExpr)?.replace(/^"|"$/g, "");
    if (rawUnit) unitString = " " + formatUnit(rawUnit);
  }

  if (finalVal !== undefined && finalVal !== "") {
    return finalVal + unitString;
  }

  if ((name.startsWith('"') && name.endsWith('"')) || (name.startsWith("'") && name.endsWith("'"))) {
    return name.slice(1, -1);
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
): X6Markup {
  const [x1, y1] = convertPoint(graphicItem?.extent?.[0], [0, 0]);
  const [x2, y2] = convertPoint(graphicItem?.extent?.[1], [0, 0]);
  const x = Math.min(x1, x2);
  const y = Math.min(y1, y2);
  const width = computeWidth(graphicItem.extent);
  const height = computeHeight(graphicItem.extent);

  // Text substitution — matches core svg.ts renderText() with advanced conditional macro evaluation
  const rawText = graphicItem.string ?? (graphicItem as any).textString ?? "";
  const replacer = (_match: string, expr: string): string => {
    return evaluateMacroExpression(expr, classInstance, componentInstance);
  };
  const ESCAPED_PERCENT = "__PERCENT__";
  const nameText = componentInstance?.name ?? classInstance?.name ?? "";
  const classText = classInstance?.name ?? "";
  const commentText = componentInstance?.description ?? classInstance?.description ?? "";
  const textContent = rawText
    .replace(/%%/g, ESCAPED_PERCENT)
    .replace(/%name\b/g, nameText)
    .replace(/%class\b/g, classText)
    .replace(/%comment\b/g, commentText)
    .replace(/%\{([^}]*)\}/g, replacer)
    .replace(/%(\w+)\b/g, replacer)
    .replace(new RegExp(ESCAPED_PERCENT, "g"), "%");

  // fontSize=0 means "auto-size to fit extent" in Modelica.
  // Since we can't use DOM-based getComputedTextLength() in the web worker,
  // approximate: fit text within the extent based on character count.
  let fontSize = graphicItem.fontSize ?? 0;
  if (fontSize === 0) {
    const charCount = Math.max(textContent.length, 1);
    // Approximate: each character is ~0.6x the font size in width
    // So: charCount * 0.6 * fontSize <= width => fontSize <= width / (charCount * 0.6)
    const maxByWidth = width / (charCount * 0.6);
    const maxByHeight = height;
    fontSize = Math.min(maxByWidth, maxByHeight) * 0.9; // 90% to leave some margin
    fontSize = Math.max(fontSize, 4); // minimum legible size
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

  const transform = componentInstance ? computeIconPlacement(componentInstance) : null;
  const invScaleRatio =
    transform && transform.scaleX !== 0 ? Math.abs(transform.scaleY) / Math.abs(transform.scaleX) : 1;

  return {
    tagName: "svg",
    attrs: {
      x,
      y,
      width,
      height,
      viewBox: `${x} ${y} ${width} ${height}`,
      preserveAspectRatio: "xMidYMid meet",
      overflow: "visible",
    },
    children: [
      {
        tagName: "text",
        textContent,
        attrs: {
          style: `dominant-baseline: central; fill: ${textColor}; font-family: ${fontName}; font-size: ${fontSize}px; font-style: ${fontStyle}; font-weight: ${fontWeight}; text-decoration: ${textDecoration}; text-anchor: ${textAnchor}; transform: scale(${invScaleRatio}, 1); transform-origin: ${textX}px ${textY}px;`,
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

  shape.attrs.fill = fillValue;
  if (!shape.attrs.style) shape.attrs.style = "";
  shape.attrs.style = (shape.attrs.style as string) + `; fill: ${fillValue} !important;`;
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
  const strokeWidth = (thickness ?? 0.25) * 2;
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
      shape.attrs.stroke = "none";
      if (!shape.attrs.style) shape.attrs.style = "";
      shape.attrs.style = (shape.attrs.style as string) + "; stroke: none !important;";
      return;
  }

  shape.attrs.stroke = strokeColor;
  shape.attrs["stroke-width"] = strokeWidth;
  if (strokeDasharray !== "none") shape.attrs["stroke-dasharray"] = strokeDasharray;
  if (!shape.attrs.style) shape.attrs.style = "";
  shape.attrs.style =
    (shape.attrs.style as string) +
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
  const id = def.attrs?.id;
  if (!id) {
    defs.push(def);
    return;
  }
  let idSet: Set<string | number> = (defs as any).__idSet;
  if (!idSet) {
    idSet = new Set(defs.map((d) => d.attrs?.id).filter((v): v is string | number => v !== undefined && v !== ""));
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
      const style = (child.attrs.style as string) || "";
      const scaleMatch = style.match(/transform:\s*scale\(([^,]+),\s*([^)]+)\)/);
      if (scaleMatch) {
        const existingScaleX = parseFloat(scaleMatch[1]);
        const existingScaleY = parseFloat(scaleMatch[2]);
        child.attrs.style = style.replace(
          /transform:\s*scale\([^)]+\)/,
          `transform: scale(${sx * existingScaleX}, ${sy * existingScaleY})`,
        );
      } else {
        const textX = child.attrs.x ?? 0;
        const textY = child.attrs.y ?? 0;
        child.attrs.style = style + `; transform: scale(${sx}, ${sy}); transform-origin: ${textX}px ${textY}px;`;
      }
    }
    unflipText(child, sx, sy);
  }
}

function buildMarker(arrow: string | null | undefined, strokeColor: string, strokeWidth: number): unknown {
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
        .map(([k, v]) => `${k}="${String(v).replace(/"/g, "&quot;")}"`)
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

function bakeVectorEffect(markup: X6Markup, scale: number): void {
  if (markup.attrs) {
    if (markup.attrs["vector-effect"] === "non-scaling-stroke") {
      delete markup.attrs["vector-effect"];

      let sw = 1;
      if (markup.attrs["stroke-width"] !== undefined) {
        sw = parseFloat(String(markup.attrs["stroke-width"]));
      } else if (typeof markup.attrs["style"] === "string") {
        const match = markup.attrs["style"].match(/stroke-width:\s*([\d.]+)px/);
        if (match) sw = parseFloat(match[1]);
      }

      const newSw = sw * scale;
      markup.attrs["stroke-width"] = newSw;

      if (typeof markup.attrs["style"] === "string") {
        markup.attrs["style"] = markup.attrs["style"].replace(
          /stroke-width:\s*[\d.]+px\s*!important;?/,
          `stroke-width: ${newSw}px !important;`,
        );
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

export function getClassIconSvg(cls: ModelicaClassInstance, size = 16, includePorts = false): string | undefined {
  try {
    const markup = renderIconX6(cls, undefined, includePorts);
    if (!markup || !hasGraphicElements(markup)) return undefined;

    // Patch root SVG for standalone icon use: add xmlns, fixed size, viewBox
    if (markup.attrs) {
      markup.attrs["xmlns"] = "http://www.w3.org/2000/svg";
      markup.attrs["width"] = size * 2;
      markup.attrs["height"] = size * 2;
      delete markup.attrs["style"];

      if (typeof markup.attrs["viewBox"] === "string") {
        const vbMatch = markup.attrs["viewBox"].match(/^([-\d.]+)\s+([-\d.]+)\s+([-\d.]+)\s+([-\d.]+)$/);
        if (vbMatch) {
          const vx = parseFloat(vbMatch[1]);
          const vy = parseFloat(vbMatch[2]);
          const vw = parseFloat(vbMatch[3]);
          const vh = parseFloat(vbMatch[4]);

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
    svgString = svgString.replace(/id="(gradient-[^"]+|pattern-[^"]+)"/g, `id="$1${uniqueSuffix}"`);
    svgString = svgString.replace(/url\(#(gradient-[^)]+|pattern-[^)]+)\)/g, `url(#$1${uniqueSuffix})`);

    return svgString;
  } catch {
    // ignore icon rendering errors
  }
  return undefined;
}

// ── On-demand component property builder ──
// Called lazily when the user clicks a component in the diagram.
// This avoids the expensive parameter/doc/icon computation during initial diagram load.

function stripHtmlEnvelope(html: string): string {
  return html
    .replace(/^\s*<html[^>]*>\s*/i, "")
    .replace(/\s*<\/html>\s*$/i, "")
    .replace(/^\s*<body[^>]*>\s*/i, "")
    .replace(/\s*<\/body>\s*$/i, "")
    .trim();
}

/**
 * Resolves a `modelica://` URI into a base64 data URI for bitmaps/images.
 */
export function resolveModelicaBitmapUri(uri: string, classInstance?: ModelicaClassInstance): string | null {
  if (!uri || !uri.startsWith("modelica://")) return null;

  const match = uri.match(/^modelica:\/\/([^/]+)\/(.*)$/);
  if (!match) return null;
  const [, libraryName, relativePath] = match;

  // 1. Try classInstance.context or classInstance.db?.context
  const ctx = (classInstance as any)?.context ?? (classInstance as any)?.db?.context;
  if (typeof ctx?.resolveURI === "function" && typeof ctx?.fs?.readBinary === "function") {
    const resolved = ctx.resolveURI(uri);
    if (resolved) {
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
          return `data:${mime};base64,${base64}`;
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
      if (cwd) {
        candidates.push(nodePath.join(cwd, "scripts", "msl", `${libraryName} 4.0.0`, relativePath));
        candidates.push(nodePath.join(cwd, "scripts", "msl", libraryName, relativePath));
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
          return `data:${mime};base64,${buf.toString("base64")}`;
        }
      }
    }
  } catch {}

  return null;
}

function processHtml(html: string | undefined, context: any): string | undefined {
  if (!html) return html;
  const stripped = stripHtmlEnvelope(html);
  if (!context) return stripped;

  return stripped.replace(/<img\s+[^>]*src=(["'])modelica:\/\/([^"']+)\1[^>]*>/gi, (match, quote, uriPath) => {
    const uri = `modelica://${uriPath}`;
    const resolvedPath = context.resolveURI(uri);
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
        return match.replace(`modelica://${uriPath}`, `data:${mimeType};base64,${base64}`);
      } catch (e) {
        console.warn(`Failed to read image ${uri}:`, e);
      }
    }
    return match.replace(/src=(["'])modelica:\/\/[^"']+\1/, 'style="display:none"');
  });
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
    description: component.description ?? "",
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

  if (Array.isArray(componentClassInstance.elements)) {
    for (const el of componentClassInstance.elements) {
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
        if (/\bparameter\b/.test(text)) {
          variability = ModelicaVariability.PARAMETER;
        }
      }
    }

    const isParameter = variability === ModelicaVariability.PARAMETER || variability === "parameter";

    if (isComp && isParameter) {
      // 1. Caller override (e.g. R(R = 100))
      let value: string | undefined = undefined;
      const compArgExpr = (component.modification as any)?.getModificationArgument?.(element.name ?? "")?.expression;
      if (compArgExpr != null) {
        value = formatPropertyValue(compArgExpr);
      }
      if (!value) {
        const compCst = (component as any)?.cstNode ?? (component as any)?.abstractSyntaxNode;
        value = extractCstModifierValue(compCst, element.name ?? "");
      }
      if (!value && component.cstNode) {
        const compCstText = component.cstNode.text ?? "";
        const escapedName = (element.name ?? "").replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
        const argRegex = new RegExp(`\\b${escapedName}\\s*=\\s*([^,()]+(?:\\([^)]*\\)[^,()]*)*)`, "i");
        const m = compCstText.match(argRegex);
        if (m) {
          value = m[1].trim();
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
        value = extractCstModifierValue(elemCst, "start");
      }
      if (!value && element.cstNode) {
        const elemText = element.cstNode.text ?? "";
        const startMatch = elemText.match(/\bstart\s*=\s*([^,()]+)/);
        if (startMatch) {
          value = startMatch[1].trim();
        } else {
          const assignMatch = elemText.match(/=\s*([^;"\n]+)/);
          if (assignMatch) {
            value = assignMatch[1].trim();
          }
        }
      }
      if (!value) {
        value = "-";
      }

      // Unit
      let unit: string | undefined = undefined;
      const unitExpr = (element.classInstance?.modification as any)?.getModificationArgument?.("unit")?.expression;
      const rawUnit = formatPropertyValue(unitExpr)?.replace(/^"|"$/g, "");
      if (rawUnit) {
        unit = formatUnit(rawUnit);
      } else {
        const typeSpec = element.declaration?.metadata?.typeSpecifier ?? element.classInstance?.name ?? "";
        if (typeSpec.includes("Resistance")) unit = "Ω";
        else if (typeSpec.includes("Inductance")) unit = "H";
        else if (typeSpec.includes("Capacitance")) unit = "F";
        else if (typeSpec.includes("Voltage") || typeSpec.includes("Potential")) unit = "V";
        else if (typeSpec.includes("Current")) unit = "A";
        else if (typeSpec.includes("Temperature")) unit = "K";
        else if (typeSpec.includes("Time")) unit = "s";
        else if (typeSpec.includes("Frequency")) unit = "Hz";
        else if (typeSpec.includes("Power")) unit = "W";
      }

      // Description
      let elemDescription = element.description;
      if (!elemDescription && element.declaration?.metadata?.description) {
        elemDescription = element.declaration.metadata.description;
      }
      if (!elemDescription && element.cstNode?.text) {
        elemDescription = extractFirstQuotedString(element.cstNode.text);
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
        const compStartArg = (component.modification as any)
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
          info?: string;
          revisions?: string;
        } | null)
      : null;

  const context = (classInstance as any).context;
  const docInfo = processHtml(docAnnotation?.info, context);
  const docRevisions = processHtml(docAnnotation?.revisions, context);
  if (docInfo) values["docInfo"] = docInfo;
  if (docRevisions) values["docRevisions"] = docRevisions;

  // Render icon SVG
  const iconSvg = getClassIconSvg(componentClassInstance, 80, true);

  // Assemble tabs
  const tabs: PropertyTabConfig[] = [];
  for (const [tabId, groupsMap] of tabMap.entries()) {
    const groups: PropertyGroupConfig[] = [];
    for (const [groupId, fields] of groupsMap.entries()) {
      groups.push({
        id: groupId.toLowerCase().replace(/\s+/g, "-"),
        label: groupId,
        fields,
      });
    }
    tabs.push({
      id: tabId.toLowerCase().replace(/\s+/g, "-"),
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
    classKind: componentClassInstance.classKind,
    className: componentClassInstance.name ?? "",
    name: component.name ?? "",
    description: component.description ?? "",
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
export function renderDiagramSvg(classInstance: ModelicaClassInstance): string {
  const bg = renderDiagramX6(classInstance);
  if (!bg) return "";
  return x6MarkupToSvg(bg);
}
