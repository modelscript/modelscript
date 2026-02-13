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
  ModelicaClassKind,
  ModelicaComponentInstance,
  renderText,
  Smooth,
  TextAlignment,
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
import { Marker, Svg } from "@svgdotjs/svg.js";

export interface X6Markup {
  tagName: string;
  selector?: string;
  groupSelector?: string;
  attrs?: Record<string, string | number | undefined>;
  children?: X6Markup[];
  textContent?: string;
}

export function renderIconX6(
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
      svg.children.push(renderIconX6(extendsClassInstance.classInstance, componentInstance, ports));
  }
  const icon: IIcon | null = classInstance.annotation("Icon");
  if (!icon) return svg;
  applyCoordinateSystemX6(svg, icon.coordinateSystem);
  const group: X6Markup = {
    tagName: "g",
  };
  svg.children.push(group);
  if (!group.children) group.children = [];
  for (const graphicItem of icon.graphics ?? [])
    group.children.push(renderGraphicItemX6(graphicItem, classInstance, componentInstance));
  if (ports) {
    for (const component of classInstance.components) {
      const connectorClassInstance = component.classInstance;
      if (!connectorClassInstance || connectorClassInstance.classKind !== ModelicaClassKind.CONNECTOR) continue;
      const connectorSvg = renderIconX6(connectorClassInstance);
      if (connectorSvg) {
        applyPortPlacementX6(connectorSvg, component);
        group.children.push(connectorSvg);
      }
    }
  }
  return svg;
}

export function renderGraphicItemX6(
  graphicItem: IGraphicItem,
  classInstance?: ModelicaClassInstance,
  componentInstance?: ModelicaComponentInstance,
): X6Markup {
  let shape;
  switch (graphicItem["@type"]) {
    case "Bitmap":
      shape = renderBitmapX6(graphicItem as IBitmap);
      break;
    case "Ellipse":
      shape = renderEllipseX6(graphicItem as IEllipse);
      break;
    case "Line":
      shape = renderLineX6(graphicItem as ILine);
      break;
    case "Polygon":
      shape = renderPolygonX6(graphicItem as IPolygon);
      break;
    case "Rectangle":
      shape = renderRectangleX6(graphicItem as IRectangle);
      break;
    case "Text":
      shape = renderTextX6(graphicItem as IText, classInstance, componentInstance);
      break;
    default:
      throw new Error();
  }
  const [ox, oy] = convertPoint(graphicItem.origin, [0, 0]);
  return {
    tagName: "g",
    children: [shape],
    attrs: {
      visibility: (graphicItem.visible ?? true) ? "visible" : "hidden",
      transform: `translate(${ox}, ${oy}) rotate(${graphicItem.rotation ?? 0})`,
    },
  };
}

export function renderFilledShapeX6(shape: X6Markup, filledShape: IFilledShape): void {
  applyFillX6(shape, filledShape);
  applyLineColorX6(shape, filledShape);
  applyLinePatternX6(shape, filledShape);
  applyLineThicknessX6(shape, filledShape);
}

export function renderBitmapX6(graphicItem: IBitmap): X6Markup {
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
  renderFilledShapeX6(shape, graphicItem);
  return shape;
}

export function renderEllipseX6(graphicItem: IEllipse): X6Markup {
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
  renderFilledShapeX6(shape, graphicItem);
  return shape;
}

export function renderLineX6(graphicItem: ILine): X6Markup {
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
  applyLineArrowsX6(shape, graphicItem);
  applyLineColorX6(shape, graphicItem);
  applyLinePatternX6(shape, graphicItem);
  applyLineThicknessX6(shape, graphicItem);
  if (!shape.attrs) shape.attrs = {};
  shape.attrs["fill"] = "none";
  return shape;
}

export function renderPolygonX6(graphicItem: IPolygon): X6Markup {
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
  renderFilledShapeX6(shape, graphicItem);
  return shape;
}

export function renderRectangleX6(graphicItem: IRectangle): X6Markup {
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
  renderFilledShapeX6(shape, graphicItem);
  return shape;
}

export function renderTextX6(
  graphicItem: IText,
  classInstance?: ModelicaClassInstance,
  componentInstance?: ModelicaComponentInstance,
): X6Markup {
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.style.position = "absolute";
  svg.style.visibility = "hidden";
  document.body.appendChild(svg);
  const text = renderText(new Svg(svg).group(), graphicItem, classInstance, componentInstance);
  document.body.removeChild(svg);
  const p1 = convertPoint(graphicItem?.extent?.[0], [0, 0]);
  const p2 = convertPoint(graphicItem?.extent?.[1], [0, 0]);
  return {
    tagName: "text",
    textContent: text.text(),
    attrs: {
      style: `dominant-baseline: ${text.attr("dominant-baseline")}; fill: ${text.attr("fill")}; font-family: ${text.attr("font-family")}; font-size: ${text.attr("font-size")}; font-style: ${text.attr("font-style")}; font-weight: ${text.attr("font-weight")}; text-decoration: ${text.attr("text-decoration")}; text-anchor: ${text.attr("text-anchor")};`,
      x:
        (graphicItem.horizontalAlignment === TextAlignment.LEFT
          ? p1[0]
          : graphicItem.horizontalAlignment === TextAlignment.RIGHT
            ? p2[0]
            : (p1[0] + p2[0]) / 2) - 10,
      y:
        (graphicItem.horizontalAlignment === TextAlignment.LEFT
          ? (p1[1] + p2[1]) / 2
          : graphicItem.horizontalAlignment === TextAlignment.RIGHT
            ? (p1[1] + p2[1]) / 2
            : (p1[1] + p2[1]) / 2) - 10,
    },
  };
}

export function applyCoordinateSystemX6(markup: X6Markup, coordinateSystem?: ICoordinateSystem): void {
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

export function applyFillX6(shape: X6Markup, filledShape: IFilledShape) {
  if (!shape.attrs) shape.attrs = {};
  switch (filledShape.fillPattern) {
    case FillPattern.SOLID:
      shape.attrs.fill = convertColor(filledShape.fillColor);
      break;
    default:
      shape.attrs.fill = "none";
  }
}

export function applyIconPlacementX6(componentSvg: X6Markup, component: ModelicaComponentInstance): void {
  if (!componentSvg.attrs) componentSvg.attrs = {};
  const transform = computeIconPlacement(component);
  if (!transform) componentSvg.attrs["visibility"] = "hidden";
  else
    componentSvg.attrs["transform"] =
      `rotate(${transform.rotate}, ${transform.originX}, ${transform.originY}) translate(${transform.translateX}, ${transform.translateY}) scale(${transform.scaleX}, ${transform.scaleY})`;
}

export function applyLineArrowsX6(shape: X6Markup, graphicItem: ILine): void {
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
          applyMarkerAttributesX6(marker);
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
          applyMarkerAttributesX6(marker);
          return marker;
        };
      default:
        return (marker: Marker): Marker => {
          marker
            .path([["M", 0, 0], ["L", 10, 5], ["L", 0, 10], ["z"]])
            .fill(convertColor(graphicItem.color, "rgb(0,0,0)"));
          applyMarkerAttributesX6(marker);
          return marker;
        };
    }
  };
  //if (startArrow && startArrow !== Arrow.NONE) shape.marker("start", arrowSize, arrowSize, marker(startArrow));
  //if (endArrow && endArrow !== Arrow.NONE) shape.marker("end", arrowSize, arrowSize, marker(endArrow));
}

export function applyLineColorX6(shape: X6Markup, graphicItem: IFilledShape | ILine): void {
  if (!shape.attrs) shape.attrs = {};
  let color;
  if (graphicItem["@type"] === "Line") {
    color = (graphicItem as ILine).color;
  } else {
    color = (graphicItem as IFilledShape).lineColor;
  }
  shape.attrs["stroke"] = convertColor(color, "rgb(0,0,0)");
}

export function applyLinePatternX6(shape: X6Markup, graphicItem: IFilledShape | ILine): void {
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

export function applyLineThicknessX6(shape: X6Markup, graphicItem: IFilledShape | ILine): void {
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

export function applyMarkerAttributesX6(marker: Marker): void {
  marker.attr("markerUnits", "userSpaceOnUse");
  marker.orient("auto-start-reverse");
  marker.ref(10, 5);
  marker.viewbox(0, 0, 10, 10);
}

export function applyPortPlacementX6(componentSvg: X6Markup, component: ModelicaComponentInstance): void {
  if (!componentSvg.attrs) componentSvg.attrs = {};
  const transform = computePortPlacement(component);
  if (!transform) componentSvg.attrs["visibility"] = "hidden";
  else
    componentSvg.attrs["transform"] =
      `rotate(${transform.rotate}, ${transform.originX}, ${transform.originY}) translate(${transform.translateX}, ${transform.translateY}) scale(${transform.scaleX}, ${transform.scaleY})`;
}
