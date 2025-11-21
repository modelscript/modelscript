// SPDX-License-Identifier: AGPL-3.0-or-later

import {
  Marker,
  Path,
  Polyline,
  Svg,
  type ArrayXY,
  type G,
  type Line,
  type PathCommand,
  type Shape,
  type Text,
} from "@svgdotjs/svg.js";
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
import type { ModelicaClassInstance, ModelicaComponentInstance } from "./model.js";
import { ModelicaClassKind } from "./syntax.js";

export function renderIcon(classInstance: ModelicaClassInstance, svg?: Svg): Svg | null {
  svg = svg ? svg : new Svg();
  for (const extendsClassInstance of classInstance.extendsClassInstances) {
    if (extendsClassInstance.classInstance) renderIcon(extendsClassInstance.classInstance, svg);
  }
  const icon: IIcon | null = classInstance.annotation("Icon");
  if (!icon) return svg;
  applyCoordinateSystem(svg, icon.coordinateSystem);
  const group = svg.group();
  for (const graphicItem of icon.graphics ?? []) renderGraphicItem(group, graphicItem);
  for (const component of classInstance.components) {
    const connectorClassInstance = component.classInstance;
    if (!connectorClassInstance || connectorClassInstance.classKind !== ModelicaClassKind.CONNECTOR) continue;
    const connectorSvg = renderIcon(connectorClassInstance);
    if (connectorSvg) {
      applyIconPlacement(connectorSvg, component, icon.coordinateSystem);
      group.add(connectorSvg);
    }
  }
  return svg;
}

export function renderGraphicItem(group: G, graphicItem: IGraphicItem): Shape {
  const o: [number, number] = [graphicItem.origin?.[0] ?? 0, graphicItem.origin?.[1] ?? 0];
  const r: number = ((graphicItem.rotation ?? 0) * Math.PI) / 180;
  group = group.group().matrix(Math.cos(r), -Math.sin(r), Math.sin(r), Math.cos(r), o[0], o[1]);
  let shape;
  switch (graphicItem["@type"]) {
    case "Bitmap":
      shape = renderBitmap(group, graphicItem as IBitmap);
      break;
    case "Ellipse":
      shape = renderEllipse(group, graphicItem as IEllipse);
      break;
    case "Line":
      shape = renderLine(group, graphicItem as ILine);
      break;
    case "Polygon":
      shape = renderPolygon(group, graphicItem as IPolygon);
      break;
    case "Rectangle":
      shape = renderRectangle(group, graphicItem as IRectangle);
      break;
    case "Text":
      shape = renderText(group, graphicItem as IText);
      break;
    default:
      throw new Error();
  }
  applyVisibility(shape, graphicItem);
  return shape;
}

export function renderFilledShape(shape: Shape, filledShape: IFilledShape): void {
  applyFill(shape, filledShape);
  applyLineColor(shape, filledShape);
  applyLinePattern(shape, filledShape);
  applyLineThickness(shape, filledShape);
}

export function renderBitmap(group: G, graphicItem: IBitmap): Shape {
  const p1 = convertPoint(graphicItem.extent?.[0], [-100, -100]);
  const shape = group
    .image(graphicItem.fileName)
    .width(computeWidth(graphicItem.extent))
    .height(computeHeight(graphicItem.extent))
    .x(p1[0])
    .y(p1[1]);
  renderFilledShape(shape, graphicItem);
  return shape;
}

export function renderEllipse(group: G, graphicItem: IEllipse): Shape {
  const p1 = convertPoint(graphicItem.extent?.[0], [-100, -100]);
  const rx = computeWidth(graphicItem.extent) / 2;
  const ry = computeHeight(graphicItem.extent) / 2;
  const shape = group
    .ellipse()
    .rx(rx)
    .ry(ry)
    .cx(p1[0] + rx)
    .cy(p1[1] + ry);
  renderFilledShape(shape, graphicItem);
  return shape;
}

export function renderLine(group: G, graphicItem: ILine): Shape {
  let shape;
  if ((graphicItem.points?.length ?? 0) > 2) {
    if (graphicItem.smooth === Smooth.BEZIER) {
      shape = group.path([...convertSmoothPath(graphicItem.points)]);
    } else {
      shape = group.polyline(graphicItem.points?.map((p) => convertPoint(p, [0, 0]) ?? []));
    }
  } else {
    const p1 = convertPoint(graphicItem?.points?.[0]);
    const p2 = convertPoint(graphicItem?.points?.[1]);
    shape = group.line(p1[0], p1[1], p2[0], p2[1]);
  }
  applyLineArrows(shape, graphicItem);
  applyLineColor(shape, graphicItem);
  applyLinePattern(shape, graphicItem);
  applyLineThickness(shape, graphicItem);
  shape.fill("none");
  return shape;
}

export function renderPolygon(group: G, graphicItem: IPolygon): Shape {
  let shape;
  if (graphicItem.smooth === Smooth.BEZIER && (graphicItem.points?.length ?? 0) > 2) {
    shape = group.path([...convertSmoothPath(graphicItem.points), ["Z"]]);
  } else {
    shape = group.polygon(graphicItem.points?.map((p) => convertPoint(p, [0, 0]) ?? []));
  }
  renderFilledShape(shape, graphicItem);
  return shape;
}

export function renderRectangle(group: G, graphicItem: IRectangle): Shape {
  const p1 = convertPoint(graphicItem.extent?.[0], [0, 0]);
  const p2 = convertPoint(graphicItem.extent?.[1], [0, 0]);
  const shape = group
    .rect()
    .width(Math.abs(p2[0] - p1[0]))
    .height(Math.abs(p2[1] - p1[1]))
    .x(Math.min(p1[0], p2[0]))
    .y(Math.min(p1[1], p2[1]));
  if (graphicItem.radius) shape.radius(graphicItem.radius);
  renderFilledShape(shape, graphicItem);
  return shape;
}

export function renderText(group: G, graphicItem: IText): Shape {
  const shape = group.text(graphicItem.textString ?? graphicItem.string ?? "");
  applyFontName(shape, graphicItem);
  applyFontSize(shape, graphicItem);
  applyHorizontalAlignment(shape, graphicItem);
  applyTextColor(shape, graphicItem);
  applyTextStyle(shape, graphicItem);
  return shape;
}

export function applyCoordinateSystem(svg: Svg, coordinateSystem?: ICoordinateSystem): void {
  const p1 = convertPoint(coordinateSystem?.extent?.[0], [-100, -100]);
  const p2 = convertPoint(coordinateSystem?.extent?.[1], [100, 100]);
  svg.viewbox({
    x: p1[0],
    y: p1[1],
    width: p2[0] - p1[0],
    height: p2[1] - p1[1],
  });
  svg.attr({
    preserveAspectRatio: coordinateSystem?.preserveAspectRatio,
    overflow: true,
  });
}

export function applyFill(shape: Shape, filledShape: IFilledShape) {
  switch (filledShape.fillPattern) {
    case FillPattern.SOLID:
      shape.fill(convertColor(filledShape.fillColor));
      break;
    default:
      shape.fill("none");
  }
}

export function applyFontName(shape: Text, graphicItem: IText): void {
  shape.attr({
    "font-family": graphicItem?.fontName ?? "monospace",
  });
}

export function applyFontSize(shape: Text, graphicItem: IText): void {
  shape.attr({
    "font-size": determineFontSize(graphicItem),
  });
}

export function applyHorizontalAlignment(shape: Text, graphicItem: IText): void {
  const p1 = convertPoint(graphicItem?.extent?.[0], [0, 0]);
  const p2 = convertPoint(graphicItem?.extent?.[1], [0, 0]);
  shape.attr("alignment-baseline", "middle");
  switch (graphicItem.horizontalAlignment) {
    case TextAlignment.LEFT:
      shape
        .x(p1[0])
        .y(p1[1])
        .y((p1[1] + p2[1]) / 2)
        .attr({
          "text-anchor": "start",
        });
      break;
    case TextAlignment.RIGHT:
      shape
        .x(p2[0])
        .y(p1[1])
        .y((p1[1] + p2[1]) / 2)
        .attr({
          "text-anchor": "end",
        });
      break;
    default:
      shape
        .x((p1[0] + p2[0]) / 2)
        .y((p1[1] + p2[1]) / 2)
        .attr({
          "text-anchor": "middle",
        });
  }
}

export function applyIconPlacement(
  svg: Svg,
  component: ModelicaComponentInstance,
  coordinateSystem?: ICoordinateSystem,
): void {
  const placement: IPlacement | null = component.annotation("Placement");
  if (!placement) return;
  const hasIconTransformation =
    component.abstractSyntaxNode?.annotationClause?.classModification?.hasModificationArgument(
      "Placement.iconTransformation",
    ) ?? false;
  const iconTransformation = hasIconTransformation ? placement.iconTransformation : placement.transformation;
  const hasIconVisible =
    component.abstractSyntaxNode?.annotationClause?.classModification?.hasModificationArgument(
      "Placement.iconVisible",
    ) ?? false;
  const iconVisible = hasIconVisible ? placement.iconVisible : placement.visible;
  svg.attr("visibility", iconVisible === false ? "hidden" : "visible");
  applyTransformation(svg, iconTransformation, coordinateSystem);
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
            .stroke({ color: convertColor(graphicItem.color, "rgb(0,0,0)"), width: graphicItem.thickness ?? 0.25 });
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
            .stroke({ color: convertColor(graphicItem.color, "rgb(0,0,0)"), width: graphicItem.thickness ?? 0.25 });
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
}

export function applyMarkerAttributes(marker: Marker): void {
  marker.attr("markerUnits", "userSpaceOnUse");
  marker.orient("auto-start-reverse");
  marker.ref(10, 5);
  marker.viewbox(0, 0, 10, 10);
}

export function applyTextColor(shape: Text, graphicItem: IText): void {
  shape.fill(convertColor(graphicItem.textColor, "rgb(0,0,0)"));
}

export function applyTextStyle(shape: Text, graphicItem: IText): void {
  shape.attr({
    "font-style": graphicItem?.textStyle?.find((e) => e === TextStyle.ITALIC) ? "italic" : "normal",
    "font-weight": graphicItem?.textStyle?.find((e) => e === TextStyle.BOLD) ? "bold" : "normal",
    "text-decoration": graphicItem?.textStyle?.find((e) => e === TextStyle.UNDERLINE) ? "underline" : "none",
  });
}

export function applyTransformation(
  svg: Svg,
  transformation?: ITransformation,
  coordinateSystem?: ICoordinateSystem,
): void {
  if (!transformation) return;
  const w1 = computeWidth(transformation?.extent);
  const w2 = computeWidth(coordinateSystem?.extent);
  const sx = w2 === 0 ? w1 : w1 / w2;
  const h1 = computeHeight(transformation?.extent);
  const h2 = computeHeight(coordinateSystem?.extent);
  const sy = h2 === 0 ? h1 : h1 / h2;
  const tx = transformation.extent?.[0][0] ?? 0;
  const ty = transformation.extent?.[0][1] ?? 0;
  const ox = transformation.origin?.[0] ?? 0;
  const oy = transformation.origin?.[1] ?? 0;
  svg.rotate(transformation.rotation ?? 0, 0, 0);
  svg.scale(sx, sy);
  svg.translate(tx + ox, ty + oy);
}

export function applyVisibility(shape: Shape, graphicItem: IGraphicItem): void {
  if (graphicItem?.visible == null) return;
  shape.attr("visibility", graphicItem.visible ? "visible" : "hidden");
}

export function computeHeight(extent?: IExtent): number {
  return (extent?.[1][1] ?? 0) - (extent?.[0][1] ?? 0);
}

export function computeWidth(extent?: IExtent): number {
  return (extent?.[1][0] ?? 0) - (extent?.[0][0] ?? 0);
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
  return [point?.[0] ?? defaultValue?.[0] ?? 0, point?.[1] ?? defaultValue?.[1] ?? 0];
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

export function determineFontSize(graphicItem: IText): number {
  const fontSize = graphicItem.fontSize ?? 0;
  if (fontSize !== 0) return fontSize;
  return 12;
}
