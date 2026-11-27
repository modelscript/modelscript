// SPDX-License-Identifier: AGPL-3.0-or-later

import { SoaSceneGraph, syncHoveredPortDom, syncMagnetHighlightsDom } from "@modelscript/canvas/engine";
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { prepareDiagramRenderModel } from "../dist/canvas-render-normalize.js";
import { buildEasy5Diagram } from "../dist/easy5-diagram-builder.js";
import { evaluateModelScriptPortCompatibility } from "../dist/index.js";
import { buildPolyglotPortCompatibilityMeta } from "../dist/polyglot-diagram-builder.js";
import { buildRocetsDiagram } from "../dist/rocets-diagram-builder.js";

function makeMockPortElement(nodeId: string, portId: string) {
  const classes = new Set<string>(["ms-port"]);
  const attrs = new Map<string, string>();
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
      return attrs.get(attr) ?? null;
    },
    setAttribute(attr: string, val: string) {
      attrs.set(attr, val);
    },
    removeAttribute(attr: string) {
      attrs.delete(attr);
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
    const overlayChildren: Array<{ attrs: Map<string, string>; remove: () => void }> = [];
    const mockOverlayG = {
      ownerDocument: {
        createElementNS(_ns: string, _tag: string) {
          const attrs = new Map<string, string>();
          const el = {
            attrs,
            textContent: "",
            setAttribute(k: string, v: string) {
              attrs.set(k, v);
            },
            appendChild() {},
            remove() {
              const idx = overlayChildren.indexOf(el);
              if (idx !== -1) overlayChildren.splice(idx, 1);
            },
          };
          return el;
        },
      },
      querySelector(sel: string) {
        return sel === ".ms-incompat-pill"
          ? (overlayChildren.find((c) => c.attrs.get("class") === "ms-incompat-pill") ?? null)
          : null;
      },
      appendChild(el: { attrs: Map<string, string>; remove: () => void }) {
        overlayChildren.push(el);
      },
    } as unknown as SVGGElement;

    syncMagnetHighlightsDom(
      nodesG,
      {
        sourceNodeId: "resistor1",
        sourcePortId: "p",
        sourcePoint: { x: 0, y: 0 },
        currentPoint: { x: 100, y: 0 },
        snappedTarget: { nodeId: "capacitor1", portId: "n", x: 100, y: 0 },
        incompatibleTarget: { nodeId: "gain1", portId: "u", x: 120, y: 40 },
      },
      (_sNode, _sPort, tNode, _tPort) => tNode !== "gain1",
      (_sNode, _sPort, tNode, _tPort) => (tNode === "gain1" ? "Incompatible: Electrical ↔ Control Signal" : null),
      mockOverlayG,
    );

    assert.equal(nodesG.classList.contains("ms-wiring-active"), true);
    assert.equal(srcPort.classList.contains("ms-magnet-source"), true);
    assert.equal(compatPort.classList.contains("ms-magnet-adsorbed"), true);
    assert.equal(incompatPort.classList.contains("ms-magnet-incompatible"), true);
    assert.equal(incompatPort.getAttribute("data-incompatible-reason"), "Incompatible: Electrical ↔ Control Signal");
    assert.equal(overlayChildren.length, 1);
    assert.equal(
      overlayChildren[0]?.attrs.get("data-incompatible-reason"),
      "Incompatible: Electrical ↔ Control Signal",
    );
    assert.equal(otherCompatPort.classList.contains("ms-magnet-available"), true);
    assert.equal(otherCompatPort.getAttribute("data-incompatible-reason"), null);

    syncMagnetHighlightsDom(nodesG, null, undefined, undefined, mockOverlayG);
    assert.equal(nodesG.classList.contains("ms-wiring-active"), false);
    assert.equal(srcPort.classList.contains("ms-magnet-source"), false);
    assert.equal(compatPort.classList.contains("ms-magnet-adsorbed"), false);
    assert.equal(incompatPort.classList.contains("ms-magnet-incompatible"), false);
    assert.equal(incompatPort.getAttribute("data-incompatible-reason"), null);
    assert.equal(overlayChildren.length, 0);
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

  it("enforces full Modelica structural plug-compatibility when portSignature is present", () => {
    const hydraulicSigA = {
      variables: [
        { name: "p", type: "Real", flowKind: "potential" as const, direction: "inout" as const },
        { name: "q", type: "Real", flowKind: "flow" as const, direction: "inout" as const },
      ],
    };
    const hydraulicSigB = {
      variables: [
        { name: "p", type: "Real", flowKind: "potential" as const, direction: "inout" as const },
        { name: "q", type: "Real", flowKind: "flow" as const, direction: "inout" as const },
      ],
    };
    // Distinct custom connector names with identical structural signature -> compatible!
    const customMatch = evaluateModelScriptPortCompatibility(
      { nodeId: "pump", portId: "out", connectorType: "CustomLib.HydraulicPortA", portSignature: hydraulicSigA },
      { nodeId: "valve", portId: "in", connectorType: "VendorLib.OilPortB", portSignature: hydraulicSigB },
      { languageId: "modelica" },
    );
    assert.equal(customMatch.compatible, true);
    assert.equal(customMatch.rule, "structural-signature-match");

    // Flow prefix mismatch on same variable name -> incompatible!
    const flowMismatch = evaluateModelScriptPortCompatibility(
      { nodeId: "a", portId: "p", connectorType: "Custom.PinA", portSignature: hydraulicSigA },
      {
        nodeId: "b",
        portId: "p",
        connectorType: "Custom.PinB",
        portSignature: {
          variables: [
            { name: "p", type: "Real", flowKind: "potential", direction: "inout" },
            { name: "q", type: "Real", flowKind: "potential", direction: "inout" },
          ],
        },
      },
      { languageId: "modelica" },
    );
    assert.equal(flowMismatch.compatible, false);
    assert.equal(flowMismatch.rule, "structural-signature-mismatch");

    // Variable base type mismatch -> incompatible!
    const typeMismatch = evaluateModelScriptPortCompatibility(
      { nodeId: "a", portId: "p", portSignature: hydraulicSigA },
      {
        nodeId: "b",
        portId: "p",
        portSignature: {
          variables: [
            { name: "p", type: "Integer", flowKind: "potential", direction: "inout" },
            { name: "q", type: "Real", flowKind: "flow", direction: "inout" },
          ],
        },
      },
      { languageId: "modelica" },
    );
    assert.equal(typeMismatch.compatible, false);
    assert.equal(typeMismatch.rule, "structural-signature-mismatch");

    // Concrete connector array dimension mismatch -> incompatible!
    const dimMismatch = evaluateModelScriptPortCompatibility(
      { nodeId: "a", portId: "p", portSignature: { ...hydraulicSigA, dims: ["2"] } },
      { nodeId: "b", portId: "p", portSignature: { ...hydraulicSigB, dims: ["3"] } },
      { languageId: "modelica" },
    );
    assert.equal(dimMismatch.compatible, false);
    assert.equal(dimMismatch.rule, "structural-signature-mismatch");

    // Expandable bus connector accepts any structured or signal connector!
    const busMatch = evaluateModelScriptPortCompatibility(
      {
        nodeId: "bus",
        portId: "ctrl",
        connectorType: "ControlBus",
        portSignature: { isExpandable: true, variables: [] },
      },
      { nodeId: "pump", portId: "out", connectorType: "CustomLib.HydraulicPortA", portSignature: hydraulicSigA },
      { languageId: "modelica" },
    );
    assert.equal(busMatch.compatible, true);
    assert.equal(busMatch.rule, "structural-signature-match");

    // Causal signal type mismatch (RealOutput -> BooleanInput) -> incompatible!
    const sigTypeMismatch = evaluateModelScriptPortCompatibility(
      {
        nodeId: "s1",
        portId: "y",
        portSignature: { variables: [{ name: "value", type: "Real", flowKind: "signal", direction: "out" }] },
      },
      {
        nodeId: "s2",
        portId: "u",
        portSignature: { variables: [{ name: "value", type: "Boolean", flowKind: "signal", direction: "in" }] },
      },
      { languageId: "modelica" },
    );
    assert.equal(sigTypeMismatch.compatible, false);
    assert.equal(sigTypeMismatch.rule, "structural-signature-mismatch");

    // Modelica §9.3 inside/outside causality:
    // Top-level inside RealInput `u` connects to sub-component RealInput `gain.u` (in <-> in = valid!)
    const insideToOutsideIn = evaluateModelScriptPortCompatibility(
      {
        nodeId: "u",
        portId: "u",
        portSignature: {
          isInsideConnector: true,
          variables: [{ name: "value", type: "Real", flowKind: "signal", direction: "in" }],
        },
      },
      {
        nodeId: "gain",
        portId: "u",
        portSignature: {
          variables: [{ name: "value", type: "Real", flowKind: "signal", direction: "in" }],
        },
      },
      { languageId: "modelica" },
    );
    assert.equal(insideToOutsideIn.compatible, true);
    assert.equal(insideToOutsideIn.rule, "structural-signature-match");

    // Top-level inside RealInput `u` CANNOT connect to sub-component RealOutput `gain.y` (in <-> out = conflict!)
    const insideInToOutsideOut = evaluateModelScriptPortCompatibility(
      {
        nodeId: "u",
        portId: "u",
        portSignature: {
          isInsideConnector: true,
          variables: [{ name: "value", type: "Real", flowKind: "signal", direction: "in" }],
        },
      },
      {
        nodeId: "gain",
        portId: "y",
        portSignature: {
          variables: [{ name: "value", type: "Real", flowKind: "signal", direction: "out" }],
        },
      },
      { languageId: "modelica" },
    );
    assert.equal(insideInToOutsideOut.compatible, false);
    assert.equal(insideInToOutsideOut.rule, "causality-conflict");

    // Feedthrough inside RealInput `u` -> inside RealOutput `y` is valid!
    const insideFeedthrough = evaluateModelScriptPortCompatibility(
      {
        nodeId: "u",
        portId: "u",
        portSignature: {
          isInsideConnector: true,
          variables: [{ name: "value", type: "Real", flowKind: "signal", direction: "in" }],
        },
      },
      {
        nodeId: "y",
        portId: "y",
        portSignature: {
          isInsideConnector: true,
          variables: [{ name: "value", type: "Real", flowKind: "signal", direction: "out" }],
        },
      },
      { languageId: "modelica" },
    );
    assert.equal(insideFeedthrough.compatible, true);
  });

  it("extracts polyglot port signatures for SysML v2 conjugated ports, VHDL/Verilog bit-vectors, and MagicDraw", () => {
    // 1. SysML v2 port def with directed items + conjugation flip
    const sysmlIndex = {
      symbols: new Map<number, any>([
        [1, { id: 1, name: "PowerPort", ruleName: "PortDefinition" }],
        [2, { id: 2, name: "voltage", ruleName: "FeatureUsage", metadata: { direction: "out", type: "Real" } }],
        [3, { id: 3, name: "current", ruleName: "FeatureUsage", metadata: { direction: "in", type: "Real" } }],
        [10, { id: 10, name: "pwrOut", ruleName: "PortUsage", metadata: { type: "PowerPort" } }],
        [11, { id: 11, name: "pwrIn", ruleName: "PortUsage", metadata: { type: "~PowerPort", isConjugated: true } }],
      ]),
      childrenOf: new Map<number | null, number[]>([
        [1, [2, 3]],
        [10, []],
        [11, []],
      ]),
      byName: new Map<string, number[]>([["PowerPort", [1]]]),
    };

    const pwrA = buildPolyglotPortCompatibilityMeta(sysmlIndex.symbols.get(10)!, sysmlIndex, false);
    const pwrB = buildPolyglotPortCompatibilityMeta(sysmlIndex.symbols.get(11)!, sysmlIndex, true);
    assert.equal(pwrA.connectorType, "PowerPort");
    assert.equal(pwrB.connectorType, "PowerPort");
    assert.equal(
      evaluateModelScriptPortCompatibility(
        { nodeId: "src", portId: "pwrOut", ...pwrA, isConjugated: false },
        { nodeId: "sink", portId: "pwrIn", ...pwrB, isConjugated: true },
        { languageId: "sysml2" },
      ).compatible,
      true,
    );
    assert.equal(
      evaluateModelScriptPortCompatibility(
        { nodeId: "src1", portId: "pwrOut", ...pwrA, isConjugated: false },
        { nodeId: "src2", portId: "pwrOut", ...pwrA, isConjugated: false },
        { languageId: "sysml2" },
      ).compatible,
      false,
    );

    // 2. VHDL std_logic_vector width checking
    const vhdlIndex = { symbols: new Map(), childrenOf: new Map(), byName: new Map() };
    const bus8Out = buildPolyglotPortCompatibilityMeta(
      { id: 20, name: "data_o", ruleName: "Port", metadata: { type: "std_logic_vector(7 downto 0)" } },
      vhdlIndex,
      false,
      "out",
    );
    const bus16In = buildPolyglotPortCompatibilityMeta(
      { id: 21, name: "data_i", ruleName: "Port", metadata: { type: "std_logic_vector(15 downto 0)" } },
      vhdlIndex,
      false,
      "in",
    );
    const bus8In = buildPolyglotPortCompatibilityMeta(
      { id: 22, name: "data_i", ruleName: "Port", metadata: { type: "logic[7:0]" } },
      vhdlIndex,
      false,
      "in",
    );

    assert.equal(
      evaluateModelScriptPortCompatibility(
        { nodeId: "alu", portId: "data_o", ...bus8Out },
        { nodeId: "reg", portId: "data_i", ...bus16In },
        { languageId: "vhdl" },
      ).compatible,
      false,
    );
    assert.equal(
      evaluateModelScriptPortCompatibility(
        { nodeId: "alu", portId: "data_o", ...bus8Out },
        { nodeId: "reg", portId: "data_i", ...bus8In },
        { languageId: "vhdl" },
      ).compatible,
      true,
    );

    // 3. MagicDraw SysML v1 conjugation guard
    assert.equal(
      evaluateModelScriptPortCompatibility(
        { nodeId: "b1", portId: "p1", connectorType: "FuelFlow", isConjugated: false },
        { nodeId: "b2", portId: "p2", connectorType: "FuelFlow", isConjugated: false },
        { languageId: "magicdraw" },
      ).compatible,
      false,
    );
    assert.equal(
      evaluateModelScriptPortCompatibility(
        { nodeId: "b1", portId: "p1", connectorType: "FuelFlow", isConjugated: false },
        { nodeId: "b2", portId: "p2", connectorType: "FuelFlow", isConjugated: true },
        { languageId: "magicdraw" },
      ).compatible,
      true,
    );
  });

  it("emits structural port guards in Easy5 and ROCETS diagram builders", () => {
    const easy5 = buildEasy5Diagram({
      components: [
        { id: "G1", type: "GN", ports: { U: { kind: "input" }, Y: { kind: "output" } } },
        { id: "G2", type: "GN", ports: { U: { kind: "input" }, Y: { kind: "output" } } },
      ],
      connections: [],
    });
    const g1Ports = easy5.nodes[0]!.ports.items as any[];
    const g2Ports = easy5.nodes[1]!.ports.items as any[];
    const g1Y = g1Ports.find((p) => p.id === "Y");
    const g2U = g2Ports.find((p) => p.id === "U");
    const g2Y = g2Ports.find((p) => p.id === "Y");

    assert.equal(
      evaluateModelScriptPortCompatibility({ nodeId: "G1", portId: "Y", ...g1Y }, { nodeId: "G2", portId: "U", ...g2U })
        .compatible,
      true,
    );
    assert.equal(
      evaluateModelScriptPortCompatibility({ nodeId: "G1", portId: "Y", ...g1Y }, { nodeId: "G2", portId: "Y", ...g2Y })
        .compatible,
      false,
    );

    const rocets = buildRocetsDiagram({
      components: [
        { id: "PUMP", type: "PUMP", ports: { fluid_out: { direction: "out" }, shaft_in: { direction: "in" } } },
        { id: "NOZ", type: "NOZZLE", ports: { fluid_in: { direction: "in" } } },
        { id: "TURB", type: "TURBINE", ports: { shaft_out: { direction: "out" } } },
      ],
      connections: [],
    });
    const pumpFluidOut = (rocets.nodes[0]!.ports.items as any[]).find((p) => p.id === "fluid_out");
    const pumpShaftIn = (rocets.nodes[0]!.ports.items as any[]).find((p) => p.id === "shaft_in");
    const nozFluidIn = (rocets.nodes[1]!.ports.items as any[]).find((p) => p.id === "fluid_in");
    const turbShaftOut = (rocets.nodes[2]!.ports.items as any[]).find((p) => p.id === "shaft_out");

    // Fluid out -> Fluid in = valid
    assert.equal(
      evaluateModelScriptPortCompatibility(
        { nodeId: "PUMP", portId: "fluid_out", ...pumpFluidOut },
        { nodeId: "NOZ", portId: "fluid_in", ...nozFluidIn },
      ).compatible,
      true,
    );
    // Shaft out -> Shaft in = valid
    assert.equal(
      evaluateModelScriptPortCompatibility(
        { nodeId: "TURB", portId: "shaft_out", ...turbShaftOut },
        { nodeId: "PUMP", portId: "shaft_in", ...pumpShaftIn },
      ).compatible,
      true,
    );
    // Shaft out -> Fluid in = blocked!
    assert.equal(
      evaluateModelScriptPortCompatibility(
        { nodeId: "TURB", portId: "shaft_out", ...turbShaftOut },
        { nodeId: "NOZ", portId: "fluid_in", ...nozFluidIn },
      ).compatible,
      false,
    );
  });
});
