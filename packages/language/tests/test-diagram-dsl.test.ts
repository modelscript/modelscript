import { describe, expect, it } from "@jest/globals";
import { grammar } from "../src/dsl.js";

describe("Declarative 2D Diagram DSL Schema", () => {
  it("should allow declaring rich diagram configuration on grammar definition", () => {
    const testGrammar = grammar({
      name: "CircuitFlow",
      rules: {
        Root: ($) => $.Block,
        Block: ($) => "block",
        Wire: ($) => "wire",
        Port: ($) => "port",
      },
      diagram: {
        views: {
          Schematic: {
            label: "Schematic Diagram",
            defaultLayout: "manual",
          },
          ComponentView: {
            label: "Internal Block Diagram",
            defaultLayout: "dagre",
          },
        },
        nodes: {
          Block: {
            label: "Block",
            shape: "rect",
            style: {
              fill: "#e3f2fd",
              stroke: "#1565c0",
              strokeWidth: 2,
              rx: 4,
              ry: 4,
            },
            placement: {
              annotationField: "Block",
              schema: "modelica",
              invertY: true,
            },
            ports: {
              group: "auto",
              style: { fill: "#43a047", stroke: "#ffffff", size: 6 },
            },
            compartments: [
              {
                header: "parameters",
                query: "Block",
                itemLabel: () => "R = 100",
              },
            ],
          },
        },
        edges: {
          Wire: {
            source: "Wire",
            target: "Wire",
            sourcePort: "Port",
            targetPort: "Port",
            style: {
              router: "manhattan",
              connector: "jumpover",
              stroke: "#0d47a1",
              strokeWidth: 2,
            },
          },
        },
        mutations: {
          createEdge: (src, tgt) => `wire ${src} -> ${tgt};\n`,
          createNode: (type, name, x, y) => `${type} ${name} @pos(${x}, ${y});\n`,
        },
      },
    });

    expect(testGrammar.name).toBe("CircuitFlow");
    expect(testGrammar.diagram).toBeDefined();
    expect(testGrammar.diagram?.views?.Schematic.label).toBe("Schematic Diagram");
    expect(testGrammar.diagram?.nodes?.Block?.shape).toBe("rect");
    expect(testGrammar.diagram?.nodes?.Block?.placement?.schema).toBe("modelica");
    expect(testGrammar.diagram?.edges?.Wire?.style?.connector).toBe("jumpover");
    expect(testGrammar.diagram?.mutations?.createEdge?.("A.p", "B.n")).toBe("wire A.p -> B.n;\n");
  });

  it("should support SysML2 viewpoints, Modelica property value bindings, and DynamicSelect animation channels", () => {
    const cyberPhysicalGrammar = grammar({
      name: "CyberPhysicalSystem",
      rules: {
        Root: ($) => $.Component,
        Component: ($) => "component",
        Connection: ($) => "connection",
      },
      diagram: {
        // 1. SysML2 Views & Viewpoints
        views: {
          StructuralView: {
            label: "Structural Hierarchy (BDD)",
            viewpoint: "StructuralViewpoint",
            expose: ["VehiclePkg::*"],
            filter: (db, node) => db.ast.getType(node) === 1,
            defaultLayout: "dagre",
          },
          InternalInterconnectView: {
            label: "Internal Block Diagram (IBD)",
            viewpoint: "InterconnectionViewpoint",
            expose: ["VehiclePkg::Powertrain::*"],
            filter: (db, node) => db.ast.getType(node) === 1,
            defaultLayout: "manual",
          },
          AnimationView: {
            label: "Simulation Animation (Live 60 FPS)",
            viewpoint: "DynamicBehaviorViewpoint",
            defaultLayout: "manual",
          },
        },

        // 2. Nodes with Modelica Parameter Bindings and DynamicSelect Animation Channels
        nodes: {
          Component: {
            label: "%name",
            stereotype: "«part»",
            shape: "rect",

            // Parameter macro expansion & property value bindings
            propertyBindings: {
              label: "%name: %R Ω",
              tooltip: "Component: %name (%class)\nValue: %R",
              fillColor: "%customColor",
            },

            // DynamicSelect Simulation Animation Channels
            animation: {
              selectFunction: "DynamicSelect",
              channels: [
                {
                  attribute: "rotation",
                  signal: "phi", // Live simulation variable: shaft rotation angle
                  transform: (db, node, angle) => (angle * 180) / Math.PI,
                },
                {
                  attribute: "fill",
                  signal: "active", // Live state variable: boolean / integer state
                  transform: (db, node, active) => (active > 0.5 ? "#22c55e" : "#ef4444"),
                },
                {
                  attribute: "extent",
                  signal: "liquidLevel", // Live variable: tank level animation
                  transform: (db, node, level) => [
                    [0, 0],
                    [100, Math.max(0, Math.min(100, level))],
                  ],
                },
                {
                  attribute: "text",
                  signal: "voltage", // Live readout display
                  transform: (db, node, v) => `${v.toFixed(2)} V`,
                },
              ],
            },
          },
        },

        // 3. Edges with flow animation channels
        edges: {
          Connection: {
            source: "Component",
            target: "Component",
            style: {
              router: "manhattan",
              connector: "jumpover",
            },
            animation: {
              channels: [
                {
                  attribute: "stroke",
                  signal: "current",
                  transform: (db, edge, current) => (Math.abs(current) > 0.01 ? "#3b82f6" : "#9ca3af"),
                },
              ],
            },
          },
        },
      },
    });

    const d = cyberPhysicalGrammar.diagram;
    expect(d).toBeDefined();

    // Verify SysML2 Views & Viewpoints
    expect(d?.views?.StructuralView.viewpoint).toBe("StructuralViewpoint");
    expect(d?.views?.StructuralView.expose).toEqual(["VehiclePkg::*"]);
    expect(d?.views?.InternalInterconnectView.defaultLayout).toBe("manual");

    // Verify Modelica Property Bindings
    const compNode = d?.nodes?.Component;
    expect(compNode?.propertyBindings?.label).toBe("%name: %R Ω");
    expect(compNode?.propertyBindings?.tooltip).toContain("%name (%class)");

    // Verify DynamicSelect Animation Channels
    const anim = compNode?.animation;
    expect(anim?.selectFunction).toBe("DynamicSelect");
    expect(anim?.channels).toHaveLength(4);

    const rotChannel = anim?.channels?.find((c) => c.attribute === "rotation");
    expect(rotChannel?.signal).toBe("phi");
    expect(rotChannel?.transform?.({} as any, 0, Math.PI)).toBeCloseTo(180);

    const fillChannel = anim?.channels?.find((c) => c.attribute === "fill");
    expect(fillChannel?.signal).toBe("active");
    expect(fillChannel?.transform?.({} as any, 0, 1.0)).toBe("#22c55e");
    expect(fillChannel?.transform?.({} as any, 0, 0.0)).toBe("#ef4444");

    const textChannel = anim?.channels?.find((c) => c.attribute === "text");
    expect(textChannel?.signal).toBe("voltage");
    expect(textChannel?.transform?.({} as any, 0, 12.3456)).toBe("12.35 V");

    const edgeAnim = d?.edges?.Connection?.animation;
    expect(edgeAnim?.channels?.[0].signal).toBe("current");
    expect(edgeAnim?.channels?.[0].transform?.({} as any, 0, 1.5)).toBe("#3b82f6");
    expect(edgeAnim?.channels?.[0].transform?.({} as any, 0, 0.0)).toBe("#9ca3af");
  });

  it("should support dynamic in-model view discovery, graphic item annotations, and DynamicSelect AST evaluation", () => {
    const dynamicModelLang = grammar({
      name: "DynamicPolyglot",
      rules: {
        Root: ($) => choice($.ViewUsage, $.ClassDef),
        ViewUsage: ($) => "view",
        ViewpointDef: ($) => "viewpoint",
        ClassDef: ($) => "class",
      },
      diagram: {
        // 1. Dynamic In-Model View & Viewpoint Discovery (SysML2)
        inModelViews: {
          viewRule: "ViewUsage",
          viewpointRule: "ViewpointDef",
          nameField: "name",
          viewpointField: "viewpoint",
          exposeField: "expose",
          filterField: "filter",
          evaluateFilter: () => true,
          evaluateExpose: () => ({ hasNext: () => false, next: () => 0, release: () => {} }),
        },

        // 2. Dynamic In-Model Graphic Annotations (Modelica Icon & Diagram)
        annotations: {
          annotationField: "annotationClause",
          iconSection: "Icon",
          diagramSection: "Diagram",
          primitives: {
            Rectangle: { extent: "extent", fill: "fillColor", stroke: "lineColor", radius: "radius" },
            Ellipse: { extent: "extent", fill: "fillColor", stroke: "lineColor" },
            Line: { points: "points", stroke: "color", thickness: "thickness" },
            Text: { extent: "extent", textString: "textString", color: "lineColor" },
          },
          resolveTemplate: (db, template) => template.replace("%name", "Resistor1"),
        },

        // 3. Dynamic In-Model DynamicSelect Evaluation
        dynamicSelect: {
          functionName: "DynamicSelect",
          extract: () => ({ staticExpr: 10, dynamicExpr: 20 }),
          evaluateDynamic: (db, exprNode, getState) => (getState("temp") > 100 ? "#ff0000" : "#00ff00"),
        },
      },
    });

    const d = dynamicModelLang.diagram;
    expect(d?.inModelViews).toBeDefined();
    expect(d?.inModelViews?.viewRule).toBe("ViewUsage");
    expect(d?.inModelViews?.nameField).toBe("name");

    expect(d?.annotations).toBeDefined();
    expect(d?.annotations?.iconSection).toBe("Icon");
    expect(d?.annotations?.primitives?.Rectangle?.extent).toBe("extent");
    expect(d?.annotations?.resolveTemplate?.({} as any, "%name", 1)).toBe("Resistor1");

    expect(d?.dynamicSelect).toBeDefined();
    expect(d?.dynamicSelect?.functionName).toBe("DynamicSelect");
    expect(d?.dynamicSelect?.evaluateDynamic?.({} as any, 20, (v) => (v === "temp" ? 150 : 0))).toBe("#ff0000");
    expect(d?.dynamicSelect?.evaluateDynamic?.({} as any, 20, (v) => (v === "temp" ? 50 : 0))).toBe("#00ff00");
  });

  it("should support universal in-language expression evaluation without hardcoded functions or signal names", () => {
    const universalLang = grammar({
      name: "UniversalReactiveFlow",
      rules: {
        Root: ($) => choice($.Node, $.Wire),
        Node: ($) => "node",
        Wire: ($) => "wire",
      },
      diagram: {
        // Universal in-language expression evaluator: works identically for static design-time and live simulation
        evaluator: {
          evaluate: (db, exprNode, env) => {
            // Evaluates any in-language AST expression against the environment
            if (exprNode === 101) {
              const temp = env.getNumber("temp");
              return temp > 100 ? "#ef4444" : "#22c55e";
            }
            if (exprNode === 102) {
              const speed = env.getNumber("speed");
              return speed * 1.5;
            }
            return env.get("default");
          },
          splitStaticDynamic: (db, exprNode) => ({ staticNode: exprNode, dynamicNode: exprNode }),
        },

        entities: {
          Node: {
            label: "Node",
            shape: "rect",
            spatial: { autoLayout: "dagre" },
          },
        },
      },
    });

    const d = universalLang.diagram;
    expect(d?.evaluator).toBeDefined();

    // Design-time environment (static defaults / parameters)
    const staticEnv = {
      get: () => "static",
      getNumber: (k: string) => (k === "temp" ? 25 : 0),
      getString: () => "",
      getBoolean: () => false,
    };
    expect(d?.evaluator?.evaluate?.({} as any, 101, staticEnv)).toBe("#22c55e");

    // Simulation runtime environment (live state stream)
    const liveSimEnv = {
      get: () => "live",
      getNumber: (k: string) => (k === "temp" ? 180 : 0),
      getString: () => "",
      getBoolean: () => false,
      time: 4.5,
    };
    expect(d?.evaluator?.evaluate?.({} as any, 101, liveSimEnv)).toBe("#ef4444");
  });

  it("should support dynamic node render functions and custom vector glyphs without hardcoded annotation structures", () => {
    const vectorLang = grammar({
      name: "VectorGlyphLang",
      rules: {
        Root: ($) => $.CustomGlyph,
        CustomGlyph: ($) => "glyph",
      },
      diagram: {
        entities: {
          CustomGlyph: {
            // Dynamic render function: constructs vector shapes from AST without any hardcoded annotation requirements
            render: () => [
              { type: "circle", cx: 50, cy: 50, r: 40, style: { fill: "#3b82f6", stroke: "#1d4ed8" } },
              { type: "path", d: "M 30 50 L 70 50 M 50 30 L 50 70", style: { stroke: "#ffffff", strokeWidth: 3 } },
              { type: "text", x: 50, y: 105, text: "Plus Gate", style: { textColor: "#1e293b" } },
            ],
          },
        },
      },
    });

    const d = vectorLang.diagram;
    expect(d?.entities?.CustomGlyph?.render).toBeDefined();

    const elements = d?.entities?.CustomGlyph?.render?.({} as any, 1, {} as any);
    expect(elements).toHaveLength(3);
    expect(elements?.[0].type).toBe("circle");
    expect(elements?.[0].r).toBe(40);
    expect(elements?.[1].type).toBe("path");
    expect(elements?.[2].type).toBe("text");
    expect(elements?.[2].text).toBe("Plus Gate");
  });

  it("should maintain 100% parity with X6/SVG nested container hierarchy (svg, defs, g, linearGradient)", () => {
    const modelicaStyleLang = grammar({
      name: "ModelicaSchematic",
      rules: {
        Root: ($) => $.Resistor,
        Resistor: ($) => "resistor",
      },
      diagram: {
        entities: {
          Resistor: {
            // Hierarchical SVG container tree matching Modelica Icon markup
            render: () => [
              {
                tagName: "svg",
                attrs: { viewBox: "-100 -100 200 200", overflow: "visible" },
                children: [
                  {
                    tagName: "defs",
                    children: [
                      {
                        tagName: "linearGradient",
                        attrs: { id: "resistorGrad", x1: "0%", y1: "0%", x2: "100%", y2: "0%" },
                        children: [
                          { tagName: "stop", attrs: { offset: "0%", "stop-color": "#e0e7ff" } },
                          { tagName: "stop", attrs: { offset: "100%", "stop-color": "#818cf8" } },
                        ],
                      },
                    ],
                  },
                  {
                    tagName: "g",
                    attrs: { transform: "rotate(0)" },
                    children: [
                      {
                        tagName: "rect",
                        attrs: {
                          x: -70,
                          y: -20,
                          width: 140,
                          height: 40,
                          fill: "url(#resistorGrad)",
                          stroke: "#4338ca",
                          "stroke-width": 2,
                        },
                      },
                      {
                        tagName: "line",
                        attrs: { x1: -100, y1: 0, x2: -70, y2: 0, stroke: "#4338ca", "stroke-width": 2 },
                      },
                      {
                        tagName: "line",
                        attrs: { x1: 70, y1: 0, x2: 100, y2: 0, stroke: "#4338ca", "stroke-width": 2 },
                      },
                      {
                        tagName: "text",
                        textContent: "%name",
                        attrs: { x: 0, y: -30, "text-anchor": "middle", fill: "#1e1b4b" },
                      },
                    ],
                  },
                ],
              },
            ],
          },
        },
      },
    });

    const d = modelicaStyleLang.diagram;
    const rendered = d?.entities?.Resistor?.render?.({} as any, 1, {} as any);
    expect(rendered).toHaveLength(1);

    const svgRoot = rendered?.[0];
    expect(svgRoot?.tagName).toBe("svg");
    expect(svgRoot?.attrs?.viewBox).toBe("-100 -100 200 200");
    expect(svgRoot?.children).toHaveLength(2);

    const defs = svgRoot?.children?.[0];
    expect(defs?.tagName).toBe("defs");
    expect(defs?.children?.[0].tagName).toBe("linearGradient");

    const group = svgRoot?.children?.[1];
    expect(group?.tagName).toBe("g");
    expect(group?.children).toHaveLength(4);
    expect(group?.children?.[0].tagName).toBe("rect");
    expect(group?.children?.[3].textContent).toBe("%name");
  });
});
