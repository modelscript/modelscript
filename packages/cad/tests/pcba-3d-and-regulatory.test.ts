// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  buildPopulatedPcbaAssembly,
  checkPcbaInterference,
  exportPopulatedPcbaToStep,
  generateDefaultRegulatoryPackage,
  type EnclosureGeometry,
  type PcbBoardGeometry,
  type PlacedComponent3D,
} from "../src/ecad/index.js";

describe("3D Populated PCBA Enclosure Clearance & Environmental Regulatory Declarations", () => {
  const pcb: PcbBoardGeometry = {
    name: "SensorHub_V2",
    width: 60.0, // X
    length: 40.0, // Z
    thickness: 1.6, // Y
  };

  const components: PlacedComponent3D[] = [
    {
      refDes: "U1",
      package: "QFN-32",
      center: { x: 30.0, y: 20.0 }, // Center of 60x40 board
      rotation: 0,
      layer: "Top",
    },
    {
      refDes: "J1",
      package: "USB-C",
      center: { x: 5.0, y: 20.0 }, // Board edge connector
      rotation: 90,
      layer: "Top",
    },
    {
      refDes: "R1",
      package: "0402",
      center: { x: 35.0, y: 22.0 },
      layer: "Top",
    },
    {
      refDes: "C1",
      package: "0402",
      center: { x: 25.0, y: 18.0 },
      layer: "Bottom", // Bottom placed passive
    },
    {
      refDes: "C_BULK",
      package: "ELECTROLYTIC_CAN_10x10", // 10.5mm height
      center: { x: 45.0, y: 15.0 },
      layer: "Top",
    },
  ];

  it("builds 3D populated PCBA assembly and detects tall capacitor collision in low-profile enclosure", () => {
    // Low profile enclosure with only 6mm vertical headroom above board
    // Board sits at Y = [-0.8, +0.8], so top surface is at Y = +0.8
    // With cavity.maxY = 8.0, total clearance above board is 7.2mm
    // But C_BULK is 10.5mm tall, so top of C_BULK is at 0.8 + 10.5 = 11.3mm, penetrating lid by > 3mm!
    const lowProfileEnclosure: EnclosureGeometry = {
      name: "Enclosure_Slim",
      wallThicknessMm: 1.5,
      internalCavity: {
        minX: -35.0,
        maxX: 35.0,
        minY: -4.0,
        maxY: 8.0, // Only 7.2mm headroom above board
        minZ: -25.0,
        maxZ: 25.0,
      },
    };

    const pcba = buildPopulatedPcbaAssembly(pcb, components, lowProfileEnclosure);

    assert.equal(pcba.assembly.parts.length, 8); // 1 board + 5 comps + 2 enclosure lids
    assert.equal(pcba.componentParts.size, 5);
    assert.equal(pcba.maxComponentHeightAboveBoardMm, 10.5);
    assert.ok(pcba.enclosureHeadroomMm! < 0, "Headroom must be negative for penetrating capacitor");

    const report = checkPcbaInterference(pcba);

    assert.equal(report.isCompliant, false, "Must fail compliance due to lid collision");
    assert.ok(report.collisions.length >= 1, "Must detect at least 1 collision");

    const lidCollision = report.collisions.find(
      (c) =>
        (c.partA === "Comp_C_BULK" && c.partB.includes("TopLid")) ||
        (c.partB === "Comp_C_BULK" && c.partA.includes("TopLid")),
    );
    assert.ok(lidCollision, "Collision between Comp_C_BULK and TopLid must be reported");
    assert.ok(lidCollision.penetrationDepthMm >= 1.5, "Penetration depth must be at least 1.5mm (lid thickness)");
  });

  it("passes 3D clearance in standard tall enclosure with sufficient headroom", () => {
    // Standard tall enclosure with 15mm headroom above board (cavity maxY = 20.0)
    const standardEnclosure: EnclosureGeometry = {
      name: "Enclosure_Standard",
      wallThicknessMm: 2.0,
      internalCavity: {
        minX: -40.0,
        maxX: 40.0,
        minY: -6.0,
        maxY: 20.0, // 19.2mm headroom above board
        minZ: -30.0,
        maxZ: 30.0,
      },
    };

    const pcba = buildPopulatedPcbaAssembly(pcb, components, standardEnclosure);
    const report = checkPcbaInterference(pcba);

    assert.ok(pcba.enclosureHeadroomMm! > 5.0, "Headroom must exceed 5mm");
    assert.equal(report.collisions.length, 0, "No collisions expected in spacious enclosure");
    assert.equal(report.isCompliant, true);
  });

  it("exports populated 3D PCBA and enclosure into valid ISO-10303-21 STEP format", () => {
    const pcba = buildPopulatedPcbaAssembly(pcb, components);
    const stepContent = exportPopulatedPcbaToStep(pcba);

    assert.ok(stepContent.includes("ISO-10303-21;"));
    assert.ok(stepContent.includes("HEADER;"));
    assert.ok(stepContent.includes("DATA;"));
    assert.ok(stepContent.includes("MANIFOLD_SOLID_BREP"));
    assert.ok(stepContent.includes("END-ISO-10303-21;"));
  });

  it("generates valid IPC-1752A XML materials declaration", () => {
    const regPkg = generateDefaultRegulatoryPackage("TITAN-CORE-V2", "Titanium Aerospace OEM");

    assert.ok(regPkg.ipc1752AXml.includes("<IPC-1752A"));
    assert.ok(regPkg.ipc1752AXml.includes("<ProductNumber>TITAN-CORE-V2</ProductNumber>"));
    assert.ok(regPkg.ipc1752AXml.includes("<RoHSStatus>Compliant</RoHSStatus>"));
    assert.ok(regPkg.ipc1752AXml.includes("<REACHStatus"));
    assert.ok(regPkg.ipc1752AXml.includes("<HalogenFree>true</HalogenFree>"));
    assert.ok(regPkg.ipc1752AXml.includes("Leadframe Copper Alloy C19400"));
    assert.ok(regPkg.ipc1752AXml.includes("Lead-Free Solder SAC305"));
  });

  it("generates valid RMI CMRT v6.4 conflict minerals reporting JSON", () => {
    const regPkg = generateDefaultRegulatoryPackage("TITAN-CORE-V2");
    const cmrt = JSON.parse(regPkg.cmrtJson);

    assert.equal(cmrt.cmrtVersion, "6.4");
    assert.equal(cmrt.declarationScope, "Product");
    assert.equal(cmrt.product.productNumber, "TITAN-CORE-V2");

    // Check RMI due diligence answers
    assert.equal(cmrt.dueDiligenceAnswers["1. Is any 3TG intentionally added or used in production?"], "Yes");
    assert.equal(cmrt.dueDiligenceAnswers["4. Do any 3TGs originate from Covered Countries (DRC or adjoining)?"], "No");

    // Check 3TG smelter list
    assert.equal(cmrt.smelterList.length, 3);
    const tinSmelter = cmrt.smelterList.find((s: any) => s.metal === "Tin");
    assert.ok(tinSmelter);
    assert.equal(tinSmelter.smelterName, "PT Timah Tbk");
    assert.equal(tinSmelter.auditStatus, "Conformant");
  });

  it("generates auditable Certificate of Conformance markdown", () => {
    const regPkg = generateDefaultRegulatoryPackage("TITAN-CORE-V2", "Titanium Aerospace OEM");

    assert.ok(regPkg.certificateMd.includes("# Certificate of Environmental Regulatory Conformance"));
    assert.ok(regPkg.certificateMd.includes("EU RoHS 3 Conformance (Directive 2015/863"));
    assert.ok(regPkg.certificateMd.includes("EU REACH SVHC Declaration (Regulation EC No 1907/2006)"));
    assert.ok(regPkg.certificateMd.includes("Lead (Pb)"));
    assert.ok(regPkg.certificateMd.includes("Titanium Aerospace OEM"));
  });
});
