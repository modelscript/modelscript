// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Server-side diagram data builder for the VS Code webview.
// Mirrors morsel's renderDiagram() + x6.ts but produces serializable JSON
// that the webview can feed to an X6 Graph.

import {
  computeHeight,
  computeIconPlacement,
  computePortPlacement,
  computeWidth,
  convertColor,
  convertPoint,
  convertSmoothPath,
  evaluateCondition,
  formatUnit,
  LinePattern,
  ModelicaClassKind,
  ModelicaComponentInstance,
  ModelicaVariability,
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
  type IPolygon,
  type IRectangle,
  type IText,
  type ModelicaClassInstance,
} from "@modelscript/core";

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
} from "./diagramProtocol";

import type {
  ComponentPropertyData,
  DiagramData,
  DiagramEdge,
  DiagramNode,
  DiagramPort,
  X6Markup,
} from "./diagramProtocol";

// ── Build diagram data from a class instance ──

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function formatPropertyValue(expr: any): string | undefined {
  if (expr == null) return undefined;
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
  return undefined;
}

export function buildDiagramData(classInstance: ModelicaClassInstance): DiagramData {
  const nodes: DiagramNode[] = [];
  const edges: DiagramEdge[] = [];

  const t0 = performance.now();
  let tIconRender = 0;
  let tPortRender = 0;
  let tCondition = 0;
  let tPlacement = 0;
  let componentCount = 0;

  // Build nodes for each component
  for (const component of classInstance.components) {
    if (!component.name) continue;
    const tc0 = performance.now();
    const condition = evaluateCondition(component, classInstance);
    tCondition += performance.now() - tc0;
    if (condition === false) continue;

    const componentClassInstance = component.classInstance;
    if (!componentClassInstance) continue;
    componentCount++;

    const tp0 = performance.now();
    let componentTransform = computeIconPlacement(component);
    const autoLayout = !componentTransform;
    if (!componentTransform) {
      const icon = componentClassInstance.annotation("Icon", component) as IIcon | null;
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
    let componentMarkup = renderIconX6(componentClassInstance, component, false);
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

    // Build ports
    const ports: DiagramPort[] = [];
    const tpr0 = performance.now();
    for (const connector of componentClassInstance.components) {
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
      const extCenterOffY = connectorTransform.translateY - connectorTransform.originY + connectorTransform.height / 2;
      const connCenterX = connectorTransform.originX + extCenterOffX * Math.cos(a) - extCenterOffY * Math.sin(a);
      const connCenterY = connectorTransform.originY + extCenterOffX * Math.sin(a) + extCenterOffY * Math.cos(a);
      const portWidth = connectorTransform.width * absScaleX;
      const portHeight = connectorTransform.height * absScaleY;
      const desiredCenterX = absWidth / 2 + connCenterX * componentTransform.scaleX;
      const desiredCenterY = absHeight / 2 + connCenterY * componentTransform.scaleY;
      const cosA = Math.cos(a);
      const sinA = Math.sin(a);
      const portX = desiredCenterX - (portWidth / 2) * cosA + (portHeight / 2) * sinA;
      const portY = desiredCenterY - (portWidth / 2) * sinA - (portHeight / 2) * cosA;

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
    tPortRender += performance.now() - tpr0;

    const a = componentTransform.rotate * (Math.PI / 180);
    const relTranslateX = absWidth / 2 + componentTransform.translateX - componentTransform.originX;
    const relTranslateY = absHeight / 2 + componentTransform.translateY - componentTransform.originY;

    // Lightweight property metadata — expensive fields (parameters, docInfo,
    // docRevisions, iconSvg) are deferred to buildComponentProperties() and
    // loaded on-demand when the user clicks a node.
    const properties: ComponentPropertyData = {
      classKind: componentClassInstance.classKind,
      className: componentClassInstance.name ?? "",
      name: component.name ?? "",
      description: component.description ?? "",
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
  const allConnectionPaths: ({ points: { x: number; y: number }[] } | null)[] = [];

  for (const connectEquation of classInstance.connectEquations) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const c1 = connectEquation.componentReference1?.parts.map((c: any) => c.identifier?.text ?? "");
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const c2 = connectEquation.componentReference2?.parts.map((c: any) => c.identifier?.text ?? "");
    if (!c1 || !c2 || c1.length === 0 || c2.length === 0) continue;
    if (!nodeIds.has(c1[0]) || !nodeIds.has(c2[0])) continue;

    const line: ILine | null =
      typeof connectEquation.annotation === "function" ? connectEquation.annotation("Line") : null;
    const strokeColor = `rgb(${line?.color?.[0] ?? 0}, ${line?.color?.[1] ?? 0}, ${line?.color?.[2] ?? 255})`;
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

    edges.push({
      id: `${c1[0]}.${c1?.[1]}-${c2[0]}.${c2?.[1]}`,
      zIndex: 1,
      source: { cell: c1[0], port: c1?.[1] ?? "", anchor: "center", connectionPoint: { name: "anchor" } },
      target: { cell: c2[0], port: c2?.[1] ?? "", anchor: "center", connectionPoint: { name: "anchor" } },
      vertices: line?.points
        ?.slice(1, -1)
        ?.map((p) => convertPoint(p))
        .map((p) => ({ x: p[0], y: p[1] })),
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

    if (line?.points && line.points.length >= 2) {
      const convertedPts = line.points.map((p) => convertPoint(p)).map((p) => ({ x: p[0], y: p[1] }));
      allConnectionPaths.push({ points: convertedPts });
    } else {
      allConnectionPaths.push(null);
    }
  }

  // Coordinate system
  const diagram: IDiagram | null = classInstance.annotation("Diagram");
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
    for (const extendsClassInstance of ci.extendsClassInstances) {
      if (extendsClassInstance.classInstance) {
        collectGraphics(extendsClassInstance.classInstance);
      }
    }
    const diagram: IDiagram | null = ci.annotation("Diagram", ci);
    if (diagram?.graphics) {
      for (const graphicItem of diagram.graphics) {
        graphicItems.push(renderGraphicItemX6(graphicItem, defs, ci));
      }
    }
  }

  collectGraphics(classInstance);
  if (graphicItems.length === 0 && defs.length === 0) return null;

  const diagram: IDiagram | null = classInstance.annotation("Diagram", classInstance);
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

const iconCache = new Map<string, string>(); // name -> JSON stringified { svg: X6Markup, defs: X6Markup[] }

export function renderIconX6(
  classInstance: ModelicaClassInstance,
  componentInstance?: ModelicaComponentInstance,
  ports?: boolean,
  defs?: X6Markup[],
): X6Markup {
  const isRoot = !defs;
  const localDefs = defs ?? [];
  const isTopLevel = !ports;
  const cacheKey = classInstance.name
    ? classInstance.name + (componentInstance && componentInstance.name ? `|${componentInstance.name}` : "")
    : null;
  const canCache = isTopLevel && cacheKey;

  if (canCache && cacheKey) {
    const cached = iconCache.get(cacheKey);
    if (cached) {
      try {
        const parsed = JSON.parse(cached);
        if (parsed.defs && parsed.defs.length > 0) {
          localDefs.push(...parsed.defs);
        }
        // Return a clone to avoid mutating the cached SVG if it gets modified later
        return JSON.parse(JSON.stringify(parsed.svg));
      } catch {
        // Fallback to re-rendering
      }
    }
  }

  const defsStartLength = localDefs.length;
  const svg: X6Markup = {
    tagName: "svg",
    attrs: { width: "100%", height: "100%", style: "overflow: visible" },
    children: [],
  };

  for (const extendsClassInstance of classInstance.extendsClassInstances) {
    if (extendsClassInstance.classInstance && svg.children) {
      svg.children.push(renderIconX6(extendsClassInstance.classInstance, componentInstance, ports, localDefs));
    }
  }

  const icon: IIcon | null = classInstance.annotation("Icon", componentInstance);
  if (isRoot) {
    applyCoordinateSystemX6(svg, icon?.coordinateSystem, true);
  }

  if (!icon) {
    if (isRoot && localDefs.length > 0 && svg.children) {
      svg.children.unshift({ tagName: "defs", children: localDefs });
    }
    return svg;
  }

  if (!isRoot) {
    applyCoordinateSystemX6(svg, icon.coordinateSystem, false);
  }

  const group: X6Markup = { tagName: "g", children: [] };
  if (svg.children) svg.children.push(group);
  if (group.children) {
    for (const graphicItem of icon.graphics ?? []) {
      group.children.push(renderGraphicItemX6(graphicItem, localDefs, classInstance, componentInstance));
    }
  }

  if (ports && group.children) {
    for (const component of classInstance.components) {
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

  if (isRoot && localDefs.length > 0 && svg.children) {
    svg.children.unshift({ tagName: "defs", children: localDefs });
  }

  if (canCache && cacheKey) {
    try {
      const defsAdded = localDefs.slice(defsStartLength);
      // We don't cache the root-injected `<defs>` element, we cache the raw svg + defsAdded
      // to allow the caller to handle defs injection consistently.
      if (isRoot && svg.children?.[0]?.tagName === "defs") {
        const svgWithoutDefs = { ...svg, children: svg.children.slice(1) };
        iconCache.set(cacheKey, JSON.stringify({ svg: svgWithoutDefs, defs: defsAdded }));
      } else {
        iconCache.set(cacheKey, JSON.stringify({ svg, defs: defsAdded }));
      }
    } catch {
      // Ignore circular reference errors if any
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

function renderBitmapX6(graphicItem: IBitmap, defs: X6Markup[]): X6Markup {
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
            .map((cmd) => cmd.join(" "))
            .join(" "),
        },
      };
    } else {
      shape = {
        tagName: "polyline",
        attrs: { points: graphicItem.points?.map((p) => convertPoint(p, [0, 0]) ?? []).join(" ") },
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
        d: [...convertSmoothPath(graphicItem.points), ["Z"]].map((cmd) => cmd.join(" ")).join(" "),
      },
    };
  } else {
    shape = {
      tagName: "polygon",
      attrs: { points: graphicItem.points?.map((p) => convertPoint(p, [0, 0]) ?? []).join(" ") },
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

  // Text substitution — matches core svg.ts renderText() exactly
  const rawText = graphicItem.textString ?? graphicItem.string ?? "";
  const replacer = (_match: string, name: string): string => {
    // 1. Check if the specific component instance overrides this parameter
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const compArgExpr = (componentInstance?.modification as any)?.getModificationArgument(name)?.expression;
    const compVal = formatPropertyValue(compArgExpr);

    const namedElement = classInstance?.resolveName(name.split("."));

    // 2. Check if the class provides a default value for this parameter
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const elemExpr = (namedElement as any)?.modification?.expression;
    const elemVal = formatPropertyValue(elemExpr);

    const finalVal = compVal ?? elemVal;

    let unitString = "";
    if (namedElement && "classInstance" in namedElement) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const mod = (namedElement as ModelicaComponentInstance).classInstance?.modification as any;
      const unitExpr = mod?.getModificationArgument("unit")?.expression;
      const rawUnit = formatPropertyValue(unitExpr)?.replace(/^"|"$/g, "");
      if (rawUnit) unitString = " " + formatUnit(rawUnit);
    }

    if (finalVal !== undefined && finalVal !== "") {
      return finalVal + unitString;
    }

    return name;
  };
  const ESCAPED_PERCENT = "__PERCENT__";
  const textContent = rawText
    .replace(/%%/g, ESCAPED_PERCENT)
    .replace(/%name\b/g, componentInstance?.name ?? "%name")
    .replace(/%class\b/g, classInstance?.name ?? "%class")
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
  const textColor = convertColor(graphicItem.textColor, "rgb(0,0,0)");

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

  const fontStyle = graphicItem.textStyle?.find((e) => e === TextStyle.ITALIC) ? "italic" : "normal";
  const fontWeight = graphicItem.textStyle?.find((e) => e === TextStyle.BOLD) ? "bold" : "normal";
  const textDecoration = graphicItem.textStyle?.find((e) => e === TextStyle.UNDERLINE) ? "underline" : "none";

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
  const pattern = (filledShape.fillPattern ?? "None").toLowerCase();
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

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
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
  if (!defs.find((d) => d.attrs?.id === id)) {
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
  const childrenStr = markup.children?.map(x6MarkupToSvg).join("") ?? "";
  const text = markup.textContent ?? "";
  if (!childrenStr && !text) return `${open}/>`;
  return `${open}>${text}${childrenStr}</${markup.tagName}>`;
}

export function hasGraphicElements(node: X6Markup): boolean {
  const shapeTags = new Set(["rect", "ellipse", "circle", "polygon", "polyline", "path", "line", "image"]);
  if (shapeTags.has(node.tagName)) return true;
  return node.children?.some(hasGraphicElements) ?? false;
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

  if (markup.children) {
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
    return x6MarkupToSvg(markup);
  } catch {
    // ignore icon rendering errors
  }
  return undefined;
}

// ── On-demand component property builder ──
// Called lazily when the user clicks a component in the diagram.
// This avoids the expensive parameter/doc/icon computation during initial diagram load.

function processHtml(
  html: string | undefined,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  context: any,
): string | undefined {
  if (!html) return html;
  if (!context) return html;

  return html.replace(/<img\s+[^>]*src=(["'])modelica:\/\/([^"']+)\1[^>]*>/gi, (match, quote, uriPath) => {
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

export function buildComponentProperties(
  classInstance: ModelicaClassInstance,
  componentName: string,
): ComponentPropertyData | null {
  const component = classInstance.components.find((c) => c.name === componentName);
  if (!component) return null;

  const componentClassInstance = component.classInstance;
  if (!componentClassInstance) return null;

  // Extract parameters
  const parameters: ComponentPropertyData["parameters"] = [];
  for (const element of componentClassInstance.elements) {
    if (element instanceof ModelicaComponentInstance && element.variability === ModelicaVariability.PARAMETER) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const compArgExpr = (component.modification as any)?.getModificationArgument(element.name ?? "")?.expression;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const elemExpr = (element.modification as any)?.expression;
      const value = formatPropertyValue(compArgExpr) ?? formatPropertyValue(elemExpr) ?? "-";

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const unitExpr = (element.classInstance?.modification as any)?.getModificationArgument("unit")?.expression;
      const rawUnit = formatPropertyValue(unitExpr)?.replace(/^"|"$/g, "");
      const unit = rawUnit ? formatUnit(rawUnit) : undefined;
      const isBoolean = element.classInstance?.name === "Boolean";

      parameters.push({
        name: element.name ?? "",
        value,
        description: element.description ?? undefined,
        isBoolean,
        unit,
      });
    }
  }

  // Extract documentation
  const docAnnotation = componentClassInstance.annotation("Documentation") as {
    info?: string;
    revisions?: string;
  } | null;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const context = (classInstance as any).context;
  const docInfo = processHtml(docAnnotation?.info, context);
  const docRevisions = processHtml(docAnnotation?.revisions, context);

  // Render icon SVG
  const iconSvg = getClassIconSvg(componentClassInstance, 80, true);

  return {
    classKind: componentClassInstance.classKind,
    className: componentClassInstance.name ?? "",
    name: component.name ?? "",
    description: component.description ?? "",
    parameters,
    docInfo,
    docRevisions,
    iconSvg,
  };
}
