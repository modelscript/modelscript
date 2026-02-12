// SPDX-License-Identifier: AGPL-3.0-or-later

import {
  Arrow,
  computeHeight,
  computeIconPlacement,
  computePortPlacement,
  computeWidth,
  convertColor,
  convertPoint,
  FillPattern,
  LinePattern,
  ModelicaBooleanLiteral,
  ModelicaClassKind,
  ModelicaComponentInstance,
  ModelicaEnumerationLiteral,
  ModelicaExpression,
  ModelicaIntegerLiteral,
  ModelicaRealLiteral,
  ModelicaStringLiteral,
  Smooth,
  TextAlignment,
  TextStyle,
  type IBitmap,
  type ICoordinateSystem,
  type IEllipse,
  type IFilledShape,
  type IGraphicItem,
  type IIcon,
  type ILine,
  type IPolygon,
  type IRectangle,
  type IText,
  type ModelicaClassInstance,
} from "@modelscript/modelscript";
import { Marker } from "@svgdotjs/svg.js";

export interface X6Markup {
  tagName: string;
  selector?: string;
  groupSelector?: string;
  attrs?: Record<string, string | number | undefined>;
  children?: X6Markup[];
  textContent?: string;
}

export function renderIcon(
  classInstance: ModelicaClassInstance,
  componentInstance?: ModelicaComponentInstance,
  ports?: boolean,
): X6Markup {
  const svg: X6Markup = {
    tagName: "svg",
    attrs: {
      width: "100%",
      height: "100%",
    },
  };
  if (!svg.children) svg.children = [];
  for (const extendsClassInstance of classInstance.extendsClassInstances) {
    if (extendsClassInstance.classInstance)
      svg.children.push(renderIcon(extendsClassInstance.classInstance, componentInstance, ports));
  }
  const icon: IIcon | null = classInstance.annotation("Icon");
  if (!icon) return svg;
  applyCoordinateSystem(svg, icon.coordinateSystem);
  const group: X6Markup = {
    tagName: "g",
  };
  svg.children.push(group);
  if (!group.children) group.children = [];
  for (const graphicItem of icon.graphics ?? [])
    group.children.push(renderGraphicItem(graphicItem, classInstance, componentInstance));
  if (ports) {
    for (const component of classInstance.components) {
      const connectorClassInstance = component.classInstance;
      if (!connectorClassInstance || connectorClassInstance.classKind !== ModelicaClassKind.CONNECTOR) continue;
      const connectorSvg = renderIcon(connectorClassInstance);
      if (connectorSvg) {
        applyPortPlacement(connectorSvg, component);
        group.children.push(connectorSvg);
      }
    }
  }
  return svg;
}

export function renderGraphicItem(
  graphicItem: IGraphicItem,
  classInstance?: ModelicaClassInstance,
  componentInstance?: ModelicaComponentInstance,
): X6Markup {
  let shape;
  switch (graphicItem["@type"]) {
    case "Bitmap":
      shape = renderBitmap(graphicItem as IBitmap);
      break;
    case "Ellipse":
      shape = renderEllipse(graphicItem as IEllipse);
      break;
    case "Line":
      shape = renderLine(graphicItem as ILine);
      break;
    case "Polygon":
      shape = renderPolygon(graphicItem as IPolygon);
      break;
    case "Rectangle":
      shape = renderRectangle(graphicItem as IRectangle);
      break;
    case "Text":
      shape = renderText(graphicItem as IText, classInstance, componentInstance);
      break;
    default:
      throw new Error();
  }
  applyVisibility(shape, graphicItem);
  const [ox, oy] = convertPoint(graphicItem.origin, [0, 0]);
  return {
    tagName: "g",
    children: [shape],
    attrs: {
      transform: `rotate(${graphicItem.rotation ?? 0}) translate(${ox}, ${oy})`,
    },
  };
}

export function renderFilledShape(shape: X6Markup, filledShape: IFilledShape): void {
  applyFill(shape, filledShape);
  applyLineColor(shape, filledShape);
  applyLinePattern(shape, filledShape);
  applyLineThickness(shape, filledShape);
}

export function renderBitmap(graphicItem: IBitmap): X6Markup {
  const p1 = convertPoint(graphicItem.extent?.[0], [-100, -100]);
  const shape: X6Markup = {
    tagName: "image",
    attrs: {
      href: graphicItem.fileName,
      width: computeWidth(graphicItem.extent),
      height: computeHeight(graphicItem.extent),
      x: p1[0],
      y: p1[1],
    },
  };
  renderFilledShape(shape, graphicItem);
  return shape;
}

export function renderEllipse(graphicItem: IEllipse): X6Markup {
  const [cx1, cy1] = convertPoint(graphicItem.extent?.[0], [-100, -100]);
  const [cx2, cy2] = convertPoint(graphicItem.extent?.[1], [100, 100]);
  const rx = computeWidth(graphicItem.extent) / 2;
  const ry = computeHeight(graphicItem.extent) / 2;
  const shape = {
    tagName: "ellipse",
    attrs: {
      cx: Math.min(cx1, cx2) + rx,
      cy: Math.min(cy1, cy2) + ry,
      rx,
      ry,
    },
  };
  renderFilledShape(shape, graphicItem);
  return shape;
}

export function renderLine(graphicItem: ILine): X6Markup {
  let shape: X6Markup;
  if ((graphicItem.points?.length ?? 0) > 2) {
    if (graphicItem.smooth === Smooth.BEZIER) {
      shape = {
        tagName: "path",
        attrs: {
          //d: [...convertSmoothPath(graphicItem.points)],
        },
      };
    } else {
      shape = {
        tagName: "polyline",
        attrs: {
          //points: graphicItem.points?.map((p) => convertPoint(p, [0, 0]) ?? []),
        },
      };
    }
  } else {
    const p1 = convertPoint(graphicItem?.points?.[0]);
    const p2 = convertPoint(graphicItem?.points?.[1]);
    shape = {
      tagName: "line",
      attrs: {
        x1: p1[0],
        y1: p1[1],
        x2: p2[0],
        y2: p2[1],
      },
    };
  }
  applyLineArrows(shape, graphicItem);
  applyLineColor(shape, graphicItem);
  applyLinePattern(shape, graphicItem);
  applyLineThickness(shape, graphicItem);
  if (!shape.attrs) shape.attrs = {};
  shape.attrs["fill"] = "none";
  return shape;
}

export function renderPolygon(graphicItem: IPolygon): X6Markup {
  let shape: X6Markup;
  if (graphicItem.smooth === Smooth.BEZIER && (graphicItem.points?.length ?? 0) > 2) {
    shape = {
      tagName: "path",
      attrs: {
        //d: [...convertSmoothPath(graphicItem.points), ["Z"]],
      },
    };
  } else {
    shape = {
      tagName: "polygon",
      attrs: {
        //points: graphicItem.points?.map((p) => convertPoint(p, [0, 0]) ?? []),
      },
    };
  }
  renderFilledShape(shape, graphicItem);
  return shape;
}

export function renderRectangle(graphicItem: IRectangle): X6Markup {
  const [x1, y1] = convertPoint(graphicItem.extent?.[0], [0, 0]);
  const [x2, y2] = convertPoint(graphicItem.extent?.[1], [0, 0]);
  const x = Math.min(x1, x2);
  const y = Math.min(y1, y2);
  const width = computeWidth(graphicItem.extent);
  const height = computeHeight(graphicItem.extent);
  const shape: X6Markup = {
    tagName: "rect",
    attrs: {
      x,
      y,
      width,
      height,
    },
  };
  if (!shape.attrs) shape.attrs = {};
  if (graphicItem.radius) shape.attrs["radius"] = graphicItem.radius;
  renderFilledShape(shape, graphicItem);
  return shape;
}

export function renderText(
  graphicItem: IText,
  classInstance?: ModelicaClassInstance,
  componentInstance?: ModelicaComponentInstance,
): X6Markup {
  const rawText = graphicItem.textString ?? graphicItem.string ?? "";
  const replacer = (match: string, name: string): string => {
    const namedElement = classInstance?.resolveName(name.split("."));
    if (!(namedElement instanceof ModelicaComponentInstance)) return namedElement?.name ?? "%" + name;
    const expression = ModelicaExpression.fromClassInstance(namedElement.classInstance);
    if (expression instanceof ModelicaIntegerLiteral || expression instanceof ModelicaRealLiteral) {
      return String(expression.value);
    } else if (expression instanceof ModelicaEnumerationLiteral) {
      return expression.stringValue;
    } else if (expression instanceof ModelicaStringLiteral) {
      return expression.value;
    } else if (expression instanceof ModelicaBooleanLiteral) {
      return String(expression.value);
    } else {
      return "%{" + name + "}";
    }
  };
  const formattedText = rawText
    .replaceAll(/%%/g, "%")
    .replaceAll(/%name\b/g, componentInstance?.name ?? "%name")
    .replaceAll(/%class\b/g, classInstance?.name ?? "%class")
    .replaceAll(/%\{([^}]*)\}/g, replacer)
    .replaceAll(/%(\w+)\b/g, replacer);
  const shape: X6Markup = {
    tagName: "text",
    textContent: formattedText,
  };
  applyFontName(shape, graphicItem);
  applyHorizontalAlignment(shape, graphicItem);
  applyTextColor(shape, graphicItem);
  applyTextStyle(shape, graphicItem);
  applyFontSize(shape, graphicItem);
  return shape;
}

export function applyCoordinateSystem(markup: X6Markup, coordinateSystem?: ICoordinateSystem): void {
  const [x1, y1] = convertPoint(coordinateSystem?.extent?.[0], [-100, -100]);
  const [x2, y2] = convertPoint(coordinateSystem?.extent?.[1], [100, 100]);
  const x = Math.min(x1, x2);
  const y = Math.min(y1, y2);
  const width = computeWidth(coordinateSystem?.extent);
  const height = computeHeight(coordinateSystem?.extent);
  if (!markup.attrs) markup.attrs = {};
  markup.attrs["viewBox"] = `${x} ${y} ${width} ${height}`;
  markup.attrs["preserveAspectRatio"] = "xMinYMin meet";
  markup.attrs["overflow"] = "visible";
}

export function applyFill(shape: X6Markup, filledShape: IFilledShape) {
  if (!shape.attrs) shape.attrs = {};
  switch (filledShape.fillPattern) {
    case FillPattern.SOLID:
      shape.attrs.fill = convertColor(filledShape.fillColor);
      break;
    default:
      shape.attrs.fill = "none";
  }
}

export function applyFontName(shape: X6Markup, graphicItem: IText): void {
  if (!shape.attrs) shape.attrs = {};
  shape.attrs["font-family"] = graphicItem?.fontName ?? "monospace";
}

export function applyFontSize(shape: X6Markup, graphicItem: IText): void {
  if (!shape.attrs) shape.attrs = {};
  const fontSize = graphicItem.fontSize ?? 0;
  if (fontSize === 0) {
    //const width = computeWidth(graphicItem.extent, 100);
    const height = computeHeight(graphicItem.extent, 40) - 6;
    shape.attrs["font-size"] = height;
  } else {
    shape.attrs["font-size"] = fontSize;
  }
}

export function applyHorizontalAlignment(shape: X6Markup, graphicItem: IText): void {
  if (!shape.attrs) shape.attrs = {};
  const p1 = convertPoint(graphicItem?.extent?.[0], [0, 0]);
  const p2 = convertPoint(graphicItem?.extent?.[1], [0, 0]);
  shape.attrs["dominant-baseline"] = "central";
  switch (graphicItem.horizontalAlignment) {
    case TextAlignment.LEFT:
      shape.attrs["x"] = p1[0];
      shape.attrs["y"] = (p1[1] + p2[1]) / 2;
      shape.attrs["text-anchor"] = "start";
      break;
    case TextAlignment.RIGHT:
      shape.attrs["x"] = p2[0];
      shape.attrs["y"] = (p1[1] + p2[1]) / 2;
      shape.attrs["text-anchor"] = "end";
      break;
    default:
      shape.attrs["x"] = (p1[0] + p2[0]) / 2;
      shape.attrs["y"] = (p1[1] + p2[1]) / 2;
      shape.attrs["text-anchor"] = "middle";
  }
}

export function applyIconPlacement(componentSvg: X6Markup, component: ModelicaComponentInstance): void {
  if (!componentSvg.attrs) componentSvg.attrs = {};
  const transform = computeIconPlacement(component);
  if (!transform) componentSvg.attrs["visibility"] = "hidden";
  else
    componentSvg.attrs["transform"] =
      `rotate(${transform.rotate}, ${transform.originX}, ${transform.originY}) translate(${transform.translateX}, ${transform.translateY}) scale(${transform.scaleX}, ${transform.scaleY})`;
}

export function applyLineArrows(shape: X6Markup, graphicItem: ILine): void {
  if (!shape.attrs) shape.attrs = {};
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
              width: (graphicItem.thickness ?? 0.25) * 4,
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
              width: (graphicItem.thickness ?? 0.25) * 4,
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
  //if (startArrow && startArrow !== Arrow.NONE) shape.marker("start", arrowSize, arrowSize, marker(startArrow));
  //if (endArrow && endArrow !== Arrow.NONE) shape.marker("end", arrowSize, arrowSize, marker(endArrow));
}

export function applyLineColor(shape: X6Markup, graphicItem: IFilledShape | ILine): void {
  if (!shape.attrs) shape.attrs = {};
  let color;
  if (graphicItem["@type"] === "Line") {
    color = (graphicItem as ILine).color;
  } else {
    color = (graphicItem as IFilledShape).lineColor;
  }
  shape.attrs["stroke"] = convertColor(color, "rgb(0,0,0)");
}

export function applyLinePattern(shape: X6Markup, graphicItem: IFilledShape | ILine): void {
  if (!shape.attrs) shape.attrs = {};
  switch (graphicItem?.pattern) {
    case LinePattern.DASH:
      shape.attrs["stroke-dasharray"] = "4, 2";
      break;
    case LinePattern.DASH_DOT:
      shape.attrs["stroke-dasharray"] = "4, 2, 1, 2";
      break;
    case LinePattern.DASH_DOT_DOT:
      shape.attrs["stroke-dasharray"] = "4, 2, 1, 2, 1, 2";
      break;
    case LinePattern.DOT:
      shape.attrs["stroke-dasharray"] = "1, 2";
      break;
    case LinePattern.NONE:
      shape.attrs["stroke-dasharray"] = "none";
      break;
  }
}

export function applyLineThickness(shape: X6Markup, graphicItem: IFilledShape | ILine): void {
  if (!shape.attrs) shape.attrs = {};
  let lineThickness;
  if (graphicItem["@type"] === "Line") {
    lineThickness = (graphicItem as ILine).thickness;
  } else {
    lineThickness = (graphicItem as IFilledShape).lineThickness;
  }
  shape.attrs["stroke-width"] = (lineThickness ?? 0.25) * 4;
  shape.attrs["vector-effect"] = "non-scaling-stroke";
}

export function applyMarkerAttributes(marker: Marker): void {
  marker.attr("markerUnits", "userSpaceOnUse");
  marker.orient("auto-start-reverse");
  marker.ref(10, 5);
  marker.viewbox(0, 0, 10, 10);
}

export function applyPortPlacement(componentSvg: X6Markup, component: ModelicaComponentInstance): void {
  if (!componentSvg.attrs) componentSvg.attrs = {};
  const transform = computePortPlacement(component);
  if (!transform) componentSvg.attrs["visibility"] = "hidden";
  else
    componentSvg.attrs["transform"] =
      `rotate(${transform.rotate}, ${transform.originX}, ${transform.originY}) translate(${transform.translateX}, ${transform.translateY}) scale(${transform.scaleX}, ${transform.scaleY})`;
}

export function applyTextColor(shape: X6Markup, graphicItem: IText): void {
  if (!shape.attrs) shape.attrs = {};
  shape.attrs["fill"] = convertColor(graphicItem.textColor, "rgb(0,0,0)");
}

export function applyTextStyle(shape: X6Markup, graphicItem: IText): void {
  if (!shape.attrs) shape.attrs = {};
  shape.attrs["font-style"] = graphicItem?.textStyle?.find((e) => e === TextStyle.ITALIC) ? "italic" : "normal";
  shape.attrs["font-weight"] = graphicItem?.textStyle?.find((e) => e === TextStyle.BOLD) ? "bold" : "normal";
  shape.attrs["text-decoration"] = graphicItem?.textStyle?.find((e) => e === TextStyle.UNDERLINE)
    ? "underline"
    : "none";
}

export function applyVisibility(shape: X6Markup, graphicItem: IGraphicItem): void {
  if (graphicItem?.visible == null) return;
  if (!shape.attrs) shape.attrs = {};
  shape.attrs["visibility"] = graphicItem.visible ? "visible" : "hidden";
}
