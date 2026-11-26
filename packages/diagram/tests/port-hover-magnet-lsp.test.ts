// SPDX-License-Identifier: AGPL-3.0-or-later

import { SoaSceneGraph, syncHoveredPortDom, syncMagnetHighlightsDom } from "@modelscript/canvas/engine";
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { prepareDiagramRenderModel } from "../dist/canvas-render-normalize.js";
import { evaluateModelScriptPortCompatibility } from "../dist/index.js";

function makeMockPortElement(nodeId: string, portId: string) {
  const classes = new Set<string>(["ms-port"]);
  const nodeEl = {
    getAttribute(attr: string) {
      return attr === "data-cell-id" ? nodeId : null;
    },
  };
  return {
    classList: {
      add(cls: string) {
        classes.add(cls);
      },
      remove(cls: string) {
        classes.delete(cls);
      },
      contains(cls: string) {
        return classes.has(cls);
      },
    },
    getAttribute(attr: string) {
      if (attr === "port" || attr === "port-id") return portId;
      return null;
    },
    closest(sel: string) {
      return sel === "[data-cell-id]" ? nodeEl : null;
    },
  };
}

function makeMockNodesG(ports: ReturnType<typeof makeMockPortElement>[]) {
  const classes = new Set<string>();
  return {
    classList: {
      toggle(cls: string, force?: boolean) {
        if (force === undefined) {
          if (classes.has(cls)) classes.delete(cls);
          else classes.add(cls);
        } else if (force) {
          classes.add(cls);
        } else {
          classes.delete(cls);
        }
      },
      contains(cls: string) {
        return classes.has(cls);
      },
    },
    querySelectorAll(sel: string) {
      return sel === ".ms-port" ? ports : [];
    },
  } as unknown as SVGGElement & { classList: { contains: (c: string) => boolean } };
}

describe("Port hover, magnet highlighting, and LSP compatibility", () => {
  it("highlights hovered port with ms-port-hover and clears on leave", () => {
    const p1 = makeMockPortElement("resistor1", "p");
    const p2 = makeMockPortElement("resistor1", "n");
    const nodesG = makeMockNodesG([p1, p2]);

    syncHoveredPortDom(nodesG, { nodeId: "resistor1", portId: "p" });
    assert.equal(p1.classList.contains("ms-port-hover"), true);
    assert.equal(p2.classList.contains("ms-port-hover"), false);

    syncHoveredPortDom(nodesG, null);
    assert.equal(p1.classList.contains("ms-port-hover"), false);
    assert.equal(p2.classList.contains("ms-port-hover"), false);
  });

  it("applies source, available, incompatible, and adsorbed magnet classes during wiring", () => {
    const srcPort = makeMockPortElement("resistor1", "p");
    const compatPort = makeMockPortElement("capacitor1", "n");
    const incompatPort = makeMockPortElement("gain1", "u");
    const otherCompatPort = makeMockPortElement("ground1", "p");
    const nodesG = makeMockNodesG([srcPort, compatPort, incompatPort, otherCompatPort]);

    syncMagnetHighlightsDom(
      nodesG,
      {
        sourceNodeId: "resistor1",
        sourcePortId: "p",
        sourcePoint: { x: 0, y: 0 },
        currentPoint: { x: 100, y: 0 },
        snappedTarget: { nodeId: "capacitor1", portId: "n", x: 100, y: 0 },
      },
      (_sNode, _sPort, tNode, _tPort) => tNode !== "gain1",
    );

    assert.equal(nodesG.classList.contains("ms-wiring-active"), true);
    assert.equal(srcPort.classList.contains("ms-magnet-source"), true);
    assert.equal(compatPort.classList.contains("ms-magnet-adsorbed"), true);
    assert.equal(incompatPort.classList.contains("ms-magnet-incompatible"), true);
    assert.equal(otherCompatPort.classList.contains("ms-magnet-available"), true);

    syncMagnetHighlightsDom(nodesG, null);
    assert.equal(nodesG.classList.contains("ms-wiring-active"), false);
    assert.equal(srcPort.classList.contains("ms-magnet-source"), false);
    assert.equal(compatPort.classList.contains("ms-magnet-adsorbed"), false);
    assert.equal(incompatPort.classList.contains("ms-magnet-incompatible"), false);
    assert.equal(otherCompatPort.classList.contains("ms-magnet-available"), false);
  });

  it("hitTestPort skips incompatible ports when filtering so magnet snaps to nearest compatible receiving port", () => {
    const scene = new SoaSceneGraph();
    scene.upsertNode({
      id: "target1",
      x: 100,
      y: 100,
      width: 40,
      height: 40,
    });
    scene.setNodePorts("target1", [
      { id: "incompat", x: 0, y: 0 },
      { id: "compat", x: 8, y: 0 },
    ]);

    const hit = scene.hitTestPort(101, 100, 20, undefined, (_nId, portId) => portId === "compat");
    assert.ok(hit);
    assert.equal(hit.portId, "compat");
  });

  it("preserves connectorType, domain, direction, and isConjugated on array ports in prepareDiagramRenderModel", () => {
    const model = prepareDiagramRenderModel(
      {} as never,
      {
        nodes: [
          {
            id: "n1",
            x: 0,
            y: 0,
            width: 80,
            height: 40,
            ports: [
              {
                id: "pin_p",
                direction: "in",
                connectorType: "Modelica.Electrical.Analog.Interfaces.PositivePin",
                domain: "electrical",
                isConjugated: false,
              },
            ],
          } as never,
        ],
        edges: [],
      },
      false,
    );

    const ports = model.nodes[0]?.ports as { items?: Record<string, unknown>[] };
    assert.ok(ports?.items?.[0]);
    assert.equal(ports.items[0]["connectorType"], "Modelica.Electrical.Analog.Interfaces.PositivePin");
    assert.equal(ports.items[0]["domain"], "electrical");
    assert.equal(ports.items[0]["direction"], "in");
    assert.equal(ports.items[0]["isConjugated"], false);
  });

  it("rejects incompatible Modelica and SysML2 ports", () => {
    const elecVsSignal = evaluateModelScriptPortCompatibility(
      {
        nodeId: "r1",
        portId: "p",
        connectorType: "Modelica.Electrical.Analog.Interfaces.PositivePin",
      },
      {
        nodeId: "g1",
        portId: "u",
        connectorType: "Modelica.Blocks.Interfaces.RealInput",
      },
      { languageId: "modelica" },
    );
    assert.equal(elecVsSignal.compatible, false);

    const outToOut = evaluateModelScriptPortCompatibility(
      {
        nodeId: "s1",
        portId: "y",
        connectorType: "Modelica.Blocks.Interfaces.RealOutput",
      },
      {
        nodeId: "s2",
        portId: "y",
        connectorType: "Modelica.Blocks.Interfaces.RealOutput",
      },
      { languageId: "modelica" },
    );
    assert.equal(outToOut.compatible, false);

    const pinToPin = evaluateModelScriptPortCompatibility(
      {
        nodeId: "r1",
        portId: "p",
        connectorType: "Modelica.Electrical.Analog.Interfaces.PositivePin",
      },
      {
        nodeId: "c1",
        portId: "n",
        connectorType: "Modelica.Electrical.Analog.Interfaces.NegativePin",
      },
      { languageId: "modelica" },
    );
    assert.equal(pinToPin.compatible, true);
  });
});
