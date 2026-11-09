// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert";
import test from "node:test";
import {
  evaluateSrlgDisjointness,
  findNetworkSrlgSpofs,
  locateOtdrFault,
  type SrlgNetwork,
  type SrlgPath,
} from "../src/index.js";

test("Fiber SRLG risk disjointness and OTDR fault geolocation", async (t) => {
  await t.test("evaluates SRLG physical disjointness and detects common conduit risks", () => {
    const network: SrlgNetwork = {
      nodes: [
        { id: "CO_NORTH", name: "North Central Office" },
        { id: "MH_1", name: "Manhole 1" },
        { id: "MH_2", name: "Manhole 2" },
        { id: "MH_3", name: "Manhole 3" },
        { id: "DATACENTER_SOUTH", name: "South Datacenter" },
      ],
      segments: [
        // Path A segments
        {
          segmentId: "SEG-1",
          fromNodeId: "CO_NORTH",
          toNodeId: "MH_1",
          cableId: "C1",
          lengthMeters: 500,
          srlgIds: ["DUCT-NORTH-AVE"],
        },
        {
          segmentId: "SEG-2",
          fromNodeId: "MH_1",
          toNodeId: "MH_2",
          cableId: "C2",
          lengthMeters: 1200,
          srlgIds: ["BRIDGE-I95"],
        },
        {
          segmentId: "SEG-3",
          fromNodeId: "MH_2",
          toNodeId: "DATACENTER_SOUTH",
          cableId: "C3",
          lengthMeters: 800,
          srlgIds: ["TRENCH-SOUTH-RD"],
        },
        // Path B segments (partially shared on BRIDGE-I95!)
        {
          segmentId: "SEG-4",
          fromNodeId: "CO_NORTH",
          toNodeId: "MH_3",
          cableId: "C4",
          lengthMeters: 600,
          srlgIds: ["AERIAL-EAST-LINE"],
        },
        {
          segmentId: "SEG-5",
          fromNodeId: "MH_3",
          toNodeId: "MH_2",
          cableId: "C5",
          lengthMeters: 1100,
          srlgIds: ["BRIDGE-I95"],
        }, // Shared risk!
        {
          segmentId: "SEG-6",
          fromNodeId: "MH_2",
          toNodeId: "DATACENTER_SOUTH",
          cableId: "C6",
          lengthMeters: 900,
          srlgIds: ["DUCT-PARKWAY"],
        },
      ],
    };

    const pathA: SrlgPath = {
      pathId: "PRIMARY-CIRCUIT-100G",
      segmentIds: ["SEG-1", "SEG-2", "SEG-3"],
      totalLengthMeters: 2500,
      srlgIds: new Set(["DUCT-NORTH-AVE", "BRIDGE-I95", "TRENCH-SOUTH-RD"]),
    };

    const pathB: SrlgPath = {
      pathId: "PROTECTION-CIRCUIT-100G",
      segmentIds: ["SEG-4", "SEG-5", "SEG-6"],
      totalLengthMeters: 2600,
      srlgIds: new Set(["AERIAL-EAST-LINE", "BRIDGE-I95", "DUCT-PARKWAY"]),
    };

    const report = evaluateSrlgDisjointness(pathA, pathB, network);
    assert.equal(report.isFullyDisjoint, false, "Paths must not be considered fully disjoint due to shared bridge");
    assert.deepEqual(report.sharedSrlgIds, ["BRIDGE-I95"]);
    assert.ok(report.diversityScore < 1.0 && report.diversityScore > 0.5);

    // SPOF Detection
    const spofs = findNetworkSrlgSpofs([pathA, pathB], network);
    assert.equal(spofs.length, 1);
    assert.equal(spofs[0]!.srlgId, "BRIDGE-I95");
    assert.equal(spofs[0]!.riskType, "Bridge Crossing");
  });

  await t.test("geolocates OTDR optical break distance along GIS cable route with helix factor", () => {
    // 1 km long straight-line cable along 74th meridian (approx ~0.009 deg lat per km)
    const cable: FiberCableSpan = {
      id: "CABLE-OSP-72F",
      name: "Feeder 72F Metro Ring",
      fromNodeId: "CO_NORTH",
      toNodeId: "DATACENTER_SOUTH",
      strandCount: 72,
      fibersPerTube: 12,
      fiberType: "G.652.D",
      sheathLengthMeters: 1000,
      slackLengthMeters: 0,
      helixFactor: 1.03, // 3% extra fiber length due to helical stranding
      pathCoordinates: [
        [-74.006, 40.7128], // Start: City Hall
        [-74.006, 40.7173], // Midpoint (~500m north)
        [-74.006, 40.7218], // End (~1000m north)
      ],
    };

    const vaultEnclosure: FiberStructureNode = {
      id: "VAULT-MH-05",
      name: "Splice Vault MH-05",
      nodeType: "manhole",
      coordinates: [-74.006, 40.7173],
      slackStorageMeters: 20.0, // 20m slack coil
    };

    // OTDR detects reflection/break at 535.6 meters optical
    // 535.6 m optical / 1.03 = 520 m physical sheath
    // Minus 20m slack stored at MH-05 = 500 m along the route
    const result = locateOtdrFault({
      cable,
      opticalDistanceMeters: 535.6,
      helixFactor: 1.03,
      enclosures: [vaultEnclosure],
    });

    assert.equal(result.cableId, "CABLE-OSP-72F");
    assert.ok(
      Math.abs(result.physicalSheathDistanceMeters - 500.0) < 5.0,
      `Expected ~500m, got ${result.physicalSheathDistanceMeters}`,
    );
    // Midpoint coordinates
    assert.ok(Math.abs(result.gpsCoordinate[0] - -74.006) < 0.0001);
    assert.ok(Math.abs(result.gpsCoordinate[1] - 40.7173) < 0.0002);
    // Nearest enclosure should be VAULT-MH-05
    assert.ok(result.nearestEnclosure !== undefined);
    assert.equal(result.nearestEnclosure.id, "VAULT-MH-05");
    assert.ok(result.nearestEnclosure.distanceToFaultMeters < 30.0);
  });
});
