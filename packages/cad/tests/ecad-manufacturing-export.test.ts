// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert";
import { describe, it } from "node:test";
import {
  CM_STANDARD_RULES,
  compileToIPC2581,
  compileToODB,
  formatJlcpcbCplCsv,
  formatMacrofabXy,
  formatStandardCentroidCsv,
  generateCentroidRecords,
  normalizeIpc7351Rotation,
  runDRC,
  type PCBLayout,
} from "../src/ecad/index.js";

describe("ECAD Advanced Manufacturing Export: Centroid, IPC-2581C & ODB++", () => {
  const sampleLayout: PCBLayout = {
    traces: [
      { start: [10, 10], end: [20, 20], width: 0.25, layer: "TopCopper", net: "VCC" },
      { start: [20, 20], end: [30, 20], width: 0.25, layer: "TopCopper", net: "VCC" },
      { start: [15, 15], end: [25, 15], width: 0.3, layer: "BottomCopper", net: "GND" },
    ],
    pads: [
      {
        center: [10, 10],
        width: 1.5,
        height: 0.6,
        drill: 0,
        shape: "roundrect",
        layer: "TopCopper",
        net: "VCC",
        component: "U1",
      },
      {
        center: [10, 11.27],
        width: 1.5,
        height: 0.6,
        drill: 0,
        shape: "roundrect",
        layer: "TopCopper",
        net: "GND",
        component: "U1",
      },
      {
        center: [40, 25],
        width: 0.8,
        height: 0.8,
        drill: 0,
        shape: "rect",
        layer: "TopCopper",
        net: "VCC",
        component: "C1",
      },
      {
        center: [42, 25],
        width: 0.8,
        height: 0.8,
        drill: 0,
        shape: "rect",
        layer: "TopCopper",
        net: "GND",
        component: "C1",
      },
      {
        center: [50, 30],
        width: 1.2,
        height: 0.8,
        drill: 0,
        shape: "rect",
        layer: "BottomCopper",
        net: "GND",
        component: "D1",
      },
    ],
    vias: [{ center: [20, 20], drill: 0.3, annularRing: 0.15, net: "VCC" }],
    outline: {
      vertices: [
        [0, 0],
        [80, 0],
        [80, 50],
        [0, 50],
      ],
    },
    netlist: {
      totalPins: 5,
      totalConnections: 2,
      nets: [
        {
          id: "VCC",
          pins: [
            { name: "U1.1", component: "U1", localName: "1" },
            { name: "C1.1", component: "C1", localName: "1" },
          ],
        },
        {
          id: "GND",
          pins: [
            { name: "U1.2", component: "U1", localName: "2" },
            { name: "C1.2", component: "C1", localName: "2" },
            { name: "D1.1", component: "D1", localName: "1" },
          ],
        },
      ],
      components: [
        {
          name: "U1",
          pins: ["1", "2"],
          placement: { x: 10, y: 10.635, angle: 0, layer: "TopCopper", footprint: "SOIC-8" },
        },
        {
          name: "C1",
          pins: ["1", "2"],
          placement: { x: 41, y: 25, angle: 90, layer: "TopCopper", footprint: "0603" },
        },
        {
          name: "D1",
          pins: ["1"],
          placement: { x: 50, y: 30, angle: 180, layer: "BottomCopper", footprint: "SOD-123" },
        },
      ],
    },
  };

  it("extracts normalized centroids and exports to standard, JLCPCB, and MacroFab formats", () => {
    // 1. Rotation normalization
    assert.strictEqual(normalizeIpc7351Rotation(180, "D1", "SOD-123"), 0, "Diode 180 deg should normalize to 0 deg");
    assert.strictEqual(normalizeIpc7351Rotation(90, "C1", "0603"), 90);

    // 2. Centroid record generation
    const records = generateCentroidRecords(sampleLayout, {
      componentValues: { U1: "STM32L0", C1: "100nF", D1: "B5819W" },
    });
    assert.strictEqual(records.length, 3);
    assert.strictEqual(records[0]!.designator, "C1");
    assert.strictEqual(records[0]!.layer, "top");
    assert.strictEqual(records[0]!.value, "100nF");

    assert.strictEqual(records[1]!.designator, "D1");
    assert.strictEqual(records[1]!.layer, "bottom");
    assert.strictEqual(records[1]!.normalizedRotation, 0);

    assert.strictEqual(records[2]!.designator, "U1");
    assert.strictEqual(records[2]!.package, "SOIC-8");

    // 3. Formatters
    const stdCsv = formatStandardCentroidCsv(records);
    assert(stdCsv.includes("Designator,Val,Package,Mid X,Mid Y,Rotation,Layer,Height(mm)"));
    assert(stdCsv.includes("C1,100nF,0603,41.0000,25.0000,90.0000,top,0.80"));

    const jlcCsv = formatJlcpcbCplCsv(records);
    assert(jlcCsv.includes('"Designator","Mid X","Mid Y","Layer","Rotation"'));
    assert(jlcCsv.includes('"D1","50.0000mm","30.0000mm","Bottom","0.0000"'));

    const mfXy = formatMacrofabXy(records);
    assert(mfXy.includes("# MacroFab XY Pick-and-Place File"));
    assert(mfXy.includes("U1\t394\t419\t0.0\tT\tSOIC-8\tSTM32L0"));
  });

  it("compiles layout and BOM into valid, compliant IPC-2581C XML", () => {
    const xml = compileToIPC2581(sampleLayout, {
      assemblyName: "TitanSensor_RevB",
      revision: "2.1.0",
      enterprise: "Acme Robotics",
      ipcClass: "CLASS_3",
      componentValues: { U1: "STM32L0", C1: "100nF", D1: "B5819W" },
      componentMPNs: { U1: "STM32L011K4T6", C1: "GRM188R71E104KA01D", D1: "B5819W-TP" },
    });

    // Check XML root and version
    assert(xml.startsWith('<?xml version="1.0" encoding="UTF-8"?>'));
    assert(xml.includes('<IPC-2581 xmlns="http://webstds.ipc.org/2581"'));
    assert(xml.includes('version="C"'));

    // Check LogisticHeader
    assert(xml.includes('<Enterprise name="Acme Robotics"/>'));
    assert(xml.includes('standard="IPC-2581" revision="C" class="CLASS_3"'));

    // Check BOM
    assert(xml.includes('<Bom name="TitanSensor_RevB_BOM">'));
    assert(xml.includes('<BomItem refDes="U1">'));
    assert(xml.includes('<Category name="MPN" value="STM32L011K4T6"/>'));

    // Check ECAD LayerStack and Padstacks
    assert(xml.includes('<LayerStack name="DEFAULT_STACKUP">'));
    assert(xml.includes('<LayerDef name="TopCopper" type="CONDUCTOR"'));
    assert(xml.includes('<PadstackDef name="PAD_ROUNDRECT_W1500_H600_D0">'));

    // Check Placed Components & Logical Nets
    assert(xml.includes('<Component refDes="U1" packageRef="SOIC-8" layer="TopCopper" side="TOP"'));
    assert(xml.includes('<Component refDes="D1" packageRef="SOD-123" layer="BottomCopper" side="BOTTOM"'));
    assert(xml.includes('<LogicalNet name="VCC">'));
    assert(xml.includes('<PinRef componentRef="U1" pin="1"/>'));

    // Check Tracks and Outline
    assert(xml.includes('<Track layer="TopCopper" net="VCC" width="0.2500" x1="10.0000" y1="10.0000"'));
    assert(xml.includes("<BoardProfile>"));
    assert(xml.includes('<Vertex x="80.0000" y="50.0000"/>'));
  });

  it("compiles layout into ODB++ v8.1 archive hierarchy and packs into USTAR tar", () => {
    const odb = compileToODB(sampleLayout, {
      jobName: "titan_sensor",
      units: "MM",
    });

    // Check files dictionary
    assert(odb.files.has("matrix/matrix"), "ODB++ must contain matrix/matrix");
    assert(odb.files.has("misc/info"), "ODB++ must contain misc/info");
    assert(odb.files.has("steps/pcb/layers/top_copper/features"), "Must contain top_copper features");
    assert(odb.files.has("steps/pcb/layers/bottom_copper/features"), "Must contain bottom_copper features");
    assert(odb.files.has("steps/pcb/layers/outline/features"), "Must contain outline features");
    assert(odb.files.has("steps/pcb/eda/data"), "Must contain eda/data");
    assert(odb.files.has("steps/pcb/netlists/cad/netlist"), "Must contain cad/netlist");

    // Inspect matrix
    const matrix = odb.files.get("matrix/matrix")!;
    assert(matrix.includes("NAME=top_copper"));
    assert(matrix.includes("TYPE=SIGNAL"));
    assert(matrix.includes("NAME=drill"));

    // Inspect EDA data
    const eda = odb.files.get("steps/pcb/eda/data")!;
    assert(eda.includes("PKG SOIC-8"));
    assert(eda.includes("CMP U1 SOIC-8 10.0000 10.6350 0.0 TOP"));
    assert(eda.includes("CMP D1 SOD-123 50.0000 30.0000 180.0 BOT"));

    // Inspect CAD netlist
    const netlist = odb.files.get("steps/pcb/netlists/cad/netlist")!;
    assert(netlist.includes("$NET VCC"));
    assert(netlist.includes("U1 1"));

    // Inspect layer features
    const topFeat = odb.files.get("steps/pcb/layers/top_copper/features")!;
    assert(topFeat.includes("round250")); // 0.25mm trace aperture
    assert(topFeat.includes("oval1500x600")); // roundrect pad aperture
    assert(topFeat.includes("L 10.0000 10.0000 20.0000 20.0000")); // trace draw line

    // Pack into USTAR archive
    const tarBytes = odb.toTar();
    assert(tarBytes.length > 0);
    assert.strictEqual(tarBytes.length % 512, 0, "Tar archive must be multiple of 512 bytes");

    // Check USTAR header magic at offset 257 in first block
    const magic = new TextDecoder().decode(tarBytes.subarray(257, 262));
    assert.strictEqual(magic, "ustar", "Tar header must contain ustar magic");
  });

  it("evaluates CM capability DFM/DFA/DFT rules: acid traps, copper imbalance, tombstoning, and ICT coverage", () => {
    const drcResult = runDRC({
      rules: {
        ...CM_STANDARD_RULES,
        checkReflowShadowing: true,
      },
      boardOutline: [
        { x: 0, y: 0 },
        { x: 50, y: 0 },
        { x: 50, y: 50 },
        { x: 0, y: 50 },
      ],
      expectedNets: new Map([
        ["VCC", ["U1.1", "C1.1"]],
        ["GND", ["U1.2", "C1.2"]],
        ["UNCOVERED_SENSE", ["U1.3"]], // Net without testpoints
      ]),
      traces: [
        // 1. Acute bend angle (30 degrees -> acid trap)
        {
          points: [
            { x: 5, y: 5 },
            { x: 10, y: 10 },
            { x: 5, y: 12 }, // Sharp turn backwards
          ],
          width: 0.2,
          layer: "TopCopper",
          netId: "VCC",
          selected: false,
        },
        // 2. Wide trace connected to R1 pad 1 (0.8mm)
        {
          points: [
            { x: 20, y: 20 },
            { x: 22, y: 20 },
          ],
          width: 0.8,
          layer: "TopCopper",
          netId: "VCC",
          selected: false,
        },
        // 3. Thin trace connected to R1 pad 2 (0.2mm) -> Tombstoning risk (0.8mm vs 0.2mm = 4x)
        {
          points: [
            { x: 24, y: 20 },
            { x: 26, y: 20 },
          ],
          width: 0.2,
          layer: "TopCopper",
          netId: "GND",
          selected: false,
        },
      ],
      pads: [
        {
          center: { x: 22, y: 20 },
          width: 0.6,
          height: 0.6,
          shape: "rect",
          layer: "TopCopper",
          netId: "VCC",
          component: "R1",
          pinName: "1",
          selected: false,
        },
        {
          center: { x: 24, y: 20 },
          width: 0.6,
          height: 0.6,
          shape: "rect",
          layer: "TopCopper",
          netId: "GND",
          component: "R1",
          pinName: "2",
          selected: false,
        },
      ],
      vias: [
        // Probeable via for GND
        {
          center: { x: 30, y: 30 },
          drillRadius: 0.3, // 0.6mm diameter >= 0.4mm
          outerRadius: 0.5,
          netId: "GND",
          selected: false,
        },
        // Probeable via for VCC
        {
          center: { x: 35, y: 35 },
          drillRadius: 0.3,
          outerRadius: 0.5,
          netId: "VCC",
          selected: false,
        },
      ],
      components: [
        // Tall electrolytic cap (4.5mm) next to low 0402 part (0.6mm) at distance 2.0mm
        { name: "C_BULK", footprint: "CAP_D8", center: { x: 40, y: 40 }, heightMm: 4.5 },
        { name: "R_SENSE", footprint: "0402", center: { x: 42, y: 40 }, heightMm: 0.6 },
      ],
    });

    const ruleNames = drcResult.violations.map((v) => v.rule);

    // 1. Acid trap detected
    assert(ruleNames.includes("acid-trap"), "Should detect acute angle acid trap");
    const acidTrap = drcResult.violations.find((v) => v.rule === "acid-trap")!;
    assert(acidTrap.message.includes("acid trap risk"));

    // 2. Copper imbalance detected (all copper on TopCopper, zero on BottomCopper)
    assert(ruleNames.includes("copper-imbalance"), "Should detect top/bottom copper density imbalance");

    // 3. Tombstoning risk detected on R1
    assert(ruleNames.includes("tombstoning-risk"), "Should detect tombstoning risk on R1 with 4x trace asymmetry");
    const tombstone = drcResult.violations.find((v) => v.rule === "tombstoning-risk")!;
    assert(tombstone.affectedObjects.includes("R1"));

    // 4. DFT uncovered test net detected on UNCOVERED_SENSE
    assert(ruleNames.includes("dft-uncovered-test-net"), "Should flag net without testpoint");
    const dft = drcResult.violations.find((v) => v.rule === "dft-uncovered-test-net")!;
    assert(dft.affectedObjects.includes("UNCOVERED_SENSE"));

    // 5. Reflow shadow detected between C_BULK and R_SENSE
    assert(ruleNames.includes("reflow-shadow"), "Should detect reflow shadow between tall and small components");
    const shadow = drcResult.violations.find((v) => v.rule === "reflow-shadow")!;
    assert(shadow.affectedObjects.includes("C_BULK"));
    assert(shadow.affectedObjects.includes("R_SENSE"));
  });
});
