// SPDX-License-Identifier: AGPL-3.0-or-later

import type { PCBLayout } from "@modelscript/cad/ecad";
import express from "express";
import assert from "node:assert";
import { describe, it } from "node:test";
import { rfqRouter } from "../src/routes/rfq.js";
import { RfqBundleGenerator } from "../src/services/rfq/rfq-bundle-generator.js";
import { getSpaceDomainPreset } from "../src/services/spaces/domain-presets.js";
import { EngineeringQueryService } from "../src/services/spaces/engineering-query-service.js";

describe("Smart RFQ Bundle Generator & Ansatz CM Portal Workflows", () => {
  const sampleLayout: PCBLayout = {
    traces: [
      { start: [10, 10], end: [20, 20], width: 0.25, layer: "TopCopper", net: "VCC" },
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
        center: [20, 20],
        width: 0.8,
        height: 0.8,
        drill: 0,
        shape: "rect",
        layer: "TopCopper",
        net: "VCC",
        component: "C1",
      },
    ],
    vias: [{ center: [20, 20], drill: 0.3, annularRing: 0.15, net: "VCC" }],
    outline: {
      vertices: [
        [0, 0],
        [60, 0],
        [60, 40],
        [0, 40],
      ],
    },
    netlist: {
      totalPins: 2,
      totalConnections: 1,
      nets: [
        {
          id: "VCC",
          pins: [
            { name: "U1.1", component: "U1", localName: "1" },
            { name: "C1.1", component: "C1", localName: "1" },
          ],
        },
      ],
      components: [
        {
          name: "U1",
          pins: ["1"],
          placement: { x: 10, y: 10, angle: 0, layer: "TopCopper", footprint: "SOIC-8" },
        },
        {
          name: "C1",
          pins: ["1"],
          placement: { x: 20, y: 20, angle: 0, layer: "TopCopper", footprint: "0603" },
        },
      ],
    },
  };

  it("loads the 'fabless_electronics' Space domain preset with specialized CM channels", () => {
    const preset = getSpaceDomainPreset("fabless_electronics");
    assert.strictEqual(preset.id, "fabless_electronics");
    assert.strictEqual(preset.shortLabel, "Fabless Electronics");
    assert(preset.complianceStandards.includes("IPC-2581C (DPMX)"));
    assert(preset.complianceStandards.includes("ODB++ v8.1"));

    const channelSlugs = preset.defaultChannels.map((c) => c.slug);
    assert(channelSlugs.includes("dfm-review"));
    assert(channelSlugs.includes("engineering-queries"));
    assert(channelSlugs.includes("production-releases"));
    assert(channelSlugs.includes("telemetry-qc"));
  });

  it("generates a complete, cryptographically verified Smart RFQ bundle", async () => {
    const bundle = await RfqBundleGenerator.generateBundle({
      projectName: "TitanEdgeCompute",
      revision: "2.1.0",
      oemName: "Acme Autonomous Corp",
      oemContact: "hw-leads@acme.com",
      layout: sampleLayout,
      bomComponents: [
        { refDes: "U1", mpn: "STM32H743IIT6", footprint: "LQFP-176" },
        { refDes: "C1", mpn: "GRM188R71C105KA12D", footprint: "0603" },
      ],
      targetQuantity: 2500,
      fabricationSpecs: {
        surfaceFinish: "ENIG",
        ipcClass: "Class 3",
        layers: 4,
      },
    });

    // 1. Verify Manifest
    assert.strictEqual(bundle.manifest.project, "TitanEdgeCompute");
    assert.strictEqual(bundle.manifest.revision, "2.1.0");
    assert.strictEqual(bundle.manifest.fabricationSpecs.ipcClass, "Class 3");
    assert.strictEqual(bundle.manifest.fabricationSpecs.surfaceFinish, "ENIG");

    // 2. Verify Generated Files
    assert(bundle.files.has("manifest.json"));
    assert(bundle.files.has("ecad/assembly.xml")); // IPC-2581C
    assert(bundle.files.has("ecad/odb/matrix/matrix")); // ODB++
    assert(bundle.files.has("ecad/gerber/TopCopper.gbr")); // Gerber
    assert(bundle.files.has("ecad/gerber/drill.xln")); // Excellon
    assert(bundle.files.has("assembly/pnp_normalized.csv")); // Centroid
    assert(bundle.files.has("assembly/pnp_jlcpcb.csv")); // JLCPCB CPL
    assert(bundle.files.has("assembly/pnp_macrofab.xy")); // MacroFab XY
    assert(bundle.files.has("supply-chain/bom_engineering.csv")); // eBOM
    assert(bundle.files.has("supply-chain/bom_manufacturing.csv")); // mBOM
    assert(bundle.files.has("assembly/fabrication_notes.txt")); // Notes
    assert(bundle.files.has("compliance/IPC-1752A_Materials_Declaration.xml")); // IPC-1752A
    assert(bundle.files.has("compliance/CMRT_v6.4_Conflict_Minerals.json")); // CMRT
    assert(bundle.files.has("compliance/RoHS_REACH_Certificate_of_Conformance.md")); // RoHS/REACH CoC

    // 3. Verify SHA-256 Hashes in Manifest
    const xmlEntry = bundle.manifest.files.find((f) => f.path === "ecad/assembly.xml")!;
    assert(xmlEntry);
    assert.strictEqual(xmlEntry.format, "IPC-2581C (DPMX)");
    assert.strictEqual(xmlEntry.sha256.length, 64, "SHA-256 must be 64 hex characters");

    const ipcEntry = bundle.manifest.files.find((f) => f.path === "compliance/IPC-1752A_Materials_Declaration.xml")!;
    assert(ipcEntry);
    assert.strictEqual(ipcEntry.sha256.length, 64);

    // 4. Verify Tar Archive
    assert(bundle.tarArchive.length > 0);
    assert.strictEqual(bundle.tarArchive.length % 512, 0);
  });

  it("files and resolves spatial pin-annotated Engineering Queries (EQ)", () => {
    const eqService = new EngineeringQueryService();

    // 1. CM engineer files query on pad U1
    const eq = eqService.createEQ({
      spaceId: "space-alpha-99",
      revision: "2.1.0",
      boardCoordinates: [10.0, 10.0],
      layer: "TopCopper",
      refDes: "U1",
      net: "VCC",
      title: "Clearance margin on U1 pad",
      description: "Pad to trace spacing is 0.18mm, our automated line asks for 0.20mm. Approve waiver?",
      severity: "major",
      authorId: "cm-user-1",
      authorName: "John CM DFM",
      authorOrg: "Apex EMS Partners",
    });

    assert(eq.id.startsWith("eq-"));
    assert.strictEqual(eq.status, "open");
    assert.deepStrictEqual(eq.boardCoordinates, [10.0, 10.0]);

    // 2. List queries for space
    const list = eqService.listEQsForSpace("space-alpha-99");
    assert.strictEqual(list.length, 1);
    assert.strictEqual(list[0]!.id, eq.id);

    // 3. OEM engineer resolves with approved deviation
    const resolved = eqService.resolveEQ(eq.id, {
      status: "approved_deviation",
      resolutionNotes: "Approved 0.18mm waiver for low-voltage logic signal; verified in ModelScript DRC.",
      resolvedById: "oem-lead-1",
      resolvedByName: "Lead Hardware Architect",
    });

    assert(resolved !== null);
    assert.strictEqual(resolved.status, "approved_deviation");
    assert(resolved.resolutionNotes.includes("Approved 0.18mm waiver"));
    assert.strictEqual(resolved.resolvedByName, "Lead Hardware Architect");
    assert(resolved.resolvedAt !== undefined);
  });

  it("handles REST API endpoints for RFQ generation, download, and EQ resolution", async () => {
    const eqService = new EngineeringQueryService();
    const app = express();
    app.use(express.json());
    app.use("/api/v1/spaces", rfqRouter(eqService));

    const server = app.listen(0);
    const address = server.address() as any;
    const port = address.port;
    const baseUrl = `http://127.0.0.1:${port}/api/v1/spaces/test-space`;

    try {
      // 1. POST /rfq
      const rfqRes = await fetch(`${baseUrl}/rfq`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          projectName: "RoboticsHub",
          revision: "1.0.0",
          layout: sampleLayout,
          bomComponents: [{ refDes: "U1", mpn: "STM32" }],
        }),
      });

      assert.strictEqual(rfqRes.status, 200);
      const rfqData = (await rfqRes.json()) as any;
      assert.strictEqual(rfqData.success, true);
      assert(rfqData.totalFilesGenerated > 5);

      // 2. GET /rfq/latest
      const latestRes = await fetch(`${baseUrl}/rfq/latest`);
      assert.strictEqual(latestRes.status, 200);
      const latestData = (await latestRes.json()) as any;
      assert.strictEqual(latestData.manifest.project, "RoboticsHub");

      // 3. GET /rfq/download
      const downloadRes = await fetch(`${baseUrl}/rfq/download`);
      assert.strictEqual(downloadRes.status, 200);
      assert.strictEqual(downloadRes.headers.get("content-type"), "application/x-tar");
      const downloadBytes = await downloadRes.arrayBuffer();
      assert(downloadBytes.byteLength > 0);

      // 4. POST /eq
      const eqRes = await fetch(`${baseUrl}/eq`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          revision: "1.0.0",
          boardCoordinates: [25.0, 15.0],
          layer: "BottomCopper",
          title: "Solder mask dam inspection",
          description: "Solder mask sliver between bottom pads is 0.08mm.",
          severity: "minor",
        }),
      });
      assert.strictEqual(eqRes.status, 201);
      const eqData = (await eqRes.json()) as any;
      assert(eqData.id.startsWith("eq-"));

      // 5. GET /eq
      const listRes = await fetch(`${baseUrl}/eq`);
      assert.strictEqual(listRes.status, 200);
      const listData = (await listRes.json()) as any;
      assert.strictEqual(listData.totalQueries, 1);

      // 6. PATCH /eq/:eqId
      const patchRes = await fetch(`${baseUrl}/eq/${eqData.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          status: "approved_deviation",
          resolutionNotes: "Concur with EMS recommendation.",
        }),
      });
      assert.strictEqual(patchRes.status, 200);
      const patchData = (await patchRes.json()) as any;
      assert.strictEqual(patchData.status, "approved_deviation");
    } finally {
      server.close();
    }
  });
});
