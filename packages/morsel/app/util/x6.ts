// SPDX-License-Identifier: AGPL-3.0-or-later

import {
  Arrow,
  computeHeight,
  computeIconPlacement,
  computePortPlacement,
  computeWidth,
  convertColor,
  convertPoint,
  convertSmoothPath,
  ModelicaClassKind,
  ModelicaComponentInstance,
  renderText,
  Smooth,
  TextAlignment,
  type IBitmap,
  type IColor,
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
  defs?: X6Markup[],
): X6Markup {
  const isRoot = !defs;
  const localDefs = defs ?? [];
  const svg: X6Markup = {
    tagName: "svg",
    attrs: {
      width: "100%",
      height: "100%",
      style: "overflow: visible",
    },
    children: [],
  };
  for (const extendsClassInstance of classInstance.extendsClassInstances) {
    if (extendsClassInstance.classInstance && svg.children)
      svg.children.push(renderIconX6(extendsClassInstance.classInstance, componentInstance, ports, localDefs));
  }

  const icon: IIcon | null = classInstance.annotation("Icon");
  if (isRoot) {
    applyCoordinateSystemX6(svg, icon?.coordinateSystem, true);
  }

  if (!icon) {
    if (isRoot && localDefs.length > 0 && svg.children) {
      svg.children.unshift({
        tagName: "defs",
        children: localDefs,
      });
    }
    return svg;
  }

  if (!isRoot) {
    applyCoordinateSystemX6(svg, icon.coordinateSystem, false);
  }

  const group: X6Markup = {
    tagName: "g",
    children: [],
  };
  if (svg.children) svg.children.push(group);
  if (group.children) {
    for (const graphicItem of icon.graphics ?? [])
      group.children.push(renderGraphicItemX6(graphicItem, localDefs, classInstance, componentInstance));
  }

  if (ports && group.children) {
    for (const component of classInstance.components) {
      const connectorClassInstance = component.classInstance;
      if (!connectorClassInstance || connectorClassInstance.classKind !== ModelicaClassKind.CONNECTOR) continue;
      const connectorSvg = renderIconX6(connectorClassInstance, undefined, false, localDefs);
      if (connectorSvg) {
        applyPortPlacementX6(connectorSvg, component);
        group.children.push(connectorSvg);
      }
    }
  }

  if (isRoot && localDefs.length > 0 && svg.children) {
    svg.children.unshift({
      tagName: "defs",
      children: localDefs,
    });
  }

  return svg;
}

export function renderGraphicItemX6(
  graphicItem: IGraphicItem,
  defs: X6Markup[],
  classInstance?: ModelicaClassInstance,
  componentInstance?: ModelicaComponentInstance,
): X6Markup {
  let shape;
  switch (graphicItem["@type"]) {
    case "Bitmap":
      shape = renderBitmapX6(graphicItem as IBitmap, defs);
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
      return {
        tagName: "g",
        children: [],
      };
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

export function renderFilledShapeX6(shape: X6Markup, filledShape: IFilledShape, defs: X6Markup[]): void {
  applyFillX6(shape, filledShape, defs);
  applyLineStyleX6(shape, filledShape);
}

export function renderBitmapX6(graphicItem: IBitmap, defs: X6Markup[]): X6Markup {
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
  renderFilledShapeX6(shape, graphicItem, defs);
  return shape;
}

export function renderEllipseX6(graphicItem: IEllipse, defs: X6Markup[]): X6Markup {
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
  renderFilledShapeX6(shape, graphicItem, defs);
  return shape;
}

export function renderLineX6(graphicItem: ILine): X6Markup {
  let shape: X6Markup;
  if ((graphicItem.points?.length ?? 0) > 2) {
    if (graphicItem.smooth === Smooth.BEZIER) {
      shape = {
        tagName: "path",
        attrs: {
          d: convertSmoothPath(graphicItem.points)
            .map((cmd) => cmd.join(" "))
            .join(" "),
        },
      };
    } else {
      shape = {
        tagName: "polyline",
        attrs: {
          points: graphicItem.points?.map((p) => convertPoint(p, [0, 0]) ?? []).join(" "),
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
  applyLineStyleX6(shape, graphicItem);
  if (!shape.attrs) shape.attrs = {};
  shape.attrs["fill"] = "none";
  return shape;
}

export function renderPolygonX6(graphicItem: IPolygon, defs: X6Markup[]): X6Markup {
  let shape: X6Markup;
  if (graphicItem.smooth === Smooth.BEZIER && (graphicItem.points?.length ?? 0) > 2) {
    shape = {
      tagName: "path",
      attrs: {
        d: [...convertSmoothPath(graphicItem.points), ["Z"]].map((cmd) => cmd.join(" ")).join(" "),
      },
    };
  } else {
    shape = {
      tagName: "polygon",
      attrs: {
        points: graphicItem.points?.map((p) => convertPoint(p, [0, 0]) ?? []).join(" "),
      },
    };
  }
  renderFilledShapeX6(shape, graphicItem, defs);
  return shape;
}

export function renderRectangleX6(graphicItem: IRectangle, defs: X6Markup[]): X6Markup {
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
  if (graphicItem.radius) {
    shape.attrs["rx"] = graphicItem.radius;
    shape.attrs["ry"] = graphicItem.radius;
  }
  renderFilledShapeX6(shape, graphicItem, defs);
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
  const [x1, y1] = convertPoint(graphicItem?.extent?.[0], [0, 0]);
  const [x2, y2] = convertPoint(graphicItem?.extent?.[1], [0, 0]);
  const x = Math.min(x1, x2);
  const y = Math.min(y1, y2);
  const width = computeWidth(graphicItem.extent);
  const height = computeHeight(graphicItem.extent);
  const transform = componentInstance ? computeIconPlacement(componentInstance) : null;
  const invScaleRatio = transform && transform.scaleX !== 0 ? transform.scaleY / transform.scaleX : 1;
  const textX =
    graphicItem.horizontalAlignment === TextAlignment.LEFT
      ? x1
      : graphicItem.horizontalAlignment === TextAlignment.RIGHT
        ? x2
        : (x1 + x2) / 2;
  const textY = (y1 + y2) / 2;
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
        textContent: text.text(),
        attrs: {
          style: `dominant-baseline: ${text.attr("dominant-baseline")}; fill: ${text.attr(
            "fill",
          )}; font-family: ${text.attr("font-family")}; font-size: ${text.attr(
            "font-size",
          )}; font-style: ${text.attr("font-style")}; font-weight: ${text.attr(
            "font-weight",
          )}; text-decoration: ${text.attr("text-decoration")}; text-anchor: ${text.attr(
            "text-anchor",
          )}; transform: scale(${invScaleRatio}, 1); transform-origin: ${textX}px ${textY}px;`,
          x: textX,
          y: textY,
        },
      },
    ],
  };
}

export function applyCoordinateSystemX6(
  markup: X6Markup,
  coordinateSystem?: ICoordinateSystem,
  isRoot: boolean = true,
): void {
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

export function applyFillX6(shape: X6Markup, filledShape: IFilledShape, defs: X6Markup[]) {
  if (!shape.attrs) shape.attrs = {};

  const pattern = (filledShape.fillPattern ?? "None").toLowerCase();
  let fillValue = "none";

  switch (pattern) {
    case "solid":
      fillValue = convertColor(filledShape.fillColor);
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

function getStableId(prefix: string, params: any): string {
  // A simple way to get a stable ID from params
  const str = JSON.stringify(params);
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    const char = str.charCodeAt(i);
    hash = (hash << 5) - hash + char;
    hash |= 0; // Convert to 32bit integer
  }
  return `${prefix}-${Math.abs(hash).toString(36)}`;
}

function addDefIfMissing(defs: X6Markup[], def: X6Markup) {
  const id = def.attrs?.id;
  if (!id) {
    defs.push(def);
    return;
  }
  if (!defs.find((d) => d.attrs?.id === id)) {
    defs.push(def);
  }
}

function createLinePatternX6(defs: X6Markup[], rotation: number, lineColor?: IColor, fillColor?: IColor): string {
  const id = getStableId("pattern-line", { rotation, lineColor, fillColor });
  const children: X6Markup[] = [];
  if (fillColor) {
    children.push({
      tagName: "rect",
      attrs: { width: 4, height: 4, fill: convertColor(fillColor) },
    });
  }
  children.push({
    tagName: "line",
    attrs: {
      x1: 0,
      y1: 2,
      x2: 4,
      y2: 2,
      stroke: convertColor(lineColor),
      "stroke-width": 0.5,
    },
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
  const id = getStableId("pattern-cross", { rotation, lineColor, fillColor });
  const children: X6Markup[] = [];
  if (fillColor) {
    children.push({
      tagName: "rect",
      attrs: { width: 4, height: 4, fill: convertColor(fillColor) },
    });
  }
  children.push({
    tagName: "line",
    attrs: {
      x1: 0,
      y1: 2,
      x2: 4,
      y2: 2,
      stroke: convertColor(lineColor),
      "stroke-width": 0.5,
    },
  });
  children.push({
    tagName: "line",
    attrs: {
      x1: 2,
      y1: 0,
      x2: 2,
      y2: 4,
      stroke: convertColor(lineColor),
      "stroke-width": 0.5,
    },
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
  const id = getStableId("gradient-linear", { direction, lineColor, fillColor });
  const c = convertColor(fillColor);
  const h = convertColor(lineColor);
  addDefIfMissing(defs, {
    tagName: "linearGradient",
    attrs: {
      id,
      x1: 0,
      y1: 0,
      x2: direction === "horizontal" ? 1 : 0,
      y2: direction === "vertical" ? 1 : 0,
    },
    children: [
      { tagName: "stop", attrs: { offset: "0%", "stop-color": h } },
      { tagName: "stop", attrs: { offset: "50%", "stop-color": c } },
      { tagName: "stop", attrs: { offset: "100%", "stop-color": h } },
    ],
  });
  return `url(#${id})`;
}

function createRadialGradientX6(defs: X6Markup[], lineColor?: IColor, fillColor?: IColor): string {
  const id = getStableId("gradient-radial", { lineColor, fillColor });
  const c = convertColor(fillColor);
  const h = convertColor(lineColor);
  addDefIfMissing(defs, {
    tagName: "radialGradient",
    attrs: {
      id,
      cx: "30%",
      cy: "30%",
      r: "70%",
    },
    children: [
      { tagName: "stop", attrs: { offset: "0%", "stop-color": c } },
      { tagName: "stop", attrs: { offset: "100%", "stop-color": h } },
    ],
  });
  return `url(#${id})`;
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
              width: (graphicItem.thickness ?? 0.25) * 2,
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
              width: (graphicItem.thickness ?? 0.25) * 2,
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

export function applyLineStyleX6(shape: X6Markup, graphicItem: IFilledShape | ILine): void {
  if (!shape.attrs) shape.attrs = {};

  let color;
  let thickness;
  let pattern;

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
  const linePattern = (pattern ?? "Solid").toLowerCase();

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

export function applyMarkerAttributesX6(marker: Marker): void {
  marker.attr("markerUnits", "userSpaceOnUse");
  marker.orient("auto-start-reverse");
  marker.ref(10, 5);
  marker.viewbox(0, 0, 10, 10);
}

export function applyPortPlacementX6(componentSvg: X6Markup, component: ModelicaComponentInstance): void {
  if (!componentSvg.attrs) componentSvg.attrs = {};
  componentSvg.attrs["magnet"] = "true";
  if (component.name) componentSvg.attrs["port"] = component.name;
  const transform = computePortPlacement(component);
  if (!transform) componentSvg.attrs["visibility"] = "hidden";
  else
    componentSvg.attrs["transform"] =
      `rotate(${transform.rotate}, ${transform.originX}, ${transform.originY}) translate(${transform.translateX}, ${transform.translateY}) scale(${transform.scaleX}, ${transform.scaleY})`;
}
