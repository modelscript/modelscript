// SPDX-License-Identifier: AGPL-3.0-or-later

import {
  Ellipse,
  Image,
  Marker,
  Path,
  Polygon,
  Polyline,
  Rect,
  Svg,
  type ArrayXY,
  type G,
  type Line,
  type PathCommand,
  type Shape,
  type Text,
} from "@svgdotjs/svg.js";
import { ModelicaClassKind } from "../../types.js";
import { evaluateCondition } from "./annotation-evaluator.js";
import {
  Arrow,
  FillPattern,
  LinePattern,
  Smooth,
  TextAlignment,
  TextStyle,
  type IBitmap,
  type IColor,
  type ICoordinateSystem,
  type IDiagram,
  type IDrawingUnit,
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
} from "./types.js";
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type ModelicaClassInstance = any;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type ModelicaComponentInstance = any;

/**
 * Renders the Diagram view of a Modelica class instance as an SVG.
 */
export function renderDiagram(classInstance: ModelicaClassInstance, svg?: Svg): Svg | null {
  svg = svg ? svg : new Svg();
  for (const extendsClassInstance of classInstance.extendsClassInstances) {
    if (extendsClassInstance.classInstance) renderDiagram(extendsClassInstance.classInstance, svg);
  }
  const diagram: IDiagram | null = classInstance.annotation("Diagram");
  applyCoordinateSystem(svg, diagram?.coordinateSystem);
  const group = svg.group();
  for (const graphicItem of diagram?.graphics ?? []) renderGraphicItem(group, graphicItem, classInstance);
  for (const component of classInstance.components) {
    const componentClassInstance = component.classInstance;
    if (!componentClassInstance) continue;

    const condition = evaluateCondition(component);
    if (condition === false) continue;

    const componentSvg = renderIcon(component.declaredType ?? componentClassInstance, component, true);
    if (componentSvg) {
      if (condition === undefined) componentSvg.opacity(0.5);
      applyIconPlacement(componentSvg, component);
      group.add(componentSvg);
    }
  }
  for (const connectEquation of classInstance.connectEquations) {
    const line: ILine | null =
      typeof connectEquation.annotation === "function" ? connectEquation.annotation("Line") : null;
    if (line) renderLine(group, line);

    const text: IText | null =
      typeof connectEquation.annotation === "function" ? connectEquation.annotation("Text") : null;
    if (text) renderText(group, text, classInstance);
  }
  return svg;
}

/**
 * Renders the Icon view of a Modelica component or class as an SVG.
 */
export function renderIcon(
  classInstance: ModelicaClassInstance,
  componentInstance?: ModelicaComponentInstance,
  ports?: boolean,
  svg?: Svg,
  skipText?: boolean,
): Svg | null {
  svg = svg ? svg : new Svg();
  for (const extendsClassInstance of classInstance.extendsClassInstances) {
    if (extendsClassInstance.classInstance)
      renderIcon(extendsClassInstance.classInstance, componentInstance, ports, svg, skipText);
  }
  const icon: IIcon | null = classInstance.annotation("Icon");
  applyCoordinateSystem(svg, icon?.coordinateSystem);
  const group = svg.group();
  for (const graphicItem of icon?.graphics ?? []) {
    if (skipText && graphicItem["@type"] === "Text") continue;
    renderGraphicItem(group, graphicItem, componentInstance ?? classInstance);
  }
  if (ports) {
    for (const component of classInstance.components) {
      if (component.classKind !== ModelicaClassKind.CONNECTOR) continue;

      const condition = evaluateCondition(component);
      if (condition === false) continue;

      const componentClassInstance = component.classInstance;
      if (!componentClassInstance) continue;
      const componentSvg = renderIcon(componentClassInstance, component, false, undefined, true);
      if (componentSvg) {
        if (condition === undefined) componentSvg.opacity(0.5);
        applyPortPlacement(componentSvg, component);
        group.add(componentSvg);
      }
    }
  }
  return svg;
}

export function renderBitmap(svg: Svg | G, graphicItem: IBitmap): Image {
  const shape = svg.image();
  applyExtent(shape, graphicItem.extent);
  applyOrigin(shape, graphicItem.origin);
  applyRotation(shape, graphicItem.rotation);
  applyVisibility(shape, graphicItem);
  return shape;
}

export function renderEllipse(svg: Svg | G, graphicItem: IEllipse): Ellipse {
  const shape = svg.ellipse();
  applyExtent(shape, graphicItem.extent);
  applyFilledShape(shape, graphicItem);
  applyOrigin(shape, graphicItem.origin);
  applyRotation(shape, graphicItem.rotation);
  applyVisibility(shape, graphicItem);
  return shape;
}

export function renderGraphicItem(
  svg: Svg | G,
  graphicItem: IGraphicItem,
  classInstance?: ModelicaClassInstance | ModelicaComponentInstance,
): Shape | null {
  switch (graphicItem["@type"]) {
    case "Bitmap":
      return renderBitmap(svg, graphicItem as IBitmap);
    case "Ellipse":
      return renderEllipse(svg, graphicItem as IEllipse);
    case "Line":
      return renderLine(svg, graphicItem as ILine);
    case "Polygon":
      return renderPolygon(svg, graphicItem as IPolygon);
    case "Rectangle":
      return renderRectangle(svg, graphicItem as IRectangle);
    case "Text":
      return renderText(svg, graphicItem as IText, classInstance);
    default:
      return null;
  }
}

export function renderLine(svg: Svg | G, graphicItem: ILine): Line | Path | Polyline {
  let shape;
  if (graphicItem.smooth === Smooth.BEZIER) {
    shape = svg.path(convertSmoothPath(graphicItem.points));
  } else {
    shape = svg.polyline(graphicItem?.points?.map((e) => convertPoint(e)) ?? []);
  }
  applyLineArrows(shape, graphicItem);
  applyLineColor(shape, graphicItem);
  applyLinePattern(shape, graphicItem);
  applyLineThickness(shape, graphicItem);
  applyOrigin(shape, graphicItem.origin);
  applyRotation(shape, graphicItem.rotation);
  applyVisibility(shape, graphicItem);
  return shape;
}

export function renderPolygon(svg: Svg | G, graphicItem: IPolygon): Polygon | Path {
  let shape;
  if (graphicItem.smooth === Smooth.BEZIER) {
    const pathArray = convertSmoothPath(graphicItem.points);
    pathArray.push(["z"]);
    shape = svg.path(pathArray);
  } else {
    shape = svg.polygon(graphicItem?.points?.map((e) => convertPoint(e)) ?? []);
  }
  applyFilledShape(shape, graphicItem);
  applyOrigin(shape, graphicItem.origin);
  applyRotation(shape, graphicItem.rotation);
  applyVisibility(shape, graphicItem);
  return shape;
}

export function renderRectangle(svg: Svg | G, graphicItem: IRectangle): Rect {
  const shape = svg.rect();
  applyExtent(shape, graphicItem.extent);
  applyFilledShape(shape, graphicItem);
  applyOrigin(shape, graphicItem.origin);
  applyRadius(shape, graphicItem.radius);
  applyRotation(shape, graphicItem.rotation);
  applyVisibility(shape, graphicItem);
  return shape;
}

export function renderText(
  svg: Svg | G,
  graphicItem: IText,
  classInstance?: ModelicaClassInstance | ModelicaComponentInstance,
): Text {
  const shape = svg.text("");
  applyExtent(shape, graphicItem.extent);
  applyFilledShape(shape, graphicItem);
  applyOrigin(shape, graphicItem.origin);
  applyRotation(shape, graphicItem.rotation);
  applyTextAlignment(shape, graphicItem);
  applyTextColor(shape, graphicItem);
  applyTextFont(shape, graphicItem);
  applyTextString(shape, graphicItem, classInstance);
  applyTextStyle(shape, graphicItem);
  applyVisibility(shape, graphicItem);
  return shape;
}

export function applyCoordinateSystem(svg: Svg, coordinateSystem?: ICoordinateSystem): void {
  const [x, y] = convertPoint(coordinateSystem?.extent?.[0], [-100, -100]);
  const width = computeWidth(coordinateSystem?.extent);
  const height = computeHeight(coordinateSystem?.extent);
  svg.viewbox(x, y, width, height);
}

export function applyExtent(shape: Shape, extent?: IExtent): void {
  if (extent == null) return;
  const [x, y] = convertPoint(extent?.[0]);
  const width = computeWidth(extent);
  const height = computeHeight(extent);
  shape.move(x, y);
  shape.size(width, height);
}

export function applyFillColor(shape: Shape, graphicItem: IFilledShape): void {
  shape.attr({
    fill: convertColor(graphicItem.fillColor, "rgb(255,255,255)"),
  });
}

export function applyFilledShape(shape: Shape, filledShape: IFilledShape): void {
  applyFillPattern(shape, filledShape);
  applyLineColor(shape, filledShape);
  applyLinePattern(shape, filledShape);
  applyLineThickness(shape, filledShape);
}

export function applyFillPattern(shape: Shape, filledShape: IFilledShape): void {
  const root = shape.root();
  if (root == null) return;
  switch (filledShape.fillPattern) {
    case FillPattern.SOLID:
      applyFillColor(shape, filledShape);
      break;
    case FillPattern.HORIZONTAL:
      shape.fill(createLinePattern(root, 0, filledShape.lineColor, filledShape.fillColor));
      break;
    case FillPattern.VERTICAL:
      shape.fill(createLinePattern(root, 90, filledShape.lineColor, filledShape.fillColor));
      break;
    case FillPattern.CROSS:
      shape.fill(createCrossPattern(root, 0, filledShape.lineColor, filledShape.fillColor));
      break;
    case FillPattern.FORWARD:
      shape.fill(createLinePattern(root, -45, filledShape.lineColor, filledShape.fillColor));
      break;
    case FillPattern.BACKWARD:
      shape.fill(createLinePattern(root, 45, filledShape.lineColor, filledShape.fillColor));
      break;
    case FillPattern.CROSS_DIAG:
      shape.fill(createCrossPattern(root, 45, filledShape.lineColor, filledShape.fillColor));
      break;
    case FillPattern.HORIZONTAL_CYLINDER:
      shape.fill(createLinearGradient(root, "vertical", filledShape.lineColor, filledShape.fillColor));
      break;
    case FillPattern.VERTICAL_CYLINDER:
      shape.fill(createLinearGradient(root, "horizontal", filledShape.lineColor, filledShape.fillColor));
      break;
    case FillPattern.SPHERE:
      shape.fill(createRadialGradient(root, filledShape.lineColor, filledShape.fillColor));
      break;
    default:
      shape.fill("none");
  }
}

function createLinePattern(svg: Svg, rotation: number, lineColor?: IColor, fillColor?: IColor) {
  return svg
    .pattern(4, 4, (add) => {
      if (fillColor) {
        add.rect(4, 4).fill(convertColor(fillColor));
      }
      add.line(0, 2, 4, 2).stroke({ color: convertColor(lineColor), width: 0.5 });
    })
    .rotate(rotation);
}

function createCrossPattern(svg: Svg, rotation: number, lineColor?: IColor, fillColor?: IColor) {
  return svg
    .pattern(4, 4, (add) => {
      if (fillColor) {
        add.rect(4, 4).fill(convertColor(fillColor));
      }
      add.line(0, 2, 4, 2).stroke({ color: convertColor(lineColor), width: 0.5 });
      add.line(2, 0, 2, 4).stroke({ color: convertColor(lineColor), width: 0.5 });
    })
    .rotate(rotation);
}

function createLinearGradient(svg: Svg, direction: "horizontal" | "vertical", lineColor?: IColor, fillColor?: IColor) {
  return svg.gradient("linear", (add) => {
    add.stop(0, convertColor(fillColor, "rgb(255,255,255)"));
    add.stop(0.5, convertColor(lineColor, "rgb(0,0,0)"));
    add.stop(1, convertColor(fillColor, "rgb(255,255,255)"));
    if (direction === "vertical") {
      add.from(0, 0).to(0, 1);
    } else {
      add.from(0, 0).to(1, 0);
    }
  });
}

function createRadialGradient(svg: Svg, lineColor?: IColor, fillColor?: IColor) {
  return svg.gradient("radial", (add) => {
    add.stop(0, convertColor(fillColor, "rgb(255,255,255)"));
    add.stop(1, convertColor(lineColor, "rgb(0,0,0)"));
    add.from(0.5, 0.5).to(0.5, 0.5).radius(0.5);
  });
}

export function applyIconPlacement(componentSvg: Svg, component: ModelicaComponentInstance): void {
  const transform = computeIconPlacement(component);
  if (!transform) componentSvg.attr("visibility", "hidden");
  else
    componentSvg.attr(
      "transform",
      `rotate(${transform.rotate}, ${transform.originX}, ${transform.originY}) translate(${transform.translateX}, ${transform.translateY}) scale(${transform.scaleX}, ${transform.scaleY})`,
    );
}

export function applyLineArrows(shape: Line | Path | Polyline, graphicItem: ILine): void {
  const arrowSize = graphicItem.arrowSize ?? 3;
  if (arrowSize <= 0) return;
  const [startArrow, endArrow] = graphicItem.arrow ?? [Arrow.NONE, Arrow.NONE];
  const marker = function (arrow: Arrow): (marker: Marker) => Marker {
    switch (arrow) {
      case Arrow.OPEN:
        return (marker: Marker): Marker => {
          marker
            .path([
              ["M", 0, 0],
              ["L", 10, 5],
              ["L", 0, 10],
            ])
            .fill("none")
            .stroke({
              color: convertColor(graphicItem.color, "rgb(0,0,0)"),
              width: graphicItem.thickness ?? 0.25,
            })
            .attr("vector-effect", "non-scaling-stroke");
          applyMarkerAttributes(marker);
          return marker;
        };
      case Arrow.HALF:
        return (marker: Marker): Marker => {
          marker
            .path([
              ["M", 0, 0],
              ["L", 10, 5],
            ])
            .fill("none")
            .stroke({
              color: convertColor(graphicItem.color, "rgb(0,0,0)"),
              width: graphicItem.thickness ?? 0.25,
            })
            .attr("vector-effect", "non-scaling-stroke");
          applyMarkerAttributes(marker);
          return marker;
        };
      default:
        return (marker: Marker): Marker => {
          marker
            .path([["M", 0, 0], ["L", 10, 5], ["L", 0, 10], ["z"]])
            .fill(convertColor(graphicItem.color, "rgb(0,0,0)"));
          applyMarkerAttributes(marker);
          return marker;
        };
    }
  };
  if (startArrow && startArrow !== Arrow.NONE) shape.marker("start", arrowSize, arrowSize, marker(startArrow));
  if (endArrow && endArrow !== Arrow.NONE) shape.marker("end", arrowSize, arrowSize, marker(endArrow));
}

export function applyLineColor(shape: Shape, graphicItem: IFilledShape | ILine): void {
  let color;
  if (graphicItem["@type"] === "Line") {
    color = (graphicItem as ILine).color;
  } else {
    color = (graphicItem as IFilledShape).lineColor;
  }
  shape.attr({
    stroke: convertColor(color, "rgb(0,0,0)"),
  });
}

export function applyLinePattern(shape: Shape, graphicItem: IFilledShape | ILine): void {
  switch (graphicItem?.pattern) {
    case LinePattern.DASH:
      shape.stroke({
        dasharray: "4, 2",
      });
      break;
    case LinePattern.DASH_DOT:
      shape.stroke({
        dasharray: "4, 2, 1, 2",
      });
      break;
    case LinePattern.DASH_DOT_DOT:
      shape.stroke({
        dasharray: "4, 2, 1, 2, 1, 2",
      });
      break;
    case LinePattern.DOT:
      shape.stroke({
        dasharray: "1, 2",
      });
      break;
    case LinePattern.NONE:
      shape.stroke("none");
      break;
  }
}

export function applyLineThickness(shape: Shape, graphicItem: IFilledShape | ILine): void {
  let lineThickness;
  if (graphicItem["@type"] === "Line") {
    lineThickness = (graphicItem as ILine).thickness;
  } else {
    lineThickness = (graphicItem as IFilledShape).lineThickness;
  }
  shape.attr("stroke-width", lineThickness ?? 0.25);
  shape.attr("vector-effect", "non-scaling-stroke");
}

export function applyMarkerAttributes(marker: Marker): void {
  marker.attr("markerUnits", "userSpaceOnUse");
  marker.orient("auto-start-reverse");
  marker.ref(10, 5);
  marker.viewbox(0, 0, 10, 10);
}

export function applyPortPlacement(componentSvg: Svg, component: ModelicaComponentInstance): void {
  const transform = computePortPlacement(component);
  if (!transform) componentSvg.attr("visibility", "hidden");
  else
    componentSvg.attr(
      "transform",
      `rotate(${transform.rotate}, ${transform.originX}, ${transform.originY}) translate(${transform.translateX}, ${transform.translateY}) scale(${transform.scaleX}, ${transform.scaleY})`,
    );
}

export function applyOrigin(shape: Shape, origin?: IPoint): void {
  if (!origin) return;
  const [x, y] = convertPoint(origin);
  shape.dmove(x, y);
}

export function applyRadius(shape: Rect, radius?: IDrawingUnit): void {
  if (radius == null) return;
  shape.radius(radius);
}

export function applyRotation(shape: Shape, rotation?: number): void {
  if (rotation == null) return;
  shape.rotate(-rotation);
}

export function applyTextAlignment(shape: Text, graphicItem: IText): void {
  switch (graphicItem?.horizontalAlignment) {
    case TextAlignment.CENTER:
      shape.attr("text-anchor", "middle");
      break;
    case TextAlignment.RIGHT:
      shape.attr("text-anchor", "end");
      break;
    case TextAlignment.LEFT:
    default:
      shape.attr("text-anchor", "start");
      break;
  }
}

export function applyTextColor(shape: Text, graphicItem: IText): void {
  shape.fill(convertColor(graphicItem.fillColor ?? graphicItem.lineColor, "rgb(0,0,0)"));
}

export function applyTextFont(shape: Text, graphicItem: IText): void {
  if (graphicItem?.fontSize) shape.font("size", graphicItem.fontSize);
  if (graphicItem?.fontName) shape.font("family", graphicItem.fontName);
}

export function applyTextString(
  shape: Text,
  graphicItem: IText,
  classInstance?: ModelicaClassInstance | ModelicaComponentInstance,
): void {
  let str = graphicItem.string ?? "";
  if (str.includes("%")) {
    str = str.replace(/%name/g, classInstance?.name ?? "");
    if (classInstance?.isComponentInstance || classInstance?.kind === "Component") {
      str = str.replace(/%class/g, classInstance.typeSpecifier || classInstance.name || "");
    }
  }
  shape.text(str);
}

export function applyTextStyle(shape: Text, graphicItem: IText): void {
  shape.attr({
    "font-style": graphicItem?.style?.find((e) => e === TextStyle.ITALIC) ? "italic" : "normal",
    "font-weight": graphicItem?.style?.find((e) => e === TextStyle.BOLD) ? "bold" : "normal",
    "text-decoration": graphicItem?.style?.find((e) => e === TextStyle.UNDER_LINE) ? "underline" : "none",
  });
}

export function applyVisibility(shape: Shape, graphicItem: IGraphicItem): void {
  if (graphicItem?.visible == null) return;
  shape.attr("visibility", graphicItem.visible ? "visible" : "hidden");
}

export function computeHeight(extent?: IExtent, defaultValue = 200): number {
  if (!extent) return defaultValue;
  return Math.abs((extent?.[1]?.[1] ?? 0) - (extent?.[0]?.[1] ?? 0));
}

export function computeIconPlacement(component: ModelicaComponentInstance): TransformData | null {
  const placement: IPlacement | null = component.annotation("Placement");
  if (!placement) return null;
  const icon = component.classInstance?.annotation("Icon") as IIcon;
  return computeTransform(placement.transformation, icon?.coordinateSystem);
}

export function computePortPlacement(component: ModelicaComponentInstance): TransformData | null {
  const placement: IPlacement | null = component.annotation("Placement");
  if (!placement) return null;
  const iconTransformation = placement.transformation;
  if (placement.visible === false) return null;
  const icon = component.classInstance?.annotation("Icon") as IIcon;
  return computeTransform(iconTransformation, icon?.coordinateSystem);
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
  };
}

export function computeWidth(extent?: IExtent, defaultValue = 200): number {
  if (!extent) return defaultValue;
  return Math.abs((extent?.[1]?.[0] ?? 0) - (extent?.[0]?.[0] ?? 0));
}

export function convertColor(color?: IColor, defaultValue?: string): string {
  if (!color) return defaultValue ?? "rgb(0, 0, 0)";
  return `rgb(${color?.[0] ?? 0}, ${color?.[1] ?? 0}, ${color?.[2] ?? 0})`;
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
  if (points != null) {
    pathArray.push(["M", ...convertPoint(points[0])]);
    pathArray.push(["L", ...convertMidpoint(points[0], points[1])]);
    for (let i = 1; i < points.length - 1; i++)
      pathArray.push(["Q", ...convertPoint(points[i]), ...convertMidpoint(points[i], points[i + 1])]);
    pathArray.push(["L", ...convertPoint(points[points.length - 1])]);
  }
  return pathArray;
}

export function formatUnit(unit: string): string {
  if (unit === "Ohm") return "Ω";
  return unit;
}
