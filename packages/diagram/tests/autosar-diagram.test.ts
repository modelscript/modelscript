// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert/strict";
import test from "node:test";
import { buildAutosarDiagram, renderAutosarSvg, type AutosarModelLike } from "../src/autosar-diagram-builder.js";

const sampleCompositionModel: AutosarModelLike = {
  title: "ZonalBrakeByWireComposition",
  components: [
    {
      shortName: "PedalFeelSensorSwc",
      kind: "SENSOR-ACTUATOR-SW-COMPONENT-TYPE",
      ports: [{ shortName: "PedalTravelOut", direction: "provided", interfaceRef: "/Pkg/IF_Pedal" }],
    },
    {
      shortName: "BrakeTorqueArbitratorSwc",
      kind: "APPLICATION-SW-COMPONENT-TYPE",
      ports: [
        { shortName: "PedalTravelIn", direction: "required", interfaceRef: "/Pkg/IF_Pedal" },
        { shortName: "BrakeCmdOut", direction: "provided", interfaceRef: "/Pkg/IF_Torque" },
      ],
    },
    {
      shortName: "ZonalBrakeByWireComposition",
      kind: "COMPOSITION-SW-COMPONENT-TYPE",
      subComponents: [
        { shortName: "PedalDualChannel", typeRef: "/Pkg/PedalFeelSensorSwc" },
        { shortName: "CentralBrakeArbitrator", typeRef: "/Pkg/BrakeTorqueArbitratorSwc" },
      ],
      connectors: [
        {
          shortName: "Conn_Pedal_to_Arb",
          kind: "ASSEMBLY-SW-CONNECTOR",
          provider: { component: "PedalDualChannel", port: "PedalTravelOut" },
          requirer: { component: "CentralBrakeArbitrator", port: "PedalTravelIn" },
        },
      ],
    },
  ],
  frames: [
    {
      shortName: "CAN_BrakeCmdFrame",
      frameId: 0x120,
      length: 8,
      pduRef: "/Pkg/BrakeCmdPdu",
    },
  ],
};

const sampleAtomicSwcModel: AutosarModelLike = {
  components: [
    {
      shortName: "TorqueController",
      kind: "APPLICATION-SW-COMPONENT-TYPE",
      ports: [
        { shortName: "PedalPos", direction: "required", interfaceRef: "/Powertrain/IF_TorqueSignal" },
        { shortName: "TorqueCmd", direction: "provided", interfaceRef: "/Powertrain/IF_TorqueSignal" },
      ],
      internalBehavior: {
        shortName: "TorqueControllerBehavior",
        events: [
          {
            shortName: "TE_10ms",
            kind: "TIMING-EVENT",
            startOnEventRef: "/Powertrain/TorqueController/TorqueControllerBehavior/StepRunnable",
            period: 0.01,
          },
        ],
        runnables: [
          {
            shortName: "StepRunnable",
            symbol: "TorqueController_Step",
            executionTimeWcet: 0.00025,
          },
        ],
      },
    },
  ],
};

test("buildAutosarDiagram: Builds VFB composition diagram with SWC prototypes, assembly connectors, and CAN frames", () => {
  const diag = buildAutosarDiagram(sampleCompositionModel);
  assert.equal(diag.title, "ZonalBrakeByWireComposition");
  assert.equal(diag.metadata.componentCount, 3);
  assert.equal(diag.metadata.compositionCount, 1);
  assert.equal(diag.metadata.connectorCount, 1);
  assert.equal(diag.metadata.frameCount, 1);

  // 2 SWC prototypes + 1 CAN frame = 3 nodes
  assert.equal(diag.nodes.length, 3);
  assert.equal(diag.edges.length, 1);
});

test("buildAutosarDiagram: Builds Atomic SWC diagram with R-Ports, Runnables, and P-Ports", () => {
  const diag = buildAutosarDiagram(sampleAtomicSwcModel);
  assert.equal(diag.title, "TorqueController");
  assert.equal(diag.metadata.portCount, 2);
  assert.equal(diag.metadata.runnableCount, 1);
  assert.equal(diag.metadata.eventCount, 1);

  // 1 R-Port + 1 Runnable + 1 P-Port = 3 nodes
  assert.equal(diag.nodes.length, 3);
  // Rte_Read + Rte_Write = 2 edges
  assert.equal(diag.edges.length, 2);
});

test("renderAutosarSvg: Renders standalone AUTOSAR VFB and RTE SVG schematics", () => {
  const compSvg = renderAutosarSvg(sampleCompositionModel);
  assert.ok(compSvg.startsWith("<?xml"));
  assert.ok(compSvg.includes("ZonalBrakeByWireComposition — AUTOSAR VFB &amp; RTE Architecture"));
  assert.ok(compSvg.includes("PedalDualChannel"));
  assert.ok(compSvg.includes("CentralBrakeArbitrator"));
  assert.ok(compSvg.includes("0x120"));

  const atomicSvg = renderAutosarSvg(sampleAtomicSwcModel);
  assert.ok(atomicSvg.includes("StepRunnable"));
  assert.ok(atomicSvg.includes("10.0 ms"));
  assert.ok(atomicSvg.includes("PedalPos"));
  assert.ok(atomicSvg.includes("TorqueCmd"));
});
