// SPDX-License-Identifier: AGPL-3.0-or-later

import { createSorDocument, writeSor } from "@modelscript/optical";
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { createModelScriptMcpServer } from "../src/factory.js";
import type { ServerContext } from "../src/types.js";

describe("Telecom Utilities MCP Tools Integration Suite", () => {
  const ctx: ServerContext = { current: null };
  const server = createModelScriptMcpServer(ctx);
  const tools = (server as any)._registeredTools;

  it("registers all 4 telecom tools", () => {
    assert.ok(tools["optical_inspect_otdr"], "optical_inspect_otdr should be registered");
    assert.ok(tools["optical_solve_transmission"], "optical_solve_transmission should be registered");
    assert.ok(tools["ran_solve_microwave_budget"], "ran_solve_microwave_budget should be registered");
    assert.ok(tools["fiber_locate_otdr_fault"], "fiber_locate_otdr_fault should be registered");
  });

  it("optical_inspect_otdr analyzes binary SOR trace and assesses Telcordia compliance", async () => {
    const doc = createSorDocument(
      "2.0",
      [],
      {
        cableId: "FIBER-TRUNK-01",
        fiberId: "STRAND-4",
        fiberType: "G.652.D",
        nominalWavelengthNm: 1550,
        originLocation: "CentralOffice-A",
        terminateLocation: "CellTower-B",
        cableCode: "OSP-72F",
        currentCondition: "Normal",
        operator: "Tech-1",
        comments: "Routine OTDR verification",
      },
      {
        supplierName: "Anritsu",
        otdrName: "MT9085",
        otdrSerialNumber: "AN-10023",
        moduleName: "SMF",
        moduleSerialNumber: "MOD-01",
        softwareVersion: "4.12",
      },
      {
        dateTime: new Date("2026-11-09T00:00:00Z"),
        distanceUnits: "km",
        actualWavelengthNm: 1550,
        acquisitionOffset: 0,
        pulseWidthNs: 100,
        sampleSpacingNs: 1.0,
        numPoints: 100,
        refractiveIndex: 1.4682,
        backscatterCoefficientDb: -79.0,
        numAverages: 1000,
        rangeKm: 10.0,
        frontPanelLossDb: 0.1,
      },
      {
        numPoints: 100,
        scalingFactor: 1000,
        powerDb: new Float64Array(100),
        distanceMeters: new Float64Array(100),
      },
      [
        {
          eventNumber: 1,
          distanceMeters: 5000,
          slopeDbPerKm: 0.2,
          eventLossDb: 0.15,
          reflectanceDb: -55.0,
          eventCode: "0999",
          eventType: "non-reflective",
          leadInLossDb: 1.0,
          comments: "Splice vault #2",
        },
        {
          eventNumber: 2,
          distanceMeters: 10000,
          slopeDbPerKm: 0.2,
          eventLossDb: 1.8,
          reflectanceDb: -26.0,
          eventCode: "2999",
          eventType: "end-of-fiber",
          leadInLossDb: 2.1,
          comments: "Patch panel B",
        },
      ],
    );

    const binary = writeSor(doc);
    const base64 = Buffer.from(binary).toString("base64");

    const tool = tools["optical_inspect_otdr"];
    const res = await tool.handler({ base64Data: base64 });
    assert.ok(!res.isError);
    const parsed = JSON.parse(res.content[0].text);
    assert.equal(parsed.success, true);
    assert.equal(parsed.fiberId, "STRAND-4");
    assert.equal(parsed.cableId, "FIBER-TRUNK-01");
    assert.equal(parsed.wavelengthNm, 1550);
    assert.equal(parsed.complianceVerdict, "PASS_TELCORDIA_GR196");
    assert.equal(parsed.totalEvents, 2);
  });

  it("optical_solve_transmission evaluates multi-span GSNR and dispersion", async () => {
    const tool = tools["optical_solve_transmission"];
    const res = await tool.handler({
      totalDistanceKm: 320,
      spanLengthKm: 80,
      channelCount: 80,
      baudRateGbaud: 64,
      launchPowerDbm: 0.0,
      edfaNoiseFigureDb: 5.5,
      fiberType: "SSMF",
    });

    assert.ok(!res.isError);
    const parsed = JSON.parse(res.content[0].text);
    assert.equal(parsed.success, true);
    assert.equal(parsed.numberOfSpans, 4);
    assert.ok(parsed.gsnrDb > 10.0, `GSNR should be realistic (>10 dB), got ${parsed.gsnrDb}`);
    assert.ok(parsed.accumulatedDispersionPsPerNm > 4000, "Dispersion should accumulate across 320 km SSMF");
  });

  it("ran_solve_microwave_budget computes FSPL, rain fade, and five-nines availability", async () => {
    const tool = tools["ran_solve_microwave_budget"];
    const res = await tool.handler({
      frequencyGhz: 11.0,
      pathLengthKm: 15.0,
      txPowerDbm: 15.0,
      txAntennaGainDbi: 39.0,
      rxAntennaGainDbi: 39.0,
      txFeederLossDb: 1.5,
      rxFeederLossDb: 1.5,
      rxThresholdDbm: -72.0,
      rainRateMmPerHour: 42.0,
      polarization: "V",
    });

    assert.ok(!res.isError);
    const parsed = JSON.parse(res.content[0].text);
    assert.equal(parsed.success, true);
    assert.ok(parsed.freeSpacePathLossDb > 130.0, "FSPL for 11GHz/15km should be > 130 dB");
    assert.ok(parsed.annualAvailabilityPercent > 99.9, "Should achieve high availability");
    assert.equal(parsed.fccPart101Compliant, true);
  });

  it("fiber_locate_otdr_fault converts optical length into physical GIS GPS coordinates", async () => {
    const tool = tools["fiber_locate_otdr_fault"];
    const res = await tool.handler({
      opticalDistanceMeters: 5150,
      helixFactor: 1.03,
      cableCoordinates: [
        [-74.006, 40.7128],
        [-74.016, 40.7228],
        [-74.026, 40.7328],
      ],
      enclosures: [
        {
          id: "ENC-1",
          name: "Vault-1",
          nodeType: "manhole",
          coordinates: [-74.006, 40.7128],
          slackStorageMeters: 50,
        },
      ],
    });

    assert.ok(!res.isError);
    const parsed = JSON.parse(res.content[0].text);
    assert.equal(parsed.success, true);
    assert.ok(parsed.physicalSheathDistanceMeters > 0);
    assert.ok(parsed.gpsCoordinate.longitude < 0);
    assert.ok(parsed.gpsCoordinate.latitude > 0);
  });

  it("ran_evaluate_mpe_safety calculates power densities, boundaries, and signage", async () => {
    const tool = tools["ran_evaluate_mpe_safety"];
    const res = await tool.handler({
      siteId: "SITE-TEST",
      siteName: "Downtown Cell Tower",
      emitters: [
        {
          id: "SEC-1",
          name: "PCS Sector 1",
          frequencyMhz: 1900,
          txPowerWatts: 40.0,
          antennaGainDbi: 18.0,
          antennaHeightMeters: 30.0,
          azimuthDeg: 0.0,
          downTiltDeg: 2.0,
        },
      ],
      studyPoints: [
        { x: 0, y: 50, z: 2 },
      ],
    });

    assert.ok(!res.isError);
    const parsed = JSON.parse(res.content[0].text);
    assert.ok(parsed.boundaries.length === 1);
    assert.ok(parsed.boundaries[0].mainBeamExclusionDistanceGeneralPopMeters > 0);
    assert.ok(parsed.evaluationPoints.length === 1);
    assert.ok(parsed.evaluationPoints[0].terGeneralPopulation > 0);
  });

  it("ran_evaluate_faa_obstruction checks 14 CFR Part 77 criteria and runway slopes", async () => {
    const tool = tools["ran_evaluate_faa_obstruction"];
    const res = await tool.handler({
      latitude: 40.7128,
      longitude: -74.006,
      structureHeightMeters: 70.0, // ~230 ft AGL (>200 ft threshold)
      groundElevationMeters: 10.0,
      structureType: "tower",
      siteName: "Proposed Guyed Mast",
    });

    assert.ok(!res.isError);
    const parsed = JSON.parse(res.content[0].text);
    assert.equal(parsed.requiresFaaNotice, true);
    assert.equal(parsed.obstructionStandardFindings.exceeds200FtAglThreshold, true);
    assert.equal(parsed.form74601Data.noticeFilingDetermination, "NOTICE_REQUIRED");
  });

  it("fiber_generate_bdc_fabric discretizes GIS points into H3 hexagons and formats BDC CSV", async () => {
    const tool = tools["fiber_generate_bdc_fabric"];
    const res = await tool.handler({
      sampleCoordinates: [
        [-74.006, 40.7128],
        [-74.007, 40.7135],
        [-74.008, 40.7142],
      ],
      techCode: 50,
      maxDownloadMbps: 1000,
      maxUploadMbps: 1000,
      lowLatency: true,
      resolution: "9",
      providerName: "ModelScript Fiber Co",
    });

    assert.ok(!res.isError);
    const parsed = JSON.parse(res.content[0].text);
    assert.equal(parsed.success, true);
    assert.ok(parsed.totalHexagons >= 1);
    assert.equal(parsed.technologyCode, 50);
    assert.ok(parsed.csvPreview.includes("h3_index,technology"));
  });

  it("telecom_evaluate_nors_outage evaluates Part 4 reporting thresholds and creates filing dossier", async () => {
    const tool = tools["telecom_evaluate_nors_outage"];
    const res = await tool.handler({
      outageId: "OUTAGE-2026-001",
      serviceProviderName: "Atlas Telecom",
      startTimeIso: new Date(Date.now() - 3600000).toISOString(),
      durationMinutes: 120,
      affectedUsersEstimate: 10000, // 1,200,000 user-minutes (> 900,000)
      is911Affected: false,
      rootCauseDescription: "Fiber backhaul cut during highway excavation",
      filingStage: "notification",
    });

    assert.ok(!res.isError);
    const parsed = JSON.parse(res.content[0].text);
    assert.equal(parsed.outageId, "OUTAGE-2026-001");
    // If EE is present, dossier is created; if community, report is generated
    const isReportable = parsed.isReportableUnderPart4 ?? parsed.eventSummary?.userMinutes >= 900000;
    assert.ok(isReportable, "Outage exceeding 900k user-minutes should be reportable");
  });

  it("ran_evaluate_mpe_safety evaluates Health Canada Safety Code 6 standard", async () => {
    const tool = tools["ran_evaluate_mpe_safety"];
    const res = await tool.handler({
      siteId: "SITE-CANADA-01",
      siteName: "Montreal Macro Site",
      standard: "HEALTH_CANADA_SC6",
      emitters: [
        {
          id: "ANT-CAN-1",
          name: "3500 MHz Massive MIMO",
          frequencyMhz: 3500,
          eirpWatts: 1600,
          antennaHeightMeters: 25,
        },
      ],
      studyPoints: [{ x: 0, y: 15, z: 25 }],
    });

    assert.ok(!res.isError);
    const parsed = JSON.parse(res.content[0].text);
    assert.equal(parsed.standard, "HEALTH_CANADA_SC6");
    assert.ok(parsed.boundaries[0].mainBeamExclusionDistanceGeneralPopMeters > 0);
  });

  it("ran_evaluate_faa_obstruction evaluates ICAO Annex 14 OLS surface criteria", async () => {
    const tool = tools["ran_evaluate_faa_obstruction"];
    const res = await tool.handler({
      latitude: 49.0097,
      longitude: 2.5479,
      structureHeightMeters: 110.0, // >100m ICAO baseline
      groundElevationMeters: 119.0,
      standard: "ICAO_ANNEX14",
    });

    assert.ok(!res.isError);
    const parsed = JSON.parse(res.content[0].text);
    assert.equal(parsed.standard, "ICAO_ANNEX14");
    assert.equal(parsed.isNotificationMandatory, true);
    assert.ok(parsed.notificationReasons.length >= 1);
  });

  it("fiber_evaluate_pole_loading calculates CSA C22.3 and Eurocode EN 50341 mast utilization", async () => {
    const tool = tools["fiber_evaluate_pole_loading"];

    // CSA C22.3 evaluation
    const resCsa = await tool.handler({
      standard: "CSA",
      poleId: "POLE-HQ-01",
      overallLengthMeters: 12.0,
      loadingDistrict: "severe",
      attachments: [
        {
          id: "FIBER-01",
          heightMeters: 8.0,
          bareDiameterMm: 15.0,
          spanLengthMeters: 50.0,
          weightKgPerMeter: 0.3,
        },
      ],
    });
    assert.ok(!resCsa.isError);
    const parsedCsa = JSON.parse(resCsa.content[0].text);
    assert.equal(parsedCsa.standard, "CSA_C22_3_NO1");
    assert.equal(parsedCsa.district, "severe");
    assert.ok(parsedCsa.poleCapacityUtilizationPercent > 0);

    // Eurocode evaluation
    const resEuro = await tool.handler({
      standard: "EUROCODE",
      poleId: "MAST-EU-01",
      overallLengthMeters: 18.0,
      attachments: [
        {
          id: "FIBER-EU-01",
          heightMeters: 16.0,
          bareDiameterMm: 20.0,
          spanLengthMeters: 40.0,
          weightKgPerMeter: 0.5,
        },
      ],
    });
    assert.ok(!resEuro.isError);
    const parsedEuro = JSON.parse(resEuro.content[0].text);
    assert.equal(parsedEuro.standard, "EN_50341_EUROCODE");
    assert.ok(parsedEuro.designBendingMomentEdNm > 0);
  });
});
