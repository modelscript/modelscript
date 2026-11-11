// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert";
import { describe, it } from "node:test";
import { showAlignmentToolbar, type AlignableNode } from "../src/alignment.js";
import {
  alignNodeSelectionBox,
  ensurePatchedSegmentsTool,
  ensurePatchedTransformTool,
  ensurePatchedVerticesTool,
  getEdgeToolConfig,
  resolveEdgeSelectionStyle,
  syncAllNodeSelectionBoxes,
  updateNodeVisualOnResize,
  type GraphLike,
  type NodeLike,
} from "../src/selection-handles.js";

describe("Diagram Selection Handles and Box Rotation", () => {
  it("aligns and rotates selection box for rotated nodes", () => {
    const mockBox = {
      style: {} as Record<string, string>,
    } as unknown as HTMLElement;

    const mockNode = {
      id: "comp1",
      isNode: () => true,
      getBBox: () => ({ x: 100, y: 150, width: 80, height: 60 }),
      getAngle: () => 45,
    } as unknown as NodeLike;

    const mockGraph = {
      matrix: () => ({ a: 2, d: 2, e: 50, f: 30 }),
    } as unknown as GraphLike;

    alignNodeSelectionBox(mockBox, mockNode, mockGraph);

    assert.strictEqual(mockBox.style.position, "absolute");
    assert.strictEqual(mockBox.style.left, `${100 * 2 + 50}px`);
    assert.strictEqual(mockBox.style.top, `${150 * 2 + 30}px`);
    assert.strictEqual(mockBox.style.width, `${80 * 2}px`);
    assert.strictEqual(mockBox.style.height, `${60 * 2}px`);
    assert.strictEqual(mockBox.style.transform, "rotate(45deg)");
    assert.strictEqual(mockBox.style.transformOrigin, "center center");
    assert.strictEqual(mockBox.style.margin, "-5px 0 0 -5px");
    assert.strictEqual(mockBox.style.padding, "4px");
    assert.strictEqual(mockBox.style.boxSizing, "content-box");
  });

  it("does not apply rotation transform when node angle is 0", () => {
    const mockBox = {
      style: {} as Record<string, string>,
    } as unknown as HTMLElement;

    const mockNode = {
      id: "comp2",
      isNode: () => true,
      getBBox: () => ({ x: 200, y: 200, width: 50, height: 50 }),
      getAngle: () => 0,
    } as unknown as NodeLike;

    const mockGraph = {
      matrix: () => ({ a: 1, d: 1, e: 0, f: 0 }),
    } as unknown as GraphLike;

    alignNodeSelectionBox(mockBox, mockNode, mockGraph);

    assert.strictEqual(mockBox.style.transform, "");
    assert.strictEqual(mockBox.style.left, "200px");
    assert.strictEqual(mockBox.style.top, "200px");
    assert.strictEqual(mockBox.style.width, "50px");
    assert.strictEqual(mockBox.style.height, "50px");
  });

  it("normalizes negative and full-circle angles", () => {
    const mockBox = {
      style: {} as Record<string, string>,
    } as unknown as HTMLElement;

    const mockNode = {
      id: "comp3",
      isNode: () => true,
      getBBox: () => ({ x: 0, y: 0, width: 40, height: 40 }),
      getAngle: () => -90,
    } as unknown as NodeLike;

    const mockGraph = {
      matrix: () => ({ a: 1, d: 1, e: 0, f: 0 }),
    } as unknown as GraphLike;

    alignNodeSelectionBox(mockBox, mockNode, mockGraph);
    assert.strictEqual(mockBox.style.transform, "rotate(270deg)");
  });

  it("synchronizes all node selection boxes in the container", () => {
    const boxes = [
      {
        getAttribute: (attr: string) => (attr === "data-cell-id" ? "nodeA" : null),
        style: {} as Record<string, string>,
      },
      {
        getAttribute: (attr: string) => (attr === "data-cell-id" ? "nodeB" : null),
        style: {} as Record<string, string>,
      },
    ];

    const mockContainer = {
      querySelectorAll: () => boxes,
    } as unknown as HTMLElement;

    const nodes: Record<string, NodeLike> = {
      nodeA: {
        id: "nodeA",
        isNode: () => true,
        getBBox: () => ({ x: 10, y: 10, width: 20, height: 20 }),
        getAngle: () => 30,
      } as unknown as NodeLike,
      nodeB: {
        id: "nodeB",
        isNode: () => true,
        getBBox: () => ({ x: 50, y: 50, width: 30, height: 30 }),
        getAngle: () => 90,
      } as unknown as NodeLike,
    };

    const mockGraph = {
      getCellById: (id: string) => nodes[id] ?? null,
      matrix: () => ({ a: 1, d: 1, e: 0, f: 0 }),
    } as unknown as GraphLike;

    syncAllNodeSelectionBoxes(mockGraph, mockContainer);

    assert.strictEqual(boxes[0].style.transform, "rotate(30deg)");
    assert.strictEqual(boxes[1].style.transform, "rotate(90deg)");
  });

  it("generates refined, scaled edge tool configurations", () => {
    const mockGraphZoomed = {
      zoom: () => 3.0,
    } as unknown as GraphLike;

    const toolsLight = getEdgeToolConfig({} as any, mockGraphZoomed, false) as {
      name: string;
      args: { attrs: Record<string, unknown> };
    }[];

    const vertTool = toolsLight.find((t) => t.name === "vertices");
    assert.ok(vertTool, "Vertices tool must be configured");
    assert.strictEqual(vertTool.args.attrs.fill, "#ffffff");
    assert.strictEqual(vertTool.args.attrs.stroke, "#0284c7");
    assert.strictEqual(vertTool.args.attrs.strokeWidth, 1.5);
    // At zoom 3.0, radius should be scaled down to prevent oversized handles
    const r = vertTool.args.attrs.r as number;
    assert.ok(r <= 2.2, `Radius at zoom 3.0 should be <= 2.2, got ${r}`);

    const segTool = toolsLight.find((t) => t.name === "segments");
    assert.ok(segTool, "Segments tool must be configured");
    assert.strictEqual(segTool.args.attrs.fill, "#ffffff");
    assert.strictEqual(segTool.args.attrs.stroke, "#0284c7");

    const toolsDark = getEdgeToolConfig({} as any, mockGraphZoomed, true) as {
      name: string;
      args: { attrs: Record<string, unknown> };
    }[];
    const vertToolDark = toolsDark.find((t) => t.name === "vertices");
    assert.strictEqual(vertToolDark?.args.attrs.fill, "#1e293b");
    assert.strictEqual(vertToolDark?.args.attrs.stroke, "#38bdf8");
  });

  it("resolves language-adaptive edge selection styles", () => {
    // Physical circuits & EDA -> Minimalist
    assert.strictEqual(resolveEdgeSelectionStyle("modelica"), "minimalist");
    assert.strictEqual(resolveEdgeSelectionStyle("mo"), "minimalist");
    assert.strictEqual(resolveEdgeSelectionStyle("spice"), "minimalist");
    assert.strictEqual(resolveEdgeSelectionStyle("cir"), "minimalist");
    assert.strictEqual(resolveEdgeSelectionStyle("pscad"), "minimalist");
    assert.strictEqual(resolveEdgeSelectionStyle("opendss"), "minimalist");
    assert.strictEqual(resolveEdgeSelectionStyle("verilog-a"), "minimalist");

    // Systems, Block Diagrams & Controls -> Floating HUD
    assert.strictEqual(resolveEdgeSelectionStyle("sysml"), "hud");
    assert.strictEqual(resolveEdgeSelectionStyle("sysml2"), "hud");
    assert.strictEqual(resolveEdgeSelectionStyle("simulink"), "hud");
    assert.strictEqual(resolveEdgeSelectionStyle("slx"), "hud");
    assert.strictEqual(resolveEdgeSelectionStyle("easy5"), "hud");
    assert.strictEqual(resolveEdgeSelectionStyle("plcopen"), "hud");

    // Fluids & Process Networks -> Flow Trace
    assert.strictEqual(resolveEdgeSelectionStyle("olga"), "trace");
    assert.strictEqual(resolveEdgeSelectionStyle("swmm"), "trace");
    assert.strictEqual(resolveEdgeSelectionStyle("lps"), "trace");
    assert.strictEqual(resolveEdgeSelectionStyle("epanet"), "trace");

    // Ontologies, Knowledge Graphs & Default -> Precision Halo
    assert.strictEqual(resolveEdgeSelectionStyle("owl2"), "halo");
    assert.strictEqual(resolveEdgeSelectionStyle("oscal"), "halo");
    assert.strictEqual(resolveEdgeSelectionStyle(undefined), "halo");

    // Explicit user preference overrides language default
    assert.strictEqual(resolveEdgeSelectionStyle("modelica", "hud"), "hud");
    assert.strictEqual(resolveEdgeSelectionStyle("sysml2", "minimalist"), "minimalist");
    assert.strictEqual(resolveEdgeSelectionStyle("modelica", "auto"), "minimalist");
  });

  it("omits segment midpoint handles in minimalist mode to avoid schematic clutter", () => {
    const mockGraph = { zoom: () => 1.0 } as unknown as GraphLike;

    // Minimalist mode (e.g. Modelica)
    const toolsMinimal = getEdgeToolConfig({} as any, mockGraph, false, "minimalist") as { name: string }[];
    assert.ok(
      toolsMinimal.find((t) => t.name === "vertices"),
      "Vertices handles must be present",
    );
    assert.strictEqual(
      toolsMinimal.find((t) => t.name === "segments"),
      undefined,
      "Segment handles must be omitted in minimalist mode",
    );

    // HUD / Halo mode
    const toolsHud = getEdgeToolConfig({} as any, mockGraph, false, "hud") as { name: string }[];
    assert.ok(
      toolsHud.find((t) => t.name === "vertices"),
      "Vertices handles must be present",
    );
    assert.ok(
      toolsHud.find((t) => t.name === "segments"),
      "Segment handles must be present in HUD mode",
    );
  });

  it("configures stopPropagation and processHandle on edge tools to prevent tool destruction and allow contextmenu removal", () => {
    const mockGraph = { zoom: () => 1.0 } as unknown as GraphLike;
    const tools = getEdgeToolConfig({} as any, mockGraph, false, "halo") as {
      name: string;
      args: {
        stopPropagation?: boolean;
        processHandle?: (handle: unknown) => void;
      };
    }[];

    const vertTool = tools.find((t) => t.name === "vertices");
    assert.ok(vertTool);
    assert.strictEqual(vertTool.args.stopPropagation, true);
    assert.deepStrictEqual((vertTool.args as any).modifiers, ["alt", "ctrl", "meta"]);
    assert.strictEqual(typeof vertTool.args.processHandle, "function");

    // Test processHandle delegates contextmenu to emit remove
    let delegatedEvents: Record<string, unknown> | null = null;
    let emittedEvent: string | null = null;
    const mockHandle = {
      delegateEvents: (events: Record<string, unknown>) => {
        delegatedEvents = events;
      },
      emit: (evt: string) => {
        emittedEvent = evt;
      },
    };

    vertTool.args.processHandle!(mockHandle);
    assert.ok(delegatedEvents);
    assert.strictEqual(typeof (delegatedEvents as any).contextmenu, "function");

    // Trigger contextmenu
    let prevented = false;
    let stopped = false;
    const fakeEvent = {
      preventDefault: () => {
        prevented = true;
      },
      stopPropagation: () => {
        stopped = true;
      },
    } as unknown as MouseEvent;

    (delegatedEvents as any).contextmenu(fakeEvent);
    assert.strictEqual(prevented, true);
    assert.strictEqual(stopped, true);
    assert.strictEqual(emittedEvent, "remove");

    const segTool = tools.find((t) => t.name === "segments");
    assert.ok(segTool);
    assert.strictEqual(segTool.args.stopPropagation, true);
  });

  it("clamps dynamically scaled vertex radius within bounds across extreme zoom levels", () => {
    // Very zoomed in (e.g. 10x): radius should clamp to lower bound 0.6
    const mockGraphZoom10 = { zoom: () => 10.0 } as unknown as GraphLike;
    const toolsZoom10 = getEdgeToolConfig({} as any, mockGraphZoom10, false) as {
      name: string;
      args: { attrs: { r: number } };
    }[];
    const r10 = toolsZoom10.find((t) => t.name === "vertices")!.args.attrs.r;
    assert.ok(r10 >= 0.55 && r10 <= 0.65, `Expected clamped lower bound ~0.6, got ${r10}`);

    // Very zoomed out (e.g. 0.1x): radius should clamp to upper bound 6.0
    const mockGraphZoom01 = { zoom: () => 0.1 } as unknown as GraphLike;
    const toolsZoom01 = getEdgeToolConfig({} as any, mockGraphZoom01, false) as {
      name: string;
      args: { attrs: { r: number } };
    }[];
    const r01 = toolsZoom01.find((t) => t.name === "vertices")!.args.attrs.r;
    assert.strictEqual(r01, 6.0, `Expected clamped upper bound 6.0, got ${r01}`);
  });

  it("ensurePatchedVerticesTool patches Vertices onPathMouseDown to reuse nearby handles and avoid duplicate vertices", () => {
    let insertedVertexCount = 0;
    let existingHandleMouseDownCalled = false;

    class MockVertices {
      cid = "tool-1";
      handles: any[] = [
        {
          onMouseDown: () => {
            existingHandleMouseDownCalled = true;
          },
        },
      ];
      cellView = {
        cell: {
          getVertices: () => [{ x: 100, y: 100 }],
          startBatch: () => {},
          insertVertex: () => {
            insertedVertexCount++;
          },
          stopBatch: () => {},
        },
        getVertexIndex: () => 0,
      };
      graph = {
        snapToGrid: (x: number, y: number) => ({
          toJSON: () => ({ x, y }),
        }),
      };
      allowAddVertex() {
        return true;
      }
      normalizeEvent(e: any) {
        return e;
      }
      snapVertex() {}
      render() {}
      eventData() {}
    }

    const mockX6 = {
      Registry: {
        EdgeTool: {
          presets: {
            vertices: MockVertices,
          },
        },
      },
    };

    ensurePatchedVerticesTool(mockX6);

    const instance = new MockVertices() as any;
    // Click at (102, 102), which is within 8px of existing vertex (100, 100)
    instance.onPathMouseDown({ clientX: 102, clientY: 102, stopPropagation: () => {}, preventDefault: () => {} });

    // Should NOT insert a new vertex; should reuse existing handle
    assert.strictEqual(insertedVertexCount, 0, "Must not insert a duplicate vertex when clicking near existing vertex");
    assert.strictEqual(existingHandleMouseDownCalled, true, "Must delegate to existing handle onMouseDown");
  });

  it("ensurePatchedVerticesTool safely aborts batch when handle cannot be created and never throws TypeError onMouseDown", () => {
    let stoppedBatchName: string | null = null;
    let startedBatchName: string | null = null;

    class MockVerticesWithPrunedVertex {
      cid = "tool-2";
      // Suppose handles array is empty (e.g. collinear pruning or reset during change)
      handles: any[] = [];
      cellView = {
        cell: {
          getVertices: () => [],
          startBatch: (name: string) => {
            startedBatchName = name;
          },
          insertVertex: () => {},
          stopBatch: (name: string) => {
            stoppedBatchName = name;
          },
        },
        getVertexIndex: () => 0,
      };
      graph = {
        snapToGrid: (x: number, y: number) => ({
          toJSON: () => ({ x, y }),
        }),
      };
      allowAddVertex() {
        return true;
      }
      normalizeEvent(e: any) {
        return e;
      }
      snapVertex() {}
      render() {
        // handles remain empty
        this.handles = [];
      }
      eventData() {}
    }

    const mockX6 = {
      Registry: {
        EdgeTool: {
          presets: {
            vertices: MockVerticesWithPrunedVertex,
          },
        },
      },
    };

    ensurePatchedVerticesTool(mockX6);

    const instance = new MockVerticesWithPrunedVertex() as any;
    // This previously threw: Uncaught TypeError: Cannot read properties of undefined (reading 'onMouseDown')
    assert.doesNotThrow(() => {
      instance.onPathMouseDown({ clientX: 200, clientY: 200, stopPropagation: () => {}, preventDefault: () => {} });
    });

    assert.strictEqual(startedBatchName, "add-vertex");
    assert.strictEqual(stoppedBatchName, "add-vertex", "Must stop batch to prevent freezing diagram canvas");
  });

  it("ensurePatchedVerticesTool requires modifier key (Alt/Ctrl/Meta) to insert new vertices on edge path", () => {
    let insertedVertexCount = 0;
    let startedBatchName: string | null = null;
    let existingHandleMouseDownCalled = false;

    class MockVerticesWithModifiers {
      cid = "tool-mod";
      options = {
        modifiers: ["alt", "ctrl", "meta"],
        addable: true,
      };
      handles: any[] = [
        {
          onMouseDown: () => {
            existingHandleMouseDownCalled = true;
          },
        },
      ];
      cellView = {
        cell: {
          getVertices: () => [{ x: 50, y: 50 }],
          startBatch: (name: string) => {
            startedBatchName = name;
          },
          insertVertex: () => {
            insertedVertexCount++;
          },
          stopBatch: () => {},
        },
        getVertexIndex: () => 1,
      };
      graph = {
        snapToGrid: (x: number, y: number) => ({
          toJSON: () => ({ x, y }),
        }),
      };
      allowAddVertex(e: any) {
        return Boolean(e.altKey || e.ctrlKey || e.metaKey);
      }
      normalizeEvent(e: any) {
        return e;
      }
      snapVertex() {}
      render() {
        this.handles.push({ onMouseDown: () => {} });
      }
      eventData() {}
    }

    const mockX6 = {
      Registry: {
        EdgeTool: {
          presets: {
            vertices: MockVerticesWithModifiers,
          },
        },
      },
    };

    ensurePatchedVerticesTool(mockX6);

    const instance = new MockVerticesWithModifiers() as any;

    // 1. Plain click on wire (no modifier) at (200, 200) -> MUST NOT insert vertex
    instance.onPathMouseDown({ clientX: 200, clientY: 200, stopPropagation: () => {}, preventDefault: () => {} });
    assert.strictEqual(insertedVertexCount, 0, "Must not insert vertex when clicking edge without Alt/Ctrl");
    assert.strictEqual(startedBatchName, null, "Must not start batch without modifier");

    // 2. Click near existing vertex (52, 52) without modifier -> MUST reuse existing handle
    instance.onPathMouseDown({ clientX: 52, clientY: 52, stopPropagation: () => {}, preventDefault: () => {} });
    assert.strictEqual(insertedVertexCount, 0, "Must not insert duplicate vertex near existing handle");
    assert.strictEqual(existingHandleMouseDownCalled, true, "Must delegate to existing handle onMouseDown");

    // 3. Click with altKey: true at (200, 200) -> MUST insert vertex
    instance.onPathMouseDown({
      clientX: 200,
      clientY: 200,
      altKey: true,
      stopPropagation: () => {},
      preventDefault: () => {},
    });
    assert.strictEqual(insertedVertexCount, 1, "Must insert vertex when Alt is held");
    assert.strictEqual(startedBatchName, "add-vertex");

    // 4. Click with ctrlKey: true at (300, 300) -> MUST insert vertex
    instance.onPathMouseDown({
      clientX: 300,
      clientY: 300,
      ctrlKey: true,
      stopPropagation: () => {},
      preventDefault: () => {},
    });
    assert.strictEqual(insertedVertexCount, 2, "Must insert vertex when Ctrl is held");
  });

  it("ensurePatchedSegmentsTool preserves pinned port anchors and heals orthogonal vertices after segment drag", () => {
    let removedPropPath: string[] | null = null;
    let setVerticesCalledWith: any = null;

    const mockEdge: any = {
      getSource: () => ({ cell: "nodeA", port: "p" }),
      getTarget: () => ({ cell: "nodeB", port: "p" }),
      prop: (path: string[]) => {
        if (path[0] === "source" && path[1] === "anchor") return { x: 40, y: 20 };
        return null;
      },
      removeProp: (path: string[]) => {
        removedPropPath = path;
      },
      getSourcePoint: () => ({ x: 0, y: 0 }),
      getTargetPoint: () => ({ x: 100, y: 100 }),
      getVertices: () => [
        { x: 50, y: 0.2 }, // slight non-orthogonal float drift
        { x: 50, y: 99.8 },
      ],
      setVertices: (v: any) => {
        setVerticesCalledWith = v;
      },
    };

    class MockSegmentsTool {
      cellView = {
        cell: mockEdge,
        sourceAnchor: { x: 0, y: 0 },
        targetAnchor: { x: 100, y: 100 },
      };
      onHandleChanging() {}
      onHandleChanged() {}
    }

    const mockX6 = {
      Registry: {
        EdgeTool: {
          presets: {
            segments: MockSegmentsTool,
          },
        },
      },
    };

    ensurePatchedSegmentsTool(mockX6);

    const instance = new MockSegmentsTool() as any;

    // 1. Simulating onHandleChanging: must strip source anchor so connection stays pinned to port
    instance.onHandleChanging({ handle: {}, e: {} });
    assert.deepStrictEqual(removedPropPath, ["source", "anchor"], "Must remove transient port anchor from cell");

    // 2. Simulating onHandleChanged: must heal vertices into strict Manhattan coordinates
    instance.onHandleChanged({ e: {} });
    assert.ok(setVerticesCalledWith, "setVertices must be called with healed vertices");
    assert.deepStrictEqual(
      setVerticesCalledWith,
      [
        { x: 50, y: 0 },
        { x: 50, y: 100 },
      ],
      "Must heal and regularize vertices to strict Manhattan coordinates",
    );
  });

  describe("updateNodeVisualOnResize", () => {
    class MockElement {
      tagName: string;
      attrs: Record<string, string>;
      children: MockElement[];

      constructor(tagName: string, attrs: Record<string, string> = {}, children: MockElement[] = []) {
        this.tagName = tagName;
        this.attrs = { ...attrs };
        this.children = [...children];
      }

      getAttribute(name: string): string | null {
        return this.attrs[name] ?? null;
      }

      setAttribute(name: string, value: string): void {
        this.attrs[name] = value;
      }

      querySelector(tag: string): MockElement | null {
        const targetTag = tag.toLowerCase();
        for (const child of this.children) {
          if (child.tagName.toLowerCase() === targetTag) return child;
          const found = child.querySelector(tag);
          if (found) return found;
        }
        return null;
      }
    }

    it("scales root SVG and direct hitbox/background rects to new dimensions", () => {
      const hitbox = new MockElement("rect", { width: "20", height: "40", style: "fill: transparent" });
      const innerIconSvg = new MockElement("svg", {
        width: "100%",
        height: "100%",
        viewBox: "-100 -100 200 200",
      });
      const rootSvg = new MockElement("svg", { width: "20", height: "40" }, [hitbox, innerIconSvg]);
      const container = new MockElement("g", { class: "x6-cell x6-node" }, [rootSvg]);

      const mockNode: any = {
        isNode: () => true,
        getPorts: () => [],
        getData: () => ({}),
        setData: () => {},
        getSize: () => ({ width: 60, height: 120 }),
      };

      const mockGraph: any = {
        findViewByCell: () => ({ container }),
      };

      updateNodeVisualOnResize(mockNode, mockGraph, 60, 120, 20, 40);

      assert.strictEqual(rootSvg.getAttribute("width"), "60", "Root SVG width must scale to 60");
      assert.strictEqual(rootSvg.getAttribute("height"), "120", "Root SVG height must scale to 120");
      assert.strictEqual(hitbox.getAttribute("width"), "60", "Hitbox rect width must scale to 60");
      assert.strictEqual(hitbox.getAttribute("height"), "120", "Hitbox rect height must scale to 120");
      // Inner icon SVG retains 100% width and height so its viewBox naturally scales
      assert.strictEqual(innerIconSvg.getAttribute("width"), "100%");
      assert.strictEqual(innerIconSvg.getAttribute("height"), "100%");
      assert.strictEqual(innerIconSvg.getAttribute("viewBox"), "-100 -100 200 200");
    });

    it("proportionally updates port coordinates across resize aspect ratios", () => {
      const hitbox = new MockElement("rect", { width: "20", height: "40" });
      const rootSvg = new MockElement("svg", { width: "20", height: "40" }, [hitbox]);
      const container = new MockElement("g", {}, [rootSvg]);

      let nodeData: any = {};
      const updatedPortProps: Record<string, any> = {};

      const mockNode: any = {
        isNode: () => true,
        getPorts: () => [
          { id: "p", args: { x: 10, y: 0 } },
          { id: "n", args: { x: 10, y: 40 } },
        ],
        getData: () => nodeData,
        setData: (d: any) => {
          nodeData = d;
        },
        setPortProp: (id: string, prop: string, val: any) => {
          if (prop === "args") updatedPortProps[id] = val;
        },
        getSize: () => ({ width: 50, height: 100 }),
      };

      const mockGraph: any = {
        findViewByCell: () => ({ container }),
      };

      // Resize from 20x40 to 50x100
      updateNodeVisualOnResize(mockNode, mockGraph, 50, 100, 20, 40);

      // Port p: initial (10, 0) => rx=0.5, ry=0 => scaled: (25, 0)
      // Port n: initial (10, 40) => rx=0.5, ry=1 => scaled: (25, 100)
      assert.ok(updatedPortProps["p"], "Port p args must be updated");
      assert.strictEqual(updatedPortProps["p"].x, 25, "Port p x must be 25");
      assert.strictEqual(updatedPortProps["p"].y, 0, "Port p y must be 0");

      assert.ok(updatedPortProps["n"], "Port n args must be updated");
      assert.strictEqual(updatedPortProps["n"].x, 25, "Port n x must be 25");
      assert.strictEqual(updatedPortProps["n"].y, 100, "Port n y must be 100");

      // Verify cached port ratios in node data
      assert.ok(nodeData.__portRatios, "__portRatios must be saved in node data");
      assert.strictEqual(nodeData.__portRatios["p"].rx, 0.5);
      assert.strictEqual(nodeData.__portRatios["p"].ry, 0);
      assert.strictEqual(nodeData.__portRatios["n"].rx, 0.5);
      assert.strictEqual(nodeData.__portRatios["n"].ry, 1);
    });

    it("updates flip transforms when component is mirrored", () => {
      const flipGroup = new MockElement("g", { transform: "translate(20, 0) scale(-1, 1)" });
      const rootSvg = new MockElement("svg", { width: "20", height: "40" }, [flipGroup]);
      const container = new MockElement("g", {}, [rootSvg]);

      const mockNode: any = {
        isNode: () => true,
        getPorts: () => [],
        getData: () => ({}),
        setData: () => {},
        getSize: () => ({ width: 80, height: 100 }),
      };

      const mockGraph: any = {
        findViewByCell: () => ({ container }),
      };

      updateNodeVisualOnResize(mockNode, mockGraph, 80, 100, 20, 40);

      assert.strictEqual(
        flipGroup.getAttribute("transform"),
        "translate(80, 0) scale(-1, 1)",
        "Horizontal flip transform must update translate offset to new width",
      );
    });

    it("updates stored node markup attributes to stay synchronized", () => {
      const markup = {
        tagName: "svg",
        attrs: { width: 20, height: 40 },
        children: [
          { tagName: "rect", attrs: { width: 20, height: 40 } },
          { tagName: "g", attrs: { transform: "translate(20, 0) scale(-1, 1)" } },
        ],
      };

      const mockNode: any = {
        isNode: () => true,
        getPorts: () => [],
        getData: () => ({}),
        setData: () => {},
        getMarkup: () => markup,
        getSize: () => ({ width: 70, height: 90 }),
      };

      const mockGraph: any = {
        findViewByCell: () => null,
      };

      updateNodeVisualOnResize(mockNode, mockGraph, 70, 90, 20, 40);

      assert.strictEqual(markup.attrs.width, 70);
      assert.strictEqual(markup.attrs.height, 90);
      assert.strictEqual(markup.children[0].attrs.width, 70);
      assert.strictEqual(markup.children[0].attrs.height, 90);
      assert.strictEqual(markup.children[1].attrs.transform, "translate(70, 0) scale(-1, 1)");
    });
  });

  describe("ensurePatchedTransformTool (Proportional Resize & Free Rotation)", () => {
    class MockTransformWidget {
      node: any;
      graph: any;
      options: Record<string, any>;
      __initialAspectRatio?: number;

      constructor(options: any, node: any, graph: any) {
        this.options = { ...options };
        this.node = node;
        this.graph = graph;
      }

      getEventData(_evt: any) {
        return { action: "resizing" };
      }

      startResizing(_evt: any) {}

      onMouseMove(_evt: any) {
        // Simulates unpatched X6 behavior
        if (this.options.preserveAspectRatio) {
          const ratio = 2.0; // initial aspect ratio
          const newW = 120;
          const newH = newW / ratio; // 60
          this.node.resize(newW, newH);
        } else {
          this.node.resize(120, 90); // free/distorted resize
        }
      }
    }

    class MockTransformPlugin {
      createTransform(node: any) {
        return new MockTransformWidget({ resizable: true, rotatable: true }, node, {});
      }
    }

    it("enables proportional aspect-ratio preservation when Shift is held during corner resize", () => {
      let resizedW = 0;
      let resizedH = 0;

      const mockNode: any = {
        getBBox: () => ({ x: 100, y: 100, width: 80, height: 40 }), // 2:1 aspect ratio
        getSize: () => ({ width: resizedW || 80, height: resizedH || 40 }),
        resize: (w: number, h: number) => {
          resizedW = w;
          resizedH = h;
        },
      };

      const mockX6 = {
        Transform: MockTransformPlugin,
      };

      ensurePatchedTransformTool(mockX6);

      const plugin = new MockTransformPlugin();
      const widget = plugin.createTransform(mockNode) as any;

      // 1. Mouse move WITHOUT Shift -> distorted resize (120x90, aspect ratio 1.33)
      widget.startResizing({});
      widget.onMouseMove({ shiftKey: false });
      assert.strictEqual(resizedW, 120);
      assert.strictEqual(resizedH, 90);
      assert.strictEqual(widget.options.preserveAspectRatio, false);

      // 2. Mouse move WITH Shift held -> locks proportions to 2:1 (120x60)
      widget.onMouseMove({ shiftKey: true });
      assert.strictEqual(
        widget.options.preserveAspectRatio,
        true,
        "Must enable preserveAspectRatio when Shift is held",
      );
      assert.strictEqual(resizedW, 120);
      assert.strictEqual(resizedH, 60, "Must preserve 2:1 aspect ratio when Shift is held");
      assert.strictEqual(resizedW / resizedH, 2.0, "Proportions must be preserved");

      // 3. Releasing Shift -> returns to free resize
      widget.onMouseMove({ shiftKey: false });
      assert.strictEqual(
        widget.options.preserveAspectRatio,
        false,
        "Must disable preserveAspectRatio when Shift is released",
      );
    });

    it("switches to unconstrained 1-degree rotation when Alt is pressed", () => {
      class MockRotateWidget {
        options: Record<string, any> = { rotateGrid: 15 };
        getEventData(_evt: any) {
          return { action: "rotating" };
        }
        onMouseMove(_evt: any) {}
      }

      class MockRotatePlugin {
        createTransform(_node: any) {
          return new MockRotateWidget();
        }
      }

      const mockX6 = {
        Transform: MockRotatePlugin,
      };

      ensurePatchedTransformTool(mockX6);

      const plugin = new MockRotatePlugin();
      const widget = plugin.createTransform({}) as any;

      // Default rotation: 15 degree grid snap
      widget.onMouseMove({ altKey: false });
      assert.strictEqual(widget.options.rotateGrid, 15, "Default rotation must snap to 15 degrees");

      // Holding Alt: 0 (free continuous unconstrained rotation)
      widget.onMouseMove({ altKey: true });
      assert.strictEqual(widget.options.rotateGrid, 0, "Alt key must enable free unconstrained rotation");

      // Releasing Alt: restores 15 degree grid snap
      widget.onMouseMove({ altKey: false });
      assert.strictEqual(widget.options.rotateGrid, 15, "Releasing Alt must restore 15 degree grid snap");
    });

    it("positions floating toolbar with 46px clearance above single node to leave room for free rotation handle", () => {
      const mockToolbar = {
        style: {} as Record<string, string>,
        classList: { add: () => {} },
      } as unknown as HTMLElement;

      const mockContainer = {
        clientWidth: 1000,
        clientHeight: 800,
      } as HTMLElement;

      const singleNode: AlignableNode = {
        id: "resistor1",
        x: 300,
        y: 200,
        width: 100,
        height: 100,
      };

      // 1. Single node selected -> toolbar must sit 46px above node top (y = 200 - 46 = 154px)
      showAlignmentToolbar(mockToolbar, mockContainer, [singleNode], { sx: 1, sy: 1 }, { tx: 0, ty: 0 });
      assert.strictEqual(
        mockToolbar.style.top,
        "154px",
        "Single-node toolbar must provide 46px clearance for the top-center rotation handle",
      );
      assert.strictEqual(mockToolbar.style.transform, "translate(-50%, -100%)");

      // 2. Multi-node selection (2 nodes) -> toolbar can sit compactly 14px above top (y = 200 - 14 = 186px)
      const secondNode: AlignableNode = {
        id: "capacitor1",
        x: 500,
        y: 200,
        width: 100,
        height: 100,
      };
      showAlignmentToolbar(mockToolbar, mockContainer, [singleNode, secondNode], { sx: 1, sy: 1 }, { tx: 0, ty: 0 });
      assert.strictEqual(
        mockToolbar.style.top,
        "186px",
        "Multi-node toolbar without rotate handles must maintain compact 14px clearance",
      );
    });
  });
});
