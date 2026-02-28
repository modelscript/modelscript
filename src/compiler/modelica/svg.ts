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
import {
  ModelicaBooleanLiteral,
  ModelicaEnumerationLiteral,
  ModelicaExpression,
  ModelicaIntegerLiteral,
  ModelicaRealLiteral,
  ModelicaStringLiteral,
} from "./dae.js";
import { evaluateCondition } from "./interpreter.js";
import {
  ModelicaComponentInstance,
  ModelicaElement,
  ModelicaRealClassInstance,
  type ModelicaClassInstance,
} from "./model.js";
import { ModelicaClassKind } from "./syntax.js";
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

    const componentSvg = renderIcon(componentClassInstance, component, true);
    if (componentSvg) {
      if (condition === undefined) componentSvg.opacity(0.5);
      applyIconPlacement(componentSvg, component);
      group.add(componentSvg);
    }
  }
  for (const connectEquation of classInstance.connectEquations) {
    const annotations = ModelicaElement.instantiateAnnotations(classInstance, connectEquation.annotationClause);
    const line: ILine | null = classInstance.annotation("Line", annotations);
    if (line) renderLine(group, line);
    const text: IText | null = classInstance.annotation("Text", annotations);
    if (text) renderText(group, text, classInstance);
  }
  return svg;
}

export function renderIcon(
  classInstance: ModelicaClassInstance,
  componentInstance?: ModelicaComponentInstance,
  ports?: boolean,
  svg?: Svg,
): Svg | null {
  svg = svg ? svg : new Svg();
  for (const extendsClassInstance of classInstance.extendsClassInstances) {
    if (extendsClassInstance.classInstance)
      renderIcon(extendsClassInstance.classInstance, componentInstance, ports, svg);
  }
  const icon: IIcon | null = classInstance.annotation("Icon");
  if (!icon) return svg;
  applyCoordinateSystem(svg, icon.coordinateSystem);
  const group = svg.group();
  for (const graphicItem of icon.graphics ?? [])
    renderGraphicItem(group, graphicItem, classInstance, componentInstance);
  if (ports) {
    for (const component of classInstance.components) {
      const condition = evaluateCondition(component);
      if (condition === false) continue;

      const connectorClassInstance = component.classInstance;
      if (!connectorClassInstance || connectorClassInstance.classKind !== ModelicaClassKind.CONNECTOR) continue;

      const connectorSvg = renderIcon(connectorClassInstance);
      if (connectorSvg) {
        if (condition === undefined) connectorSvg.opacity(0.5);
        applyPortPlacement(connectorSvg, component);
        group.add(connectorSvg);
      }
    }
  }
  return svg;
}

export function renderGraphicItem(
  group: G,
  graphicItem: IGraphicItem,
  classInstance?: ModelicaClassInstance,
  componentInstance?: ModelicaComponentInstance,
): Shape {
  const graphicItemGroup = group.group();
  const [ox, oy] = convertPoint(graphicItem.origin, [0, 0]);
  graphicItemGroup.rotate(-(graphicItem.rotation ?? 0));
  graphicItemGroup.translate(ox, oy);
  let shape;
  switch (graphicItem["@type"]) {
    case "Bitmap":
      shape = renderBitmap(graphicItemGroup, graphicItem as IBitmap);
      break;
    case "Ellipse":
      shape = renderEllipse(graphicItemGroup, graphicItem as IEllipse);
      break;
    case "Line":
      shape = renderLine(graphicItemGroup, graphicItem as ILine);
      break;
    case "Polygon":
      shape = renderPolygon(graphicItemGroup, graphicItem as IPolygon);
      break;
    case "Rectangle":
      shape = renderRectangle(graphicItemGroup, graphicItem as IRectangle);
      break;
    case "Text":
      shape = renderText(graphicItemGroup, graphicItem as IText, classInstance, componentInstance);
      break;
    default:
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      return graphicItemGroup as any;
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

export function renderBitmap(group: G, graphicItem: IBitmap): Image {
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

export function renderEllipse(group: G, graphicItem: IEllipse): Ellipse {
  const [cx1, cy1] = convertPoint(graphicItem.extent?.[0], [-100, -100]);
  const [cx2, cy2] = convertPoint(graphicItem.extent?.[1], [100, 100]);
  const rx = computeWidth(graphicItem.extent) / 2;
  const ry = computeHeight(graphicItem.extent) / 2;
  const shape = group
    .ellipse()
    .rx(rx)
    .ry(ry)
    .cx(Math.min(cx1, cx2) + rx)
    .cy(Math.min(cy1, cy2) + ry);
  renderFilledShape(shape, graphicItem);
  return shape;
}

export function renderLine(group: G, graphicItem: ILine): Line | Path | Polyline {
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

export function renderPolygon(group: G, graphicItem: IPolygon): Path | Polygon {
  let shape;
  if (graphicItem.smooth === Smooth.BEZIER && (graphicItem.points?.length ?? 0) > 2) {
    shape = group.path([...convertSmoothPath(graphicItem.points), ["Z"]]);
  } else {
    shape = group.polygon(graphicItem.points?.map((p) => convertPoint(p, [0, 0]) ?? []));
  }
  renderFilledShape(shape, graphicItem);
  return shape;
}

export function renderRectangle(group: G, graphicItem: IRectangle): Rect {
  const [x1, y1] = convertPoint(graphicItem.extent?.[0], [0, 0]);
  const [x2, y2] = convertPoint(graphicItem.extent?.[1], [0, 0]);
  const x = Math.min(x1, x2);
  const y = Math.min(y1, y2);
  const width = computeWidth(graphicItem.extent);
  const height = computeHeight(graphicItem.extent);
  const shape = group.rect().width(width).height(height).x(x).y(y);
  if (graphicItem.radius) shape.radius(graphicItem.radius);
  renderFilledShape(shape, graphicItem);
  return shape;
}

export function renderText(
  group: G,
  graphicItem: IText,
  classInstance?: ModelicaClassInstance,
  componentInstance?: ModelicaComponentInstance,
): Text {
  const rawText = graphicItem.textString ?? graphicItem.string ?? "";
  const formatUnit = (unit: string): string => {
    if (unit === "Ohm") return "Ω";
    return unit;
  };

  const replacer = (match: string, name: string): string => {
    const namedElement = classInstance?.resolveName(name.split("."));
    if (!(namedElement instanceof ModelicaComponentInstance)) return namedElement?.name ?? name;
    let unitString = "";
    if (namedElement.classInstance instanceof ModelicaRealClassInstance) {
      const unitExp = namedElement.classInstance?.unit;
      if (unitExp instanceof ModelicaStringLiteral && unitExp.value) {
        unitString = " " + formatUnit(unitExp.value);
      }
    }
    const expression = ModelicaExpression.fromClassInstance(namedElement.classInstance);
    if (expression instanceof ModelicaIntegerLiteral || expression instanceof ModelicaRealLiteral) {
      return String(expression.value) + unitString;
    } else if (expression instanceof ModelicaEnumerationLiteral) {
      return expression.stringValue;
    } else if (expression instanceof ModelicaStringLiteral) {
      return expression.value;
    } else if (expression instanceof ModelicaBooleanLiteral) {
      return String(expression.value);
    } else {
      return name;
    }
  };
  const formattedText = rawText
    .replaceAll(/%%/g, "%")
    .replaceAll(/%name\b/g, componentInstance?.name ?? "%name")
    .replaceAll(/%class\b/g, classInstance?.name ?? "%class")
    .replaceAll(/%\{([^}]*)\}/g, replacer)
    .replaceAll(/%(\w+)\b/g, replacer);
  const shape = group.text(formattedText);
  applyFontName(shape, graphicItem);
  applyHorizontalAlignment(shape, graphicItem);
  applyTextColor(shape, graphicItem);
  applyTextStyle(shape, graphicItem);
  applyFontSize(shape, graphicItem);
  return shape;
}

export function applyCoordinateSystem(svg: Svg, coordinateSystem?: ICoordinateSystem): void {
  const [x1, y1] = convertPoint(coordinateSystem?.extent?.[0], [-100, -100]);
  const [x2, y2] = convertPoint(coordinateSystem?.extent?.[1], [100, 100]);
  const x = Math.min(x1, x2);
  const y = Math.min(y1, y2);
  const width = computeWidth(coordinateSystem?.extent);
  const height = computeHeight(coordinateSystem?.extent);
  svg.viewbox({
    x: x,
    y: y,
    width: width,
    height: height,
  });
  svg.attr({
    preserveAspectRatio: "xMinYMin meet",
    overflow: "visible",
  });
}

export function applyFill(shape: Shape, filledShape: IFilledShape) {
  const root = (shape.root() as Svg) || ((shape.parent() as G)?.root() as Svg);
  if (!root) {
    if (filledShape.fillPattern === FillPattern.SOLID) {
      shape.fill(convertColor(filledShape.fillColor));
    } else {
      shape.fill("none");
    }
    return;
  }
  switch (filledShape.fillPattern) {
    case FillPattern.SOLID:
      shape.fill(convertColor(filledShape.fillColor));
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
  const c = convertColor(fillColor);
  const h = convertColor(lineColor);
  return svg
    .gradient("linear", (add) => {
      add.stop(0, h);
      add.stop(0.5, c);
      add.stop(1, h);
    })
    .from(0, 0)
    .to(direction === "horizontal" ? 1 : 0, direction === "vertical" ? 1 : 0);
}

function createRadialGradient(svg: Svg, lineColor?: IColor, fillColor?: IColor) {
  const c = convertColor(fillColor);
  const h = convertColor(lineColor);
  return svg
    .gradient("radial", (add) => {
      add.stop(0, c);
      add.stop(1, h);
    })
    .attr({ cx: 0.3, cy: 0.3, r: 0.7 });
}

export function applyFontName(shape: Text, graphicItem: IText): void {
  shape.attr({
    "font-family": graphicItem?.fontName ?? "monospace",
  });
}

export function applyFontSize(shape: Text, graphicItem: IText): void {
  const fontSize = graphicItem.fontSize ?? 0;
  if (fontSize === 0) {
    const width = computeWidth(graphicItem.extent, 100);
    const height = computeHeight(graphicItem.extent, 40) - 2; // Increased padding
    let minSize = 1;
    let maxSize = Math.max(1, Math.floor(height));
    let bestSize = 1;

    // Use binary search for faster and more consistent font size determination
    while (minSize <= maxSize) {
      const midSize = Math.floor((minSize + maxSize) / 2);
      shape.attr({ "font-size": midSize });
      // We use a small tolerance (1px) to avoid rounding issues that might differ between browsers
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      if ((shape.node as any).getComputedTextLength() <= width + 0.5) {
        bestSize = midSize;
        minSize = midSize + 1;
      } else {
        maxSize = midSize - 1;
      }
    }
    shape.attr({ "font-size": bestSize });
  } else {
    shape.attr({
      "font-size": fontSize,
    });
  }
}

export function applyHorizontalAlignment(shape: Text, graphicItem: IText): void {
  const p1 = convertPoint(graphicItem?.extent?.[0], [0, 0]);
  const p2 = convertPoint(graphicItem?.extent?.[1], [0, 0]);
  shape.attr("dominant-baseline", "central");
  switch (graphicItem.horizontalAlignment) {
    case TextAlignment.LEFT:
      shape
        .x(p1[0])
        .y((p1[1] + p2[1]) / 2)
        .attr({
          "text-anchor": "start",
        });
      break;
    case TextAlignment.RIGHT:
      shape
        .x(p2[0])
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
  if (iconVisible === false) return null;
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
  const [ox, oy] = convertPoint(transformation.origin, [0, 0]);
  const [tx1, ty1] = convertPoint(transformation.extent?.[0], [0, 0]);
  const [tx2, ty2] = convertPoint(transformation.extent?.[1], [0, 0]);
  const tx = Math.min(tx1, tx2);
  const ty = Math.min(ty1, ty2);
  const a = -(transformation.rotation ?? 0);
  return {
    scaleX: sx,
    scaleY: sy,
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
