// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert/strict";
import test, { describe } from "node:test";
import {
  acceptPackageTransfer,
  addPackageCollaborator,
  cancelPackageTransfer,
  getDiagramUrl,
  getIconUrl,
  getPackageAasxExportUrl,
  getPackageCollaborators,
  getPackageDownloadUrl,
  getPackageOkhExportUrl,
  getPackageSalsaIndexUrl,
  getPendingPackageTransfers,
  type LibraryListItem,
  publishPackageArchive,
  removePackageCollaborator,
  rewriteModelicaUris,
  unpublishPackageRelease,
} from "../src/api";
import {
  buildClassTree,
  categorizeClassComponents,
  classifyClassDomain,
  filterClassTree,
  resolveTypeTargetUrl,
} from "../src/components/classTreeUtils";
import { filterAndSortLibraries, inspectPackageZip, isValidSemver } from "../src/util/package-helpers";
import { encodePackagePath, resolvePackageParams } from "../src/util/url";

/**
 * Helper to construct a minimal valid ZIP buffer with STORED (method 0) files
 * for testing `inspectPackageZip`.
 */
function buildStoredZip(entries: { name: string; content: string }[]): Uint8Array {
  const encoder = new TextEncoder();
  const localParts: Uint8Array[] = [];
  const cdParts: Uint8Array[] = [];
  let offset = 0;

  for (const entry of entries) {
    const nameBytes = encoder.encode(entry.name);
    const dataBytes = encoder.encode(entry.content);

    // Local file header (30 bytes + name + data)
    const localHeader = new Uint8Array(30 + nameBytes.length + dataBytes.length);
    const localView = new DataView(localHeader.buffer);
    localView.setUint32(0, 0x04034b50, true); // signature
    localView.setUint16(4, 20, true); // version needed
    localView.setUint16(8, 0, true); // compression method: 0 (STORED)
    localView.setUint32(18, dataBytes.length, true); // compressed size
    localView.setUint32(22, dataBytes.length, true); // uncompressed size
    localView.setUint16(26, nameBytes.length, true); // file name length
    localView.setUint16(28, 0, true); // extra length
    localHeader.set(nameBytes, 30);
    localHeader.set(dataBytes, 30 + nameBytes.length);
    localParts.push(localHeader);

    // Central directory header (46 bytes + name)
    const cdHeader = new Uint8Array(46 + nameBytes.length);
    const cdView = new DataView(cdHeader.buffer);
    cdView.setUint32(0, 0x02014b50, true); // signature
    cdView.setUint16(4, 20, true); // version made by
    cdView.setUint16(6, 20, true); // version needed
    cdView.setUint16(10, 0, true); // compression method: 0 (STORED)
    cdView.setUint32(20, dataBytes.length, true); // compressed size
    cdView.setUint32(24, dataBytes.length, true); // uncompressed size
    cdView.setUint16(28, nameBytes.length, true); // file name length
    cdView.setUint16(30, 0, true); // extra field length
    cdView.setUint16(32, 0, true); // comment length
    cdView.setUint32(42, offset, true); // local header offset
    cdHeader.set(nameBytes, 46);
    cdParts.push(cdHeader);

    offset += localHeader.length;
  }

  const cdOffset = offset;
  const cdSize = cdParts.reduce((acc, p) => acc + p.length, 0);

  // End of central directory record (22 bytes)
  const eocd = new Uint8Array(22);
  const eocdView = new DataView(eocd.buffer);
  eocdView.setUint32(0, 0x06054b50, true);
  eocdView.setUint16(8, entries.length, true);
  eocdView.setUint16(10, entries.length, true);
  eocdView.setUint32(12, cdSize, true);
  eocdView.setUint32(16, cdOffset, true);

  const totalLength = offset + cdSize + eocd.length;
  const out = new Uint8Array(totalLength);
  let pos = 0;
  for (const p of localParts) {
    out.set(p, pos);
    pos += p.length;
  }
  for (const p of cdParts) {
    out.set(p, pos);
    pos += p.length;
  }
  out.set(eocd, pos);
  return out;
}

describe("Package Management UI & Scoped Package Routing", () => {
  test("resolvePackageParams normalizes both unscoped and scoped route parameters", () => {
    const unscoped = resolvePackageParams({ name: "Modelica", version: "4.0.0", className: "Modelica.Blocks" });
    assert.equal(unscoped.name, "Modelica");
    assert.equal(unscoped.version, "4.0.0");
    assert.equal(unscoped.className, "Modelica.Blocks");

    const scoped = resolvePackageParams({
      scope: "@alice",
      name: "ThermalSystems",
      version: "1.2.0",
      className: "ThermalSystems.HeatPump",
    });
    assert.equal(scoped.name, "@alice/ThermalSystems");
    assert.equal(scoped.version, "1.2.0");
    assert.equal(scoped.className, "ThermalSystems.HeatPump");
  });

  test("encodePackagePath preserves scoped slash while URL-encoding segments", () => {
    assert.equal(encodePackagePath("Modelica"), "Modelica");
    assert.equal(encodePackagePath("@alice/ThermalSystems"), "%40alice/ThermalSystems");
  });

  test("Export and diagram URL builders support scoped and unscoped packages", () => {
    assert.equal(
      getPackageDownloadUrl("@alice/ThermalSystems", "1.2.0"),
      "/api/v1/libraries/%40alice/ThermalSystems/1.2.0/download",
    );
    assert.equal(
      getPackageAasxExportUrl("@alice/ThermalSystems", "1.2.0"),
      "/api/v1/libraries/%40alice/ThermalSystems/1.2.0/export/aasx",
    );
    assert.equal(
      getPackageOkhExportUrl("@alice/ThermalSystems", "1.2.0"),
      "/api/v1/libraries/%40alice/ThermalSystems/1.2.0/export/okh",
    );
    assert.equal(
      getPackageSalsaIndexUrl("@alice/ThermalSystems", "1.2.0"),
      "/api/v1/libraries/%40alice/ThermalSystems/1.2.0/salsa-index.db",
    );
    assert.equal(
      getIconUrl("@alice/ThermalSystems", "1.2.0", "ThermalSystems"),
      "/api/v1/libraries/%40alice/ThermalSystems/1.2.0/classes/ThermalSystems/icon.svg",
    );
    assert.equal(
      getDiagramUrl("Modelica", "4.0.0", "Modelica.Electrical.Analog"),
      "/api/v1/libraries/Modelica/4.0.0/classes/Modelica.Electrical.Analog/diagram.svg",
    );
  });

  test("rewriteModelicaUris rewrites modelica:// links for scoped packages", () => {
    const html = `<a href="modelica://ThermalSystems.HeatPump">HeatPump</a>`;
    const rewritten = rewriteModelicaUris(html, "1.2.0", "@alice/ThermalSystems");
    assert.ok(rewritten.includes('href="/packages/@alice/ThermalSystems/1.2.0/classes/ThermalSystems.HeatPump"'));
  });

  test("inspectPackageZip extracts metadata from package.json and package.mo", () => {
    const zipWithJson = buildStoredZip([
      {
        name: "package.json",
        content: JSON.stringify({
          name: "@alice/propulsion",
          version: "2.1.0",
          description: "Aerospace propulsion twin library",
          license: "Apache-2.0",
        }),
      },
      {
        name: "Propulsion/package.mo",
        content: 'package Propulsion "Aerospace propulsion"\nend Propulsion;',
      },
    ]);

    const meta1 = inspectPackageZip(zipWithJson);
    assert.equal(meta1.hasManifest, true);
    assert.equal(meta1.name, "@alice/propulsion");
    assert.equal(meta1.version, "2.1.0");
    assert.equal(meta1.description, "Aerospace propulsion twin library");
    assert.equal(meta1.license, "Apache-2.0");
    assert.equal(meta1.files.length, 2);

    const zipWithMoOnly = buildStoredZip([
      {
        name: "BatteryPack/package.mo",
        content:
          'package BatteryPack "Lithium-ion thermal-electrical package"\n  annotation(version="3.0.1");\nend BatteryPack;',
      },
    ]);
    const meta2 = inspectPackageZip(zipWithMoOnly);
    assert.equal(meta2.hasManifest, true);
    assert.equal(meta2.name, "BatteryPack");
    assert.equal(meta2.version, "3.0.1");
    assert.equal(meta2.description, "Lithium-ion thermal-electrical package");
  });

  test("isValidSemver validates semantic version strings", () => {
    assert.equal(isValidSemver("1.0.0"), true);
    assert.equal(isValidSemver("2.4.12-beta.1"), true);
    assert.equal(isValidSemver("0.1.0+20261017"), true);
    assert.equal(isValidSemver("v1.0.0"), false);
    assert.equal(isValidSemver("1.0"), false);
    assert.equal(isValidSemver(""), false);
  });

  test("filterAndSortLibraries filters by user ownership, polyglot domain, and sorts accurately", () => {
    const sampleLibraries: LibraryListItem[] = [
      {
        name: "Modelica",
        latestVersion: "4.0.0",
        versions: ["4.0.0"],
        author: "modelica-org",
        totalDownloads: 1500,
        publishedAt: "2026-01-10T00:00:00.000Z",
        domains: ["modelica"],
      },
      {
        name: "@alice/CyberTwin",
        latestVersion: "1.3.0",
        versions: ["1.3.0"],
        author: "alice",
        scope: "alice",
        totalDownloads: 320,
        publishedAt: "2026-10-15T00:00:00.000Z",
        domains: ["modelica", "sysml2", "cad"],
      },
      {
        name: "@bob/FmuPlant",
        latestVersion: "0.9.0",
        versions: ["0.9.0"],
        author: "bob",
        scope: "bob",
        totalDownloads: 840,
        publishedAt: "2026-06-01T00:00:00.000Z",
        domains: ["fmu"],
      },
    ];

    // Sort by downloads
    const byDownloads = filterAndSortLibraries(sampleLibraries, {
      activeTab: "all",
      domainFilter: "all",
      sortBy: "downloads",
    });
    assert.deepEqual(
      byDownloads.map((l) => l.name),
      ["Modelica", "@bob/FmuPlant", "@alice/CyberTwin"],
    );

    // Sort by recent
    const byRecent = filterAndSortLibraries(sampleLibraries, {
      activeTab: "all",
      domainFilter: "all",
      sortBy: "recent",
    });
    assert.deepEqual(
      byRecent.map((l) => l.name),
      ["@alice/CyberTwin", "@bob/FmuPlant", "Modelica"],
    );

    // Filter by domain "cad"
    const cadOnly = filterAndSortLibraries(sampleLibraries, {
      activeTab: "all",
      domainFilter: "cad",
      sortBy: "name",
    });
    assert.equal(cadOnly.length, 1);
    assert.equal(cadOnly[0]?.name, "@alice/CyberTwin");

    // Filter by "my" tab for user "alice"
    const alicePackages = filterAndSortLibraries(sampleLibraries, {
      activeTab: "my",
      username: "alice",
      domainFilter: "all",
      sortBy: "name",
    });
    assert.equal(alicePackages.length, 1);
    assert.equal(alicePackages[0]?.name, "@alice/CyberTwin");
  });

  test("Collaborator, transfer, publish, and unpublish API functions are exported", () => {
    assert.equal(typeof getPackageCollaborators, "function");
    assert.equal(typeof addPackageCollaborator, "function");
    assert.equal(typeof removePackageCollaborator, "function");
    assert.equal(typeof getPendingPackageTransfers, "function");
    assert.equal(typeof acceptPackageTransfer, "function");
    assert.equal(typeof cancelPackageTransfer, "function");
    assert.equal(typeof publishPackageArchive, "function");
    assert.equal(typeof unpublishPackageRelease, "function");
  });

  test("buildClassTree and filterClassTree handle polyglot classes (Modelica, SysML v2, STEP CAD)", () => {
    const classes = [
      { class_name: "DronePkg", class_kind: "package", description: "Root" },
      { class_name: "DronePkg.Motors.BLDC", class_kind: "model", description: "Brushless motor" },
      { class_name: "DroneArchitecture.Chassis", class_kind: "sysml_part_def", description: "SysML chassis" },
      { class_name: "DroneFrame", class_kind: "cad_product", description: "STEP CAD frame" },
    ];

    assert.equal(classifyClassDomain(classes[1]!), "modelica");
    assert.equal(classifyClassDomain(classes[2]!), "sysml2");
    assert.equal(classifyClassDomain(classes[3]!), "cad");

    const tree = buildClassTree(classes, "DronePkg");
    // Should contain Motors (from DronePkg.Motors.BLDC), DroneArchitecture (from SysML), and DroneFrame (from CAD)
    const topNames = tree.map((n) => n.name);
    assert.ok(topNames.includes("Motors"));
    assert.ok(topNames.includes("DroneArchitecture"));
    assert.ok(topNames.includes("DroneFrame"));

    const filtered = filterClassTree(tree, "BLDC");
    assert.equal(filtered.length, 1);
    assert.equal(filtered[0]?.name, "Motors");
    assert.equal(filtered[0]?.children[0]?.fullName, "DronePkg.Motors.BLDC");
  });

  test("categorizeClassComponents and resolveTypeTargetUrl structure Javadoc tables and cross-links", () => {
    const components = [
      {
        component_name: "R",
        type_name: "Modelica.SIunits.Resistance",
        description: "Armature resistance",
        causality: null,
        variability: "parameter",
        modifiers: [
          { modifier_name: "unit", modifier_value: '"Ohm"' },
          { modifier_name: "value", modifier_value: "0.45" },
        ],
      },
      {
        component_name: "u",
        type_name: "Modelica.Blocks.Interfaces.RealInput",
        description: "Control voltage input",
        causality: "input",
        variability: null,
        modifiers: [],
      },
      {
        component_name: "rotor",
        type_name: "RotorInertia",
        description: "Mechanical rotor inertia",
        causality: null,
        variability: null,
        modifiers: [{ modifier_name: "J", modifier_value: "0.012" }],
      },
    ];

    const cat = categorizeClassComponents(components);
    assert.equal(cat.parameters.length, 1);
    assert.equal(cat.parameters[0]?.component_name, "R");
    assert.equal(cat.parameters[0]?.defaultValue, "0.45");
    assert.equal(cat.parameters[0]?.unit, "Ohm");

    assert.equal(cat.connectors.length, 1);
    assert.equal(cat.connectors[0]?.component_name, "u");

    assert.equal(cat.submodels.length, 1);
    assert.equal(cat.submodels[0]?.component_name, "rotor");

    const knownClasses = [
      { class_name: "DriveLib.Motors.BLDC", class_kind: "model", description: null },
      { class_name: "DriveLib.Motors.RotorInertia", class_kind: "model", description: null },
    ];

    // Sibling resolution within same package
    assert.equal(
      resolveTypeTargetUrl("RotorInertia", "DriveLib", "1.0.0", knownClasses, "DriveLib.Motors.BLDC"),
      "/packages/DriveLib/1.0.0/classes/DriveLib.Motors.RotorInertia",
    );

    // Cross-package resolution
    assert.equal(
      resolveTypeTargetUrl("Modelica.SIunits.Resistance", "DriveLib", "1.0.0", knownClasses, "DriveLib.Motors.BLDC"),
      "/packages/Modelica",
    );

    // Primitive type returns null
    assert.equal(resolveTypeTargetUrl("Real", "DriveLib", "1.0.0", knownClasses), null);
  });
});
