// SPDX-License-Identifier: AGPL-3.0-or-later

import { computeSolderDots, type EdgePath } from "@modelscript/diagram/solder-dots";
import { ModelicaClassKind } from "../types.js";
import { evaluateCondition } from "./annotation-evaluator.js";
import { evaluateMacroExpression, inferModelicaDomainColor } from "./data.js";
import {
  Arrow,
  EllipseClosure,
  FillPattern,
  LinePattern,
  Smooth,
  TextAlignment,
  TextStyle,
  type IBitmap,
  type IColor,
  type ICoordinateSystem,
  type IDiagram,
  type IEllipse,
  type IExtent,
  type IFilledShape,
  type IGraphicItem,
  type IIcon,
  type ILine,
  type IPlacement,
  type IPoint,
  type IPolygon,
  type IRectangle,
  type IText,
  type ITransformation,
  type ModelicaClassInstance,
  type ModelicaComponentInstance,
} from "./types.js";

export type ArrayXY = [number, number];
export type PathCommand = [string, ...number[]];

function collectAllDiagramComponents(
  ci: ModelicaClassInstance,
  visited = new Set<ModelicaClassInstance>(),
): ModelicaComponentInstance[] {
  if (!ci || visited.has(ci)) return [];
  visited.add(ci);
  const byName = new Map<string, ModelicaComponentInstance>();
  for (const ext of ci.extendsClassInstances ?? []) {
    const base = ext?.["classInstance"];
    if (base) {
      for (const comp of collectAllDiagramComponents(base, visited)) {
        if (comp.name) byName.set(comp.name, comp);
      }
    }
  }
  for (const comp of ci.components ?? []) {
    if (comp.name) byName.set(comp.name, comp);
  }
  return Array.from(byName.values());
}

interface DiagramConnectEquation {
  lhs?: string | undefined;
  rhs?: string | undefined;
  annotation?: ((name: string) => IGraphicItem | null) | undefined;
}

function collectAllDiagramConnectEquations(
  ci: ModelicaClassInstance,
  visited = new Set<ModelicaClassInstance>(),
): DiagramConnectEquation[] {
  if (!ci || visited.has(ci)) return [];
  visited.add(ci);
  const result: DiagramConnectEquation[] = [];
  for (const ext of ci.extendsClassInstances ?? []) {
    const base = ext?.["classInstance"] as ModelicaClassInstance | undefined;
    if (base) {
      result.push(...collectAllDiagramConnectEquations(base, visited));
    }
  }
  if (Array.isArray(ci["connectEquations"])) {
    result.push(...(ci["connectEquations"] as DiagramConnectEquation[]));
  }
  return result;
}

const iconCoordSysCache = new WeakMap<ModelicaClassInstance, ICoordinateSystem | null>();

export function resolveIconCoordinateSystem(
  classInstance?: ModelicaClassInstance | null,
  _componentInstance?: ModelicaComponentInstance,
  visited = new Set<ModelicaClassInstance>(),
): ICoordinateSystem | undefined {
  if (!classInstance || visited.has(classInstance)) return undefined;
  if (iconCoordSysCache.has(classInstance)) {
    return iconCoordSysCache.get(classInstance) ?? undefined;
  }
  visited.add(classInstance);
  const icon: IIcon | null =
    typeof classInstance.annotation === "function" ? (classInstance.annotation("Icon") as IIcon | null) : null;
  if (icon?.coordinateSystem?.extent) {
    iconCoordSysCache.set(classInstance, icon.coordinateSystem);
    return icon.coordinateSystem;
  }
  for (const ext of classInstance.extendsClassInstances ?? []) {
    const base = ext?.["classInstance"];
    if (base) {
      const cs = resolveIconCoordinateSystem(base, undefined, visited);
      if (cs) {
        iconCoordSysCache.set(classInstance, cs);
        return cs;
      }
    }
  }
  const fallback = icon?.coordinateSystem;
  iconCoordSysCache.set(classInstance, fallback ?? null);
  return fallback;
}

export function resolveDiagramCoordinateSystem(
  classInstance?: ModelicaClassInstance | null,
  visited = new Set<ModelicaClassInstance>(),
): ICoordinateSystem | undefined {
  if (!classInstance || visited.has(classInstance)) return undefined;
  visited.add(classInstance);
  const diagram: IDiagram | null =
    typeof classInstance.annotation === "function" ? (classInstance.annotation("Diagram") as IDiagram | null) : null;
  if (diagram?.coordinateSystem?.extent) return diagram.coordinateSystem;
  for (const ext of classInstance.extendsClassInstances ?? []) {
    const base = ext?.["classInstance"];
    if (base) {
      const cs = resolveDiagramCoordinateSystem(base, visited);
      if (cs) return cs;
    }
  }
  return diagram?.coordinateSystem;
}

function formatPlacementTransform(transform: TransformData): string {
  const extCenterX = transform.translateX - transform.originX + transform.width / 2;
  const extCenterY = transform.translateY - transform.originY + transform.height / 2;
  const csMidX = transform.csMidX ?? 0;
  const csMidY = transform.csMidY ?? 0;
  const parts: string[] = [];
  if (transform.originX !== 0 || transform.originY !== 0) {
    parts.push(`translate(${transform.originX}, ${transform.originY})`);
  }
  if (transform.rotate !== 0) {
    parts.push(`rotate(${transform.rotate})`);
  }
  if (extCenterX !== 0 || extCenterY !== 0) {
    parts.push(`translate(${extCenterX}, ${extCenterY})`);
  }
  parts.push(`scale(${transform.scaleX}, ${transform.scaleY})`);
  if (csMidX !== 0 || csMidY !== 0) {
    parts.push(`translate(${-csMidX}, ${-csMidY})`);
  }
  return parts.join(" ");
}

function hasThreeDistinctRayDirections(cx: number, cy: number, edges: EdgePath[], tolerance = 2.0): boolean {
  const angles: number[] = [];
  const tolSq = tolerance * tolerance;

  const addRayAngle = (dx: number, dy: number) => {
    const len = Math.hypot(dx, dy);
    if (len < 1e-3) return;
    const ux = dx / len;
    const uy = dy / len;
    for (const a of angles) {
      const ax = Math.cos(a);
      const ay = Math.sin(a);
      // Cosine similarity > 0.94 (~20 degrees) means same ray direction
      if (ux * ax + uy * ay > 0.94) return;
    }
    angles.push(Math.atan2(uy, ux));
  };

  for (const edge of edges) {
    const pts = edge.points;
    for (let i = 0; i < pts.length - 1; i++) {
      const p1 = pts[i]!;
      const p2 = pts[i + 1]!;
      const vx = p1.x;
      const vy = p1.y;
      const wx = p2.x;
      const wy = p2.y;
      const segDx = wx - vx;
      const segDy = wy - vy;
      const l2 = segDx * segDx + segDy * segDy;
      if (l2 < 1e-6) continue;

      const t = Math.max(0, Math.min(1, ((cx - vx) * segDx + (cy - vy) * segDy) / l2));
      const projX = vx + t * segDx;
      const projY = vy + t * segDy;
      const d2 = (cx - projX) * (cx - projX) + (cy - projY) * (cy - projY);
      if (d2 <= tolSq) {
        addRayAngle(vx - cx, vy - cy);
        addRayAngle(wx - cx, wy - cy);
        if (angles.length >= 3) return true;
      }
    }
  }
  return angles.length >= 3;
}

function evaluateTextMacros(
  rawText: string,
  classInstance?: ModelicaClassInstance | ModelicaComponentInstance,
  componentInstance?: ModelicaComponentInstance,
): string {
  if (!rawText.includes("%")) return rawText;
  const isClassArgAComponent =
    !componentInstance && Boolean(classInstance?.["isComponentInstance"] || classInstance?.kind === "Component");
  const compInst: ModelicaComponentInstance | undefined =
    componentInstance ?? (isClassArgAComponent ? (classInstance as ModelicaComponentInstance) : undefined);
  const clsInst: ModelicaClassInstance | undefined = isClassArgAComponent
    ? (compInst?.classInstance as ModelicaClassInstance | undefined)
    : (classInstance as ModelicaClassInstance | undefined);

  const ESCAPED_PERCENT = "__PERCENT__";
  const nameText = compInst?.name ?? clsInst?.name ?? classInstance?.name ?? "";
  const classText = compInst?.["typeSpecifier"] ?? clsInst?.name ?? classInstance?.name ?? "";
  const commentText = compInst?.["description"] ?? clsInst?.["description"] ?? classInstance?.["description"] ?? "";

  const replacer = (_match: string, expr: string): string => {
    return evaluateMacroExpression(expr, clsInst, compInst);
  };

  return rawText
    .replace(/%%/g, ESCAPED_PERCENT)
    .replace(/%name\b/g, nameText)
    .replace(/%class\b/g, classText)
    .replace(/%comment\b/g, commentText)
    .replace(/%\{([^}]*)\}/g, replacer)
    .replace(/%(\w+)\b/g, replacer)
    .replace(new RegExp(ESCAPED_PERCENT, "g"), "%");
}

export function computeHeight(extent?: IExtent, defaultValue = 200): number {
  if (!extent) return defaultValue;
  return Math.abs((extent?.[1]?.[1] ?? 0) - (extent?.[0]?.[1] ?? 0));
}

export function computeIconPlacement(
  component: ModelicaComponentInstance,
  precomputedPlacement?: IPlacement | null,
): TransformData | null {
  const placement: IPlacement | null =
    precomputedPlacement !== undefined
      ? precomputedPlacement
      : typeof component?.annotation === "function"
        ? component.annotation("Placement")
        : null;
  if (!placement) return null;
  if (placement.visible === false || !placement.transformation) return null;
  const coordSys = resolveIconCoordinateSystem(component.classInstance, component);
  return computeTransform(placement.transformation, coordSys);
}

export function computePortPlacement(
  component: ModelicaComponentInstance,
  precomputedPlacement?: IPlacement | null,
): TransformData | null {
  const placement: IPlacement | null =
    precomputedPlacement !== undefined
      ? precomputedPlacement
      : typeof component?.annotation === "function"
        ? component.annotation("Placement")
        : null;
  if (!placement) return null;
  if (placement.iconVisible === false || (placement.iconVisible === undefined && placement.visible === false)) {
    return null;
  }
  const iconTransformation = placement.iconTransformation ?? placement.icon ?? placement.transformation;
  if (!iconTransformation) return null;
  const coordSys = resolveIconCoordinateSystem(component.classInstance, component);
  return computeTransform(iconTransformation, coordSys);
}

export interface TransformData {
  scaleX: number;
  scaleY: number;
  rotate: number;
  translateX: number;
  translateY: number;
  originX: number;
  originY: number;
  width: number;
  height: number;
  csMidX?: number;
  csMidY?: number;
}

export function computeTransform(
  transformation?: ITransformation,
  iconCoordinateSystem?: ICoordinateSystem,
): TransformData | null {
  if (!transformation) return null;
  const w1 = computeWidth(transformation?.extent);
  const w2 = computeWidth(iconCoordinateSystem?.extent);
  const sx = w2 === 0 ? w2 : w1 / w2;
  const h1 = computeHeight(transformation?.extent);
  const h2 = computeHeight(iconCoordinateSystem?.extent);
  const sy = h2 === 0 ? h1 : h1 / h2;
  const flipX = (transformation.extent?.[0]?.[0] ?? 0) > (transformation.extent?.[1]?.[0] ?? 0);
  const flipY = (transformation.extent?.[0]?.[1] ?? 0) > (transformation.extent?.[1]?.[1] ?? 0);
  const [ox, oy] = convertPoint(transformation.origin, [0, 0]);
  const [tx1, ty1] = convertPoint(transformation.extent?.[0], [0, 0]);
  const [tx2, ty2] = convertPoint(transformation.extent?.[1], [0, 0]);
  const tx = Math.min(tx1, tx2);
  const ty = Math.min(ty1, ty2);
  const [csX1, csY1] = convertPoint(iconCoordinateSystem?.extent?.[0], [-100, -100]);
  const [csX2, csY2] = convertPoint(iconCoordinateSystem?.extent?.[1], [100, 100]);
  const csMidX = (csX1 + csX2) / 2;
  const csMidY = (csY1 + csY2) / 2;
  const a = -(transformation.rotation ?? 0);
  return {
    scaleX: flipX ? -sx : sx,
    scaleY: flipY ? -sy : sy,
    rotate: a,
    translateX: ox + tx,
    translateY: oy + ty,
    originX: ox,
    originY: oy,
    width: w2 * sx,
    height: h2 * sy,
    csMidX,
    csMidY,
  };
}

export function computeWidth(extent?: IExtent, defaultValue = 200): number {
  if (!extent) return defaultValue;
  return Math.abs((extent?.[1]?.[0] ?? 0) - (extent?.[0]?.[0] ?? 0));
}

export function convertColor(color?: IColor, defaultValue?: string): string {
  if (!color) return defaultValue ?? "rgb(0,0,0)";
  return `rgb(${color?.[0] ?? 0},${color?.[1] ?? 0},${color?.[2] ?? 0})`;
}

export function convertMidpoint(point1?: IPoint, point2?: IPoint): ArrayXY {
  const p1 = convertPoint(point1);
  const p2 = convertPoint(point2);
  return [(p1[0] + p2[0]) / 2, (p1[1] + p2[1]) / 2];
}

export function convertPoint(point?: IPoint, defaultValue?: [number, number]): ArrayXY {
  return [point?.[0] ?? defaultValue?.[0] ?? 0, -(point?.[1] ?? defaultValue?.[1] ?? 0)];
}

export function convertSmoothPath(points?: IPoint[]): PathCommand[] {
  const pathArray: PathCommand[] = [];
  if (!points || points.length === 0) return pathArray;

  if (points.length === 1) {
    pathArray.push(["M", ...convertPoint(points[0])]);
    return pathArray;
  }

  if (points.length === 2) {
    pathArray.push(["M", ...convertPoint(points[0])]);
    pathArray.push(["L", ...convertPoint(points[1])]);
    return pathArray;
  }

  // Modelica Specification 18.6.5.1 (Smooth.Bezier):
  // Quadratic Bezier spline between consecutive segment midpoints with interior points as control points.
  pathArray.push(["M", ...convertPoint(points[0])]);
  pathArray.push(["L", ...convertMidpoint(points[0], points[1])]);
  for (let i = 1; i < points.length - 1; i++) {
    pathArray.push(["Q", ...convertPoint(points[i]), ...convertMidpoint(points[i], points[i + 1])]);
  }
  pathArray.push(["L", ...convertPoint(points[points.length - 1])]);

  return pathArray;
}

export function formatUnit(unit: string): string {
  if (unit === "Ohm") return "Ω";
  return unit;
}

// ── DOM-Free String SVG Renderer (Zero svgdom / Zero @svgdotjs/svg.js Allocations) ──

interface SvgStringContext {
  defs: string[];
  defByKey: Map<string, string>;
  nextId: number;
}

function createSvgStringContext(): SvgStringContext {
  return {
    defs: [],
    defByKey: new Map(),
    nextId: 1,
  };
}

function escapeSvgXml(str: string): string {
  return str.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

function allocDefId(ctx: SvgStringContext, key: string, buildDefXml: (id: string) => string): string {
  const existing = ctx.defByKey.get(key);
  if (existing) return existing;
  const id = `msx_def_${ctx.nextId++}`;
  ctx.defByKey.set(key, id);
  ctx.defs.push(buildDefXml(id));
  return id;
}

function computeStrokeWidthValue(graphicItem: IFilledShape | ILine): number {
  const isLine = graphicItem["@type"] === "Line";
  const lineThickness = isLine ? (graphicItem as ILine).thickness : (graphicItem as IFilledShape).lineThickness;
  if (lineThickness != null && lineThickness > 0) {
    if (lineThickness <= 0.25) {
      return isLine ? 1.0 : 0.85;
    }
    return Math.round(lineThickness * 3.5 * 10) / 10;
  }
  return isLine ? 1.25 : 0.85;
}

function computeStrokeAttrsString(graphicItem: IFilledShape | ILine): string {
  const isLine = graphicItem["@type"] === "Line";
  const color = isLine ? (graphicItem as ILine).color : (graphicItem as IFilledShape).lineColor;
  if (graphicItem?.pattern === LinePattern.NONE) {
    return ` stroke="none" stroke-width="${computeStrokeWidthValue(graphicItem)}" vector-effect="non-scaling-stroke"`;
  }
  const strokeColor = convertColor(color, "rgb(0,0,0)");
  let dashAttr = "";
  switch (graphicItem?.pattern) {
    case LinePattern.DASH:
      dashAttr = ' stroke-dasharray="4, 2"';
      break;
    case LinePattern.DASH_DOT:
      dashAttr = ' stroke-dasharray="4, 2, 1, 2"';
      break;
    case LinePattern.DASH_DOT_DOT:
      dashAttr = ' stroke-dasharray="4, 2, 1, 2, 1, 2"';
      break;
    case LinePattern.DOT:
      dashAttr = ' stroke-dasharray="1, 2"';
      break;
  }
  return ` stroke="${strokeColor}"${dashAttr} stroke-width="${computeStrokeWidthValue(graphicItem)}" vector-effect="non-scaling-stroke"`;
}

function computeFillAttrString(ctx: SvgStringContext, filledShape: IFilledShape): string {
  const lc = convertColor(filledShape.lineColor, "rgb(0,0,0)");
  const fc = convertColor(filledShape.fillColor, "rgb(0,0,0)");
  const fcGrad = convertColor(filledShape.fillColor, "rgb(255,255,255)");
  switch (filledShape.fillPattern) {
    case FillPattern.SOLID:
      return ` fill="${fc}"`;
    case FillPattern.HORIZONTAL:
    case FillPattern.VERTICAL:
    case FillPattern.FORWARD:
    case FillPattern.BACKWARD: {
      const rot =
        filledShape.fillPattern === FillPattern.VERTICAL
          ? 90
          : filledShape.fillPattern === FillPattern.FORWARD
            ? -45
            : filledShape.fillPattern === FillPattern.BACKWARD
              ? 45
              : 0;
      const key = `linepat:${rot}:${lc}:${filledShape.fillColor ? fc : "none"}`;
      const id = allocDefId(ctx, key, (defId) => {
        const bg = filledShape.fillColor ? `<rect width="4" height="4" fill="${fc}"/>` : "";
        const rotAttr = rot !== 0 ? ` patternTransform="rotate(${rot})"` : "";
        return `<pattern id="${defId}" x="0" y="0" width="4" height="4" patternUnits="userSpaceOnUse"${rotAttr}>${bg}<line x1="0" y1="2" x2="4" y2="2" stroke="${lc}" stroke-width="0.5"/></pattern>`;
      });
      return ` fill="url(#${id})"`;
    }
    case FillPattern.CROSS:
    case FillPattern.CROSS_DIAG: {
      const rot = filledShape.fillPattern === FillPattern.CROSS_DIAG ? 45 : 0;
      const key = `crosspat:${rot}:${lc}:${filledShape.fillColor ? fc : "none"}`;
      const id = allocDefId(ctx, key, (defId) => {
        const bg = filledShape.fillColor ? `<rect width="4" height="4" fill="${fc}"/>` : "";
        const rotAttr = rot !== 0 ? ` patternTransform="rotate(${rot})"` : "";
        return `<pattern id="${defId}" x="0" y="0" width="4" height="4" patternUnits="userSpaceOnUse"${rotAttr}>${bg}<line x1="0" y1="2" x2="4" y2="2" stroke="${lc}" stroke-width="0.5"/><line x1="2" y1="0" x2="2" y2="4" stroke="${lc}" stroke-width="0.5"/></pattern>`;
      });
      return ` fill="url(#${id})"`;
    }
    case FillPattern.HORIZONTAL_CYLINDER: {
      const key = `hcyl:${lc}:${fcGrad}`;
      const id = allocDefId(
        ctx,
        key,
        (defId) =>
          `<linearGradient id="${defId}" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${lc}"/><stop offset="0.5" stop-color="${fcGrad}"/><stop offset="1" stop-color="${lc}"/></linearGradient>`,
      );
      return ` fill="url(#${id})"`;
    }
    case FillPattern.VERTICAL_CYLINDER: {
      const key = `vcyl:${lc}:${fcGrad}`;
      const id = allocDefId(
        ctx,
        key,
        (defId) =>
          `<linearGradient id="${defId}" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="${lc}"/><stop offset="0.5" stop-color="${fcGrad}"/><stop offset="1" stop-color="${lc}"/></linearGradient>`,
      );
      return ` fill="url(#${id})"`;
    }
    case FillPattern.SPHERE: {
      const key = `sphere:${lc}:${fcGrad}`;
      const id = allocDefId(
        ctx,
        key,
        (defId) =>
          `<radialGradient id="${defId}" cx="0.5" cy="0.5" r="0.5"><stop offset="0" stop-color="${fcGrad}"/><stop offset="1" stop-color="${lc}"/></radialGradient>`,
      );
      return ` fill="url(#${id})"`;
    }
    default:
      return ' fill="none"';
  }
}

function computeLineArrowsAttrString(ctx: SvgStringContext, graphicItem: ILine): string {
  const arrowSize = graphicItem.arrowSize ?? 3;
  if (arrowSize <= 0) return "";
  const [startArrow, endArrow] = graphicItem.arrow ?? [Arrow.NONE, Arrow.NONE];
  if ((!startArrow || startArrow === Arrow.NONE) && (!endArrow || endArrow === Arrow.NONE)) {
    return "";
  }
  const color = convertColor(graphicItem.color, "rgb(0,0,0)");
  const width = graphicItem.thickness ?? 0.25;
  const makeMarkerId = (arrow: Arrow): string => {
    const key = `marker:${arrow}:${arrowSize}:${color}:${width}`;
    return allocDefId(ctx, key, (defId) => {
      let pathEl: string;
      if (arrow === Arrow.OPEN) {
        pathEl = `<path d="M 0 0 L 10 5 L 0 10" fill="none" stroke="${color}" stroke-width="${width}" vector-effect="non-scaling-stroke"/>`;
      } else if (arrow === Arrow.HALF) {
        pathEl = `<path d="M 0 0 L 10 5" fill="none" stroke="${color}" stroke-width="${width}" vector-effect="non-scaling-stroke"/>`;
      } else {
        pathEl = `<path d="M 0 0 L 10 5 L 0 10 z" fill="${color}"/>`;
      }
      return `<marker id="${defId}" markerWidth="${arrowSize}" markerHeight="${arrowSize}" refX="10" refY="5" viewBox="0 0 10 10" orient="auto-start-reverse" markerUnits="userSpaceOnUse">${pathEl}</marker>`;
    });
  };
  let attrs = "";
  if (startArrow && startArrow !== Arrow.NONE) {
    attrs += ` marker-start="url(#${makeMarkerId(startArrow)})"`;
  }
  if (endArrow && endArrow !== Arrow.NONE) {
    attrs += ` marker-end="url(#${makeMarkerId(endArrow)})"`;
  }
  return attrs;
}

function computeVisibilityAttrString(graphicItem: IGraphicItem): string {
  if (graphicItem?.visible == null) return "";
  return ` visibility="${graphicItem.visible === true ? "visible" : "hidden"}"`;
}

function formatPathCommands(cmds: PathCommand[]): string {
  return cmds.map((cmd) => cmd.join(" ")).join(" ");
}

function renderGraphicItemString(
  ctx: SvgStringContext,
  graphicItem: IGraphicItem,
  classInstance?: ModelicaClassInstance | ModelicaComponentInstance,
  componentInstance?: ModelicaComponentInstance,
  parentTransform?: TransformData | null,
): string {
  const [ox, oy] = graphicItem.origin ? convertPoint(graphicItem.origin) : [0, 0];
  const rot = graphicItem.rotation != null && graphicItem.rotation !== 0 ? -graphicItem.rotation : 0;
  const visAttr = computeVisibilityAttrString(graphicItem);

  switch (graphicItem["@type"]) {
    case "Rectangle": {
      const rect = graphicItem as IRectangle;
      const extent = rect.extent;
      const minX = Math.min(extent?.[0]?.[0] ?? 0, extent?.[1]?.[0] ?? 0) + ox;
      const maxX = Math.max(extent?.[0]?.[0] ?? 0, extent?.[1]?.[0] ?? 0) + ox;
      const minY = Math.min(extent?.[0]?.[1] ?? 0, extent?.[1]?.[1] ?? 0);
      const maxY = Math.max(extent?.[0]?.[1] ?? 0, extent?.[1]?.[1] ?? 0);
      const x = minX;
      const y = -maxY + oy;
      const width = maxX - minX;
      const height = maxY - minY;
      const radiusAttr = rect.radius != null ? ` rx="${rect.radius}" ry="${rect.radius}"` : "";
      const cx = x + width / 2;
      const cy = y + height / 2;
      const transformAttr = rot !== 0 ? ` transform="rotate(${rot}, ${cx}, ${cy})"` : "";
      const fillAttr = computeFillAttrString(ctx, rect);
      const strokeAttr = computeStrokeAttrsString(rect);
      return `<rect width="${width}" height="${height}" x="${x}" y="${y}"${radiusAttr}${fillAttr}${strokeAttr}${transformAttr}${visAttr}/>`;
    }
    case "Ellipse": {
      const ell = graphicItem as IEllipse;
      const extent = ell.extent;
      const minX = Math.min(extent?.[0]?.[0] ?? 0, extent?.[1]?.[0] ?? 0);
      const maxX = Math.max(extent?.[0]?.[0] ?? 0, extent?.[1]?.[0] ?? 0);
      const minY = Math.min(extent?.[0]?.[1] ?? 0, extent?.[1]?.[1] ?? 0);
      const maxY = Math.max(extent?.[0]?.[1] ?? 0, extent?.[1]?.[1] ?? 0);
      const rx = (maxX - minX) / 2;
      const ry = (maxY - minY) / 2;
      const cx = (minX + maxX) / 2 + ox;
      const cy = -(minY + maxY) / 2 + oy;
      const transformAttr = rot !== 0 ? ` transform="rotate(${rot}, ${cx}, ${cy})"` : "";
      const fillAttr = computeFillAttrString(ctx, ell);
      const strokeAttr = computeStrokeAttrsString(ell);
      const startAngle = ell.startAngle ?? 0;
      const endAngle = ell.endAngle ?? 360;
      const deltaAngle = endAngle - startAngle;
      if (Math.abs(deltaAngle) < 360 && Math.abs(deltaAngle) > 1e-6 && extent) {
        const radStart = (startAngle * Math.PI) / 180;
        const radEnd = (endAngle * Math.PI) / 180;
        const xStart = cx + rx * Math.cos(radStart);
        const yStart = cy - ry * Math.sin(radStart);
        const xEnd = cx + rx * Math.cos(radEnd);
        const yEnd = cy - ry * Math.sin(radEnd);
        const largeArc = Math.abs(deltaAngle) > 180 ? 1 : 0;
        const sweep = deltaAngle >= 0 ? 0 : 1;
        const closure = ell.closure ?? EllipseClosure.AUTOMATIC;
        let d: string;
        if (closure === EllipseClosure.RADIAL || closure === EllipseClosure.AUTOMATIC) {
          d = `M ${cx} ${cy} L ${xStart} ${yStart} A ${rx} ${ry} 0 ${largeArc} ${sweep} ${xEnd} ${yEnd} Z`;
        } else if (closure === EllipseClosure.CHORD) {
          d = `M ${xStart} ${yStart} A ${rx} ${ry} 0 ${largeArc} ${sweep} ${xEnd} ${yEnd} Z`;
        } else {
          d = `M ${xStart} ${yStart} A ${rx} ${ry} 0 ${largeArc} ${sweep} ${xEnd} ${yEnd}`;
        }
        return `<path d="${d}"${fillAttr}${strokeAttr}${transformAttr}${visAttr}/>`;
      }
      return `<ellipse rx="${rx}" ry="${ry}" cx="${cx}" cy="${cy}"${fillAttr}${strokeAttr}${transformAttr}${visAttr}/>`;
    }
    case "Line": {
      const line = graphicItem as ILine;
      const pts = line.points ?? [];
      const arrowAttr = computeLineArrowsAttrString(ctx, line);
      const strokeAttr = computeStrokeAttrsString(line);
      const tParts: string[] = [];
      if (ox !== 0 || oy !== 0) tParts.push(`translate(${ox}, ${oy})`);
      if (rot !== 0) tParts.push(`rotate(${rot})`);
      const transformAttr = tParts.length > 0 ? ` transform="${tParts.join(" ")}"` : "";
      if (line.smooth === Smooth.BEZIER) {
        const d = formatPathCommands(convertSmoothPath(pts));
        return `<path d="${d}" fill="none"${arrowAttr}${strokeAttr}${transformAttr}${visAttr}/>`;
      }
      const pointsStr = pts
        .map((p) => {
          const [px, py] = convertPoint(p);
          return `${px},${py}`;
        })
        .join(" ");
      return `<polyline points="${pointsStr}" fill="none"${arrowAttr}${strokeAttr}${transformAttr}${visAttr}/>`;
    }
    case "Polygon": {
      const poly = graphicItem as IPolygon;
      const pts = poly.points ?? [];
      const fillAttr = computeFillAttrString(ctx, poly);
      const strokeAttr = computeStrokeAttrsString(poly);
      const tParts: string[] = [];
      if (ox !== 0 || oy !== 0) tParts.push(`translate(${ox}, ${oy})`);
      if (rot !== 0) tParts.push(`rotate(${rot})`);
      const transformAttr = tParts.length > 0 ? ` transform="${tParts.join(" ")}"` : "";
      if (poly.smooth === Smooth.BEZIER) {
        const pathArray = convertSmoothPath(pts);
        pathArray.push(["z"]);
        const d = formatPathCommands(pathArray);
        return `<path d="${d}"${fillAttr}${strokeAttr}${transformAttr}${visAttr}/>`;
      }
      const pointsStr = pts
        .map((p) => {
          const [px, py] = convertPoint(p);
          return `${px},${py}`;
        })
        .join(" ");
      return `<polygon points="${pointsStr}"${fillAttr}${strokeAttr}${transformAttr}${visAttr}/>`;
    }
    case "Text": {
      const txt = graphicItem as IText;
      const rawStr = txt.string ?? txt.textString ?? "";
      const str = evaluateTextMacros(rawStr, classInstance, componentInstance);
      const extent = txt.extent;
      const minX = Math.min(extent?.[0]?.[0] ?? 0, extent?.[1]?.[0] ?? 0);
      const maxX = Math.max(extent?.[0]?.[0] ?? 0, extent?.[1]?.[0] ?? 0);
      const minY = Math.min(extent?.[0]?.[1] ?? 0, extent?.[1]?.[1] ?? 0);
      const maxY = Math.max(extent?.[0]?.[1] ?? 0, extent?.[1]?.[1] ?? 0);
      const width = maxX - minX;
      const height = maxY - minY;
      const align = txt.horizontalAlignment ?? TextAlignment.CENTER;
      const textAnchor = align === TextAlignment.LEFT ? "start" : align === TextAlignment.RIGHT ? "end" : "middle";
      const textX =
        (align === TextAlignment.LEFT ? minX : align === TextAlignment.RIGHT ? maxX : (minX + maxX) / 2) + ox;
      const textY = -(minY + maxY) / 2 + oy;

      let fontSize = txt.fontSize ?? 0;
      if (!fontSize || fontSize <= 0) {
        const charCount = Math.max(str.length, 1);
        const maxByWidth = width > 0 ? width / (charCount * 0.6) : 12;
        const maxByHeight = height > 0 ? height : 12;
        fontSize = Math.round(Math.max(Math.min(maxByWidth, maxByHeight) * 0.9, 4) * 100) / 100;
      }

      const isComponentLabel =
        rawStr.includes("%") || rawStr.includes("%name") || rawStr.includes("%class") || rawStr.includes("%comment");
      const fill = convertColor(txt.textColor ?? txt.lineColor ?? txt.fillColor, "rgb(0,0,0)");
      const styles = txt.textStyle ?? txt.style;
      const fontStyle = styles?.find((e) => e === TextStyle.ITALIC) ? "italic" : "normal";
      const fontWeight = styles?.find((e) => e === TextStyle.BOLD) ? "bold" : "normal";
      const textDecoration = styles?.find((e) => e === TextStyle.UNDER_LINE) ? "underline" : "none";

      const transformParts: string[] = [];
      let unflippedAttr = "";
      if (
        isComponentLabel &&
        parentTransform &&
        (parentTransform.scaleX < 0 || parentTransform.scaleY < 0 || parentTransform.rotate !== 0)
      ) {
        const signX = parentTransform.scaleX < 0 ? -1 : 1;
        const signY = parentTransform.scaleY < 0 ? -1 : 1;
        const counterRot = -parentTransform.rotate;
        transformParts.push(`translate(${textX}, ${textY})`);
        if (signX < 0 || signY < 0) transformParts.push(`scale(${signX}, ${signY})`);
        if (counterRot !== 0) transformParts.push(`rotate(${counterRot})`);
        transformParts.push(`translate(${-textX}, ${-textY})`);
        unflippedAttr = ' data-unflipped="true"';
      }
      if (rot !== 0) {
        transformParts.push(`rotate(${rot}, ${textX}, ${textY})`);
      }
      const transformAttr = transformParts.length > 0 ? ` transform="${transformParts.join(" ")}"` : "";
      const compLabelAttr = isComponentLabel ? ' data-component-label="true"' : "";

      return `<text x="${textX}" y="${textY}" dominant-baseline="central" text-anchor="${textAnchor}" font-size="${fontSize}" font-family="${escapeSvgXml(txt.fontName || "sans-serif")}"${compLabelAttr}${unflippedAttr} fill="${fill}" font-style="${fontStyle}" font-weight="${fontWeight}" text-decoration="${textDecoration}"${transformAttr}${visAttr}>${escapeSvgXml(str)}</text>`;
    }
    case "Bitmap": {
      const bmp = graphicItem as IBitmap;
      const extent = bmp.extent;
      const minX = Math.min(extent?.[0]?.[0] ?? 0, extent?.[1]?.[0] ?? 0) + ox;
      const maxX = Math.max(extent?.[0]?.[0] ?? 0, extent?.[1]?.[0] ?? 0) + ox;
      const minY = Math.min(extent?.[0]?.[1] ?? 0, extent?.[1]?.[1] ?? 0);
      const maxY = Math.max(extent?.[0]?.[1] ?? 0, extent?.[1]?.[1] ?? 0);
      const x = minX;
      const y = -maxY + oy;
      const width = maxX - minX;
      const height = maxY - minY;
      const cx = x + width / 2;
      const cy = y + height / 2;
      const transformAttr = rot !== 0 ? ` transform="rotate(${rot}, ${cx}, ${cy})"` : "";
      const hrefAttr = bmp.imageSource
        ? ` href="data:image/png;base64,${escapeSvgXml(bmp.imageSource)}"`
        : bmp.fileName
          ? ` href="${escapeSvgXml(bmp.fileName)}"`
          : "";
      return `<image width="${width}" height="${height}" x="${x}" y="${y}"${hrefAttr}${transformAttr}${visAttr}/>`;
    }
    default:
      return "";
  }
}

function renderIconGroupsString(
  ctx: SvgStringContext,
  classInstance: ModelicaClassInstance,
  componentInstance: ModelicaComponentInstance | undefined,
  ports: boolean,
  skipText: boolean,
  leafClassInstance: ModelicaClassInstance,
  isRoot: boolean,
  parentTransform?: TransformData | null,
  visited = new Set<ModelicaClassInstance>(),
): string {
  if (!classInstance || visited.has(classInstance)) return "";
  visited.add(classInstance);

  let out = "";
  for (const extendsClassInstance of classInstance.extendsClassInstances ?? []) {
    if (extendsClassInstance["classInstance"]) {
      out += renderIconGroupsString(
        ctx,
        extendsClassInstance["classInstance"],
        componentInstance,
        false,
        skipText,
        leafClassInstance,
        false,
        parentTransform,
        visited,
      );
    }
  }

  const icon: IIcon | null = classInstance.annotation?.("Icon", componentInstance) ?? null;
  if (icon?.graphics && icon.graphics.length > 0) {
    let groupContent = "";
    for (const graphicItem of icon.graphics) {
      if (skipText && graphicItem["@type"] === "Text") continue;
      groupContent += renderGraphicItemString(ctx, graphicItem, leafClassInstance, componentInstance, parentTransform);
    }
    if (groupContent) {
      out += `<g>${groupContent}</g>`;
    }
  }

  if (isRoot && ports) {
    const allComponents = collectAllDiagramComponents(classInstance);
    let portsContent = "";
    for (const component of allComponents) {
      const compPlacement = typeof component?.annotation === "function" ? component.annotation("Placement") : null;
      if (!compPlacement) continue;

      const compKind = component["classKind"] ?? component.classInstance?.["classKind"];
      if (compKind !== ModelicaClassKind.CONNECTOR && compKind !== ModelicaClassKind.EXPANDABLE_CONNECTOR) continue;

      const condition = evaluateCondition(
        component,
        componentInstance ? { componentInstance, classInstance: leafClassInstance } : leafClassInstance,
      );
      if (condition === false) continue;

      const componentClassInstance = component.classInstance;
      if (!componentClassInstance) continue;
      const portTransform = computePortPlacement(component, compPlacement);
      if (!portTransform) continue;

      const portInner = renderIconGroupsString(
        ctx,
        componentClassInstance,
        component,
        false,
        true,
        componentClassInstance,
        true,
        portTransform,
      );
      if (portInner) {
        const opacityAttr = condition === undefined ? ' opacity="0.5"' : "";
        const transformStr = formatPlacementTransform(portTransform);
        portsContent += `<g${opacityAttr} transform="${transformStr}">${portInner}</g>`;
      }
    }
    if (portsContent) {
      out += `<g>${portsContent}</g>`;
    }
  }

  return out;
}

/**
 * Renders the Icon view of a Modelica component or class as a pure DOM-free SVG string.
 */
export function renderIconSvgString(
  classInstance: ModelicaClassInstance,
  componentInstance?: ModelicaComponentInstance,
  ports?: boolean,
  skipText?: boolean,
  leafClassInstance?: ModelicaClassInstance,
): string | null {
  if (!classInstance) return null;
  const ctx = createSvgStringContext();
  const effectiveClass = leafClassInstance ?? classInstance;
  const coordSys = resolveIconCoordinateSystem(classInstance, componentInstance);
  const extent = coordSys?.extent;
  const minX = Math.min(extent?.[0]?.[0] ?? -100, extent?.[1]?.[0] ?? 100);
  const maxX = Math.max(extent?.[0]?.[0] ?? -100, extent?.[1]?.[0] ?? 100);
  const minY = Math.min(extent?.[0]?.[1] ?? -100, extent?.[1]?.[1] ?? 100);
  const maxY = Math.max(extent?.[0]?.[1] ?? -100, extent?.[1]?.[1] ?? 100);
  const width = maxX - minX;
  const height = maxY - minY;

  const body = renderIconGroupsString(
    ctx,
    classInstance,
    componentInstance,
    Boolean(ports),
    Boolean(skipText),
    effectiveClass,
    true,
    null,
  );
  const defsBlock = ctx.defs.length > 0 ? `<defs>${ctx.defs.join("")}</defs>` : "";
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${minX} ${-maxY} ${width} ${height}">${defsBlock}${body}</svg>`;
}

function renderDiagramBackgroundGraphicsString(
  ctx: SvgStringContext,
  classInstance: ModelicaClassInstance,
  leafClassInstance: ModelicaClassInstance,
  visited = new Set<ModelicaClassInstance>(),
): string {
  if (!classInstance || visited.has(classInstance)) return "";
  visited.add(classInstance);
  let out = "";
  for (const extendsClassInstance of classInstance.extendsClassInstances ?? []) {
    if (extendsClassInstance["classInstance"]) {
      out += renderDiagramBackgroundGraphicsString(
        ctx,
        extendsClassInstance["classInstance"],
        leafClassInstance,
        visited,
      );
    }
  }
  const diagram: IDiagram | null =
    typeof classInstance.annotation === "function" ? classInstance.annotation("Diagram") : null;
  if (diagram?.graphics && diagram.graphics.length > 0) {
    let groupContent = "";
    for (const graphicItem of diagram.graphics) {
      groupContent += renderGraphicItemString(ctx, graphicItem, leafClassInstance);
    }
    if (groupContent) {
      out += `<g>${groupContent}</g>`;
    }
  }
  return out;
}

/**
 * Renders the Diagram view of a Modelica class instance as a pure DOM-free SVG string.
 */
export function renderDiagramSvgString(classInstance: ModelicaClassInstance): string | null {
  if (!classInstance) return null;
  const ctx = createSvgStringContext();
  const coordSys = resolveDiagramCoordinateSystem(classInstance);
  const csExtent = coordSys?.extent;
  const nomMinX = Math.min(csExtent?.[0]?.[0] ?? -100, csExtent?.[1]?.[0] ?? 100);
  const nomMaxX = Math.max(csExtent?.[0]?.[0] ?? -100, csExtent?.[1]?.[0] ?? 100);
  const nomMinYMod = Math.min(csExtent?.[0]?.[1] ?? -100, csExtent?.[1]?.[1] ?? 100);
  const nomMaxYMod = Math.max(csExtent?.[0]?.[1] ?? -100, csExtent?.[1]?.[1] ?? 100);
  let boundsMinX = nomMinX;
  let boundsMaxX = nomMaxX;
  let boundsMinY = -nomMaxYMod;
  let boundsMaxY = -nomMinYMod;
  let hasOverflowBounds = false;

  const includeBounds = (x1: number, y1: number, x2: number, y2: number) => {
    if (x1 < boundsMinX) {
      boundsMinX = x1;
      hasOverflowBounds = true;
    }
    if (x2 > boundsMaxX) {
      boundsMaxX = x2;
      hasOverflowBounds = true;
    }
    if (y1 < boundsMinY) {
      boundsMinY = y1;
      hasOverflowBounds = true;
    }
    if (y2 > boundsMaxY) {
      boundsMaxY = y2;
      hasOverflowBounds = true;
    }
  };

  const bgContent = renderDiagramBackgroundGraphicsString(ctx, classInstance, classInstance);
  let mainGroupContent = "";

  const allComponents = collectAllDiagramComponents(classInstance);
  for (const component of allComponents) {
    const transform = computeIconPlacement(component);
    if (!transform) continue;

    const condition = evaluateCondition(component, classInstance);
    if (condition === false) continue;

    const componentClassInstance = component.classInstance;
    if (!componentClassInstance) continue;

    const targetCls = (component["declaredType"] as ModelicaClassInstance | undefined) ?? componentClassInstance;
    const compInner = renderIconGroupsString(ctx, targetCls, component, true, false, targetCls, true, transform);
    if (compInner) {
      const opacityAttr = condition === undefined ? ' opacity="0.5"' : "";
      const transformStr = formatPlacementTransform(transform);
      mainGroupContent += `<g${opacityAttr} transform="${transformStr}">${compInner}</g>`;
      const w = Math.abs(transform.width);
      const h = Math.abs(transform.height);
      const marginX = Math.max(w * 0.35, 8);
      const marginY = Math.max(h * 0.45, 8);
      includeBounds(
        transform.translateX - marginX,
        transform.translateY - marginY,
        transform.translateX + w + marginX,
        transform.translateY + h + marginY,
      );
    }
  }

  const allConnectEquations = collectAllDiagramConnectEquations(classInstance);
  const edgePaths: EdgePath[] = [];
  for (let i = 0; i < allConnectEquations.length; i++) {
    const connectEquation = allConnectEquations[i];
    if (!connectEquation) continue;
    const line: ILine | null =
      typeof connectEquation.annotation === "function" ? (connectEquation.annotation("Line") as ILine | null) : null;
    if (line) {
      const effectiveLine: ILine = line.color
        ? line
        : {
            ...line,
            "@type": "Line",
            color: inferModelicaDomainColor(connectEquation.lhs ?? "", connectEquation.rhs ?? "", classInstance),
          };
      mainGroupContent += renderGraphicItemString(ctx, effectiveLine);
      if (Array.isArray(effectiveLine.points) && effectiveLine.points.length >= 2) {
        const svgPoints = effectiveLine.points.map((pt) => {
          const [px, py] = convertPoint(pt);
          includeBounds(px - 2, py - 2, px + 2, py + 2);
          return { x: px, y: py };
        });
        edgePaths.push({
          id: `conn_${i}`,
          points: svgPoints,
          color: convertColor(effectiveLine.color, "rgb(0,0,0)"),
          sourceKey: typeof connectEquation.lhs === "string" ? connectEquation.lhs.trim() : undefined,
          targetKey: typeof connectEquation.rhs === "string" ? connectEquation.rhs.trim() : undefined,
        });
      }
    }

    const text: IText | null =
      typeof connectEquation.annotation === "function" ? (connectEquation.annotation("Text") as IText | null) : null;
    if (text) {
      mainGroupContent += renderGraphicItemString(ctx, { ...text, "@type": "Text" }, classInstance);
    }
  }

  if (edgePaths.length > 1) {
    const portPoints: { x: number; y: number }[] = [];
    for (const ep of edgePaths) {
      const first = ep.points[0];
      const last = ep.points[ep.points.length - 1];
      if (first && !hasThreeDistinctRayDirections(first.x, first.y, edgePaths, 1.0)) {
        portPoints.push(first);
      }
      if (last && !hasThreeDistinctRayDirections(last.x, last.y, edgePaths, 1.0)) {
        portPoints.push(last);
      }
    }
    const rawDots = computeSolderDots(edgePaths, { cellSize: 40, tolerance: 1.0, portPoints });
    for (const dot of rawDots) {
      if (hasThreeDistinctRayDirections(dot.x, dot.y, edgePaths, 1.0)) {
        mainGroupContent += `<circle r="1.25" cx="${dot.x}" cy="${dot.y}" fill="${dot.color}" stroke="none"/>`;
      }
    }
  }

  let vbX = nomMinX;
  let vbY = -nomMaxYMod;
  let vbW = nomMaxX - nomMinX;
  let vbH = nomMaxYMod - nomMinYMod;
  if (hasOverflowBounds) {
    const pad = 4;
    const finalMinX = Math.floor(boundsMinX - pad);
    const finalMinY = Math.floor(boundsMinY - pad);
    const finalMaxX = Math.ceil(boundsMaxX + pad);
    const finalMaxY = Math.ceil(boundsMaxY + pad);
    vbX = finalMinX;
    vbY = finalMinY;
    vbW = finalMaxX - finalMinX;
    vbH = finalMaxY - finalMinY;
  }

  const defsBlock = ctx.defs.length > 0 ? `<defs>${ctx.defs.join("")}</defs>` : "";
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${vbX} ${vbY} ${vbW} ${vbH}">${defsBlock}${bgContent}<g>${mainGroupContent}</g></svg>`;
}
