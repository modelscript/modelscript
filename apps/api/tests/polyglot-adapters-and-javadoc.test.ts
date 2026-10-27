// SPDX-License-Identifier: AGPL-3.0-or-later

import {
  EXTENSION_TO_LANGUAGE_ID,
  KparPackageAdapter,
  ManifestLensEngine,
  adaptFmuModelDescription,
  adaptFpmToml,
  adaptModelicaPackageMo,
  adaptRosOrGazeboXml,
  adaptSspSystemStructure,
  buildDeterministicZip,
  detectLanguagesFromPaths,
} from "@modelscript/exchange";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { after as afterAll, before as beforeAll, describe, it } from "node:test";
import { LibraryDatabase } from "../src/database.js";
import { inspectClassSource } from "../src/util/class-source-inspector.js";
import { indexRemainingPolyglotFiles, indexSysmlFiles } from "../src/util/polyglot-doc-indexer.js";
import { extractManifestFromZip, findLibraryRoot } from "../src/util/zip.js";

function expect<T>(actual: T, message?: string) {
  return {
    toBe(expected: T) {
      assert.strictEqual(actual, expected, message);
    },
    toEqual(expected: unknown) {
      assert.deepStrictEqual(actual, expected, message);
    },
    toContain(item: unknown) {
      if (typeof actual === "string" && typeof item === "string") {
        assert.ok(actual.includes(item), message ?? `Expected "${actual}" to contain "${item}"`);
      } else if (Array.isArray(actual)) {
        assert.ok(actual.includes(item), message ?? `Expected array to contain ${String(item)}`);
      } else {
        assert.fail(message ?? "toContain requires string or array");
      }
    },
    toBeGreaterThan(expected: number) {
      assert.ok((actual as unknown as number) > expected, message ?? `Expected ${String(actual)} > ${expected}`);
    },
    not: {
      toBe(expected: T) {
        assert.notStrictEqual(actual, expected, message);
      },
      toBeNull() {
        assert.notStrictEqual(actual, null, message);
      },
      toContain(item: unknown) {
        if (typeof actual === "string" && typeof item === "string") {
          assert.ok(!actual.includes(item), message ?? `Expected "${actual}" not to contain "${item}"`);
        } else if (Array.isArray(actual)) {
          assert.ok(!actual.includes(item), message ?? `Expected array not to contain ${String(item)}`);
        }
      },
    },
  };
}

describe("44-Language Package Adapters & Polyglot Javadoc Generation", () => {
  let tmpDir: string;

  beforeAll(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "msx-polyglot-javadoc-"));
  });

  afterAll(() => {
    try {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    } catch {
      // ignore
    }
  });

  it("maps all 44 languages under languages/ in EXTENSION_TO_LANGUAGE_ID", () => {
    const repoLanguagesDir = path.resolve(import.meta.dirname, "../../../languages");
    const languageDirs = fs
      .readdirSync(repoLanguagesDir, { withFileTypes: true })
      .filter((d) => d.isDirectory())
      .map((d) => d.name);

    expect(languageDirs.length).toBe(44);
    const mappedLanguageIds = new Set(Object.values(EXTENSION_TO_LANGUAGE_ID));
    for (const langId of languageDirs) {
      expect(mappedLanguageIds.has(langId), `Expected EXTENSION_TO_LANGUAGE_ID to cover language '${langId}'`).toBe(
        true,
      );
    }
  });

  it("adapts OMG SysML v2 .kpar archives bidirectionally (.meta.json + .Index.json <-> CanonicalWorkspaceManifest)", async () => {
    const metaJson = JSON.stringify({
      name: "AerospacePropulsion",
      version: "2.1.0",
      description: "SysML v2 propulsion architecture package",
      license: "Apache-2.0",
      metamodel: "https://www.omg.org/spec/SysML/20250201",
      usage: [{ resource: "https://www.omg.org/spec/SysML/20260301/SysML", versionConstraint: "2026.3.0" }],
    });
    const indexJson = JSON.stringify({
      PropulsionPkg: "src/Propulsion.sysml",
      ThrusterDef: "src/Thruster.kerml",
    });

    const adapted = KparPackageAdapter.ingestFromKpar(metaJson, indexJson);

    expect(adapted.manifest.idShort).toBe("AerospacePropulsion");
    expect(adapted.manifest.version).toBe("2.1.0");
    expect(adapted.dependencies["SysML"]).toBe("2026.3.0");
    expect(adapted.entryPoint).toBe("src/Propulsion.sysml");

    // Build deterministic .kpar zip and extract manifest via API zip utility
    const kparBytes = KparPackageAdapter.buildKparArchive({
      manifest: adapted.manifest,
      files: [{ path: "src/Propulsion.sysml", data: "package PropulsionPkg { doc /* Main propulsion package */ }" }],
    });
    const extractedManifest = await extractManifestFromZip(Buffer.from(kparBytes));
    const parsedKparManifest = JSON.parse(extractedManifest.content) as Record<string, unknown>;
    expect(parsedKparManifest["name"]).toBe("AerospacePropulsion");
    expect(parsedKparManifest["version"]).toBe("2.1.0");

    const projected = ManifestLensEngine.projectToKpar(adapted.manifest, [
      { packageName: "PropulsionPkg", path: "src/Propulsion.sysml" },
    ]);
    expect(projected.metaJson.name).toBe("AerospacePropulsion");
    expect(projected.indexJson["PropulsionPkg"]).toBe("src/Propulsion.sysml");
  });

  it("adapts Modelica package.mo + impact.json, FMU modelDescription.xml, SSP SystemStructure.ssd, ROS package.xml, and Fortran fpm.toml", async () => {
    // 1. Modelica + impact.json
    const moAdapted = adaptModelicaPackageMo(
      `within ; package ThermalLib "Advanced thermal library" annotation(version="1.4.2", uses(Modelica(version="4.1.0"))); end ThermalLib;`,
      JSON.stringify({ license: "BSD-3-Clause", homepage: "https://example.org/thermal" }),
    );
    expect(moAdapted.name).toBe("ThermalLib");
    expect(moAdapted.version).toBe("1.4.2");
    expect(moAdapted.dependencies["Modelica"]).toBe("4.1.0");

    // 2. FMU modelDescription.xml
    const fmuAdapted = adaptFmuModelDescription(
      `<fmiModelDescription fmiVersion="2.0" modelName="DriveController" version="3.0.1" description="FOC Drive FMU" author="Acme"><ModelExchange modelIdentifier="DriveController"/></fmiModelDescription>`,
    );
    expect(fmuAdapted.name).toBe("DriveController");
    expect(fmuAdapted.version).toBe("3.0.1");

    // 3. SSP SystemStructure.ssd
    const sspAdapted = adaptSspSystemStructure(
      `<ssd:SystemStructureDescription xmlns:ssd="http://ssp-standard.org/SSP1/SystemStructureDescription" name="EVPowertrain" version="1.2.0" description="Co-simulation architecture"/>`,
    );
    expect(sspAdapted.name).toBe("EVPowertrain");
    expect(sspAdapted.version).toBe("1.2.0");

    // 4. ROS package.xml
    const rosAdapted = adaptRosOrGazeboXml(
      `<package format="3"><name>urdf_manipulator</name><version>0.9.4</version><description>6-DOF robot arm</description><license>MIT</license><depend>std_msgs</depend></package>`,
    );
    expect(rosAdapted.name).toBe("urdf_manipulator");
    expect(rosAdapted.version).toBe("0.9.4");
    expect(detectLanguagesFromPaths(["urdf/arm.urdf"])).toContain("urdf");

    // 5. Fortran fpm.toml
    const fpmAdapted = adaptFpmToml(
      `name = "turbomachinery-cfd"\nversion = "0.4.0"\nlicense = "MIT"\ndescription = "Compressible Navier-Stokes solver"\n`,
    );
    expect(fpmAdapted.name).toBe("turbomachinery-cfd");
    expect(fpmAdapted.version).toBe("0.4.0");

    // 6. Test zip extraction from a native FMU archive without package.json
    const fmuZip = buildDeterministicZip([
      {
        path: "modelDescription.xml",
        data: `<fmiModelDescription fmiVersion="3.0" modelName="HydraulicValve" version="1.1.0" description="ISO hydraulic valve"/>`,
      },
    ]);
    const fromZip = await extractManifestFromZip(Buffer.from(fmuZip));
    const parsedFmuManifest = JSON.parse(fromZip.content) as Record<string, unknown>;
    expect(parsedFmuManifest["name"]).toBe("HydraulicValve");
    expect(parsedFmuManifest["version"]).toBe("1.1.0");
  });

  it("prefers the matching top-level directory in findLibraryRoot when multi-package zips like MSL contain Complex + Modelica + ModelicaServices", () => {
    const multiRootDir = path.join(tmpDir, "msl-multi-root");
    fs.mkdirSync(path.join(multiRootDir, "ModelicaServices 4.1.0"), { recursive: true });
    fs.mkdirSync(path.join(multiRootDir, "Modelica 4.1.0"), { recursive: true });
    fs.writeFileSync(
      path.join(multiRootDir, "ModelicaServices 4.1.0", "package.mo"),
      "package ModelicaServices end ModelicaServices;",
    );
    fs.writeFileSync(path.join(multiRootDir, "Modelica 4.1.0", "package.mo"), "package Modelica end Modelica;");

    const resolved = findLibraryRoot(multiRootDir, "Modelica");
    expect(path.basename(resolved)).toBe("Modelica 4.1.0");
  });

  it("indexes SysML v2 standard library (SysML@2026.3.0) with both top-level packages and nested definitions, scoped docstrings, SVG diagrams, and zero import->port false positives", async () => {
    const stdlibDir = path.resolve(import.meta.dirname, "../../../languages/sysml2/stdlib");
    const indexed = await indexSysmlFiles({
      extractedDir: stdlibDir,
      packageName: "SysML",
      version: "2026.3.0",
    });

    expect(indexed.length).toBeGreaterThan(50);

    const byName = new Map(indexed.map((item) => [item.metadata.className, item]));
    expect(byName.has("SysML")).toBe(true);
    expect(byName.has("ScalarValues")).toBe(true);
    expect(byName.has("ISQ")).toBe(true);
    expect(byName.has("SI")).toBe(true);
    expect(byName.has("Parts")).toBe(true);
    expect(byName.has("Parts.Part")).toBe(true);
    expect(byName.has("Ports.FlowPort")).toBe(true);
    expect(byName.has("Requirements.SafetyRequirement")).toBe(true);

    // Verify no `import` statement was turned into a `connector` port
    for (const item of indexed) {
      for (const comp of item.metadata.components) {
        expect(comp.typeName.toLowerCase()).not.toBe("import");
      }
      expect(item.iconSvg).toContain("<svg");
      expect(item.diagramSvg).toContain("<svg");
    }

    // Verify scoped source inspection for a nested SysML definition
    const inspectedPart = inspectClassSource(stdlibDir, "SysML", "2026.3.0", "Parts.Part", "sysml_partdef");
    expect(inspectedPart.sourceFile).toBe("SysML.sysml");
    expect(inspectedPart.sourceCode).toContain("part def Part");
    expect(inspectedPart.sourceCode).not.toContain("package ScalarValues");
    expect(inspectedPart.sysmlConfig?.systemName).toBe("Parts.Part");
  });

  it("cleans leaked Modelica annotations from SQLite descriptions and modifiers on LibraryDatabase startup", () => {
    const testDbDir = path.join(tmpDir, "db-cleanup-test");
    const db1 = new LibraryDatabase(testDbDir);
    db1.storeClassBatch("TestLib", "1.0.0", [
      {
        className: "TestLib.DirtyResistor",
        classKind: "model",
        description: `"Ideal linear electrical resistor" annotation(Documentation(info="<html><p>Info</p></html>"))`,
        documentation: "<html><p>Info</p></html>",
        baseClasses: [],
        components: [
          {
            name: "R",
            typeName: "Real",
            description: `"Resistance" annotation(Dialog(group="General"))`,
            causality: null,
            variability: "parameter",
            modifiers: [
              { name: "value", value: "10.0" },
              { name: "Dialog", value: `(group="General")` },
              { name: "Placement", value: `(transformation(extent={{-10,-10},{10,10}}))` },
            ],
          },
        ],
      },
    ]);
    db1.close();

    // Re-open database so #initialize runs the startup sanitizer
    const db2 = new LibraryDatabase(testDbDir);
    const cleaned = db2.getClass("TestLib", "1.0.0", "TestLib.DirtyResistor");
    expect(cleaned).not.toBeNull();
    expect(cleaned!.description).toBe("Ideal linear electrical resistor");
    expect(cleaned!.components[0]!.description).toBe("Resistance");
    expect(cleaned!.components[0]!.modifiers).toEqual([{ modifier_name: "value", modifier_value: "10.0" }]);
    db2.close();
  });

  it("indexes SPICE, OpenSCAD, Verilog-A, URDF, and CSV files into Javadoc ClassMetadata with SVG diagrams", () => {
    const polyDir = path.join(tmpDir, "poly-files");
    fs.mkdirSync(polyDir, { recursive: true });

    fs.writeFileSync(
      path.join(polyDir, "opamp.cir"),
      `* Precision CMOS OpAmp\n.subckt cmos_opamp inp inn vdd vss out gain=100e3\nR1 inp inn 10meg\n.ends\n`,
    );
    fs.writeFileSync(
      path.join(polyDir, "bracket.scad"),
      `/** Mounting bracket with configurable bolt spacing */\nmodule mounting_bracket(width = 40, thickness = 4) {\n  cube([width, 20, thickness]);\n}\n`,
    );
    fs.writeFileSync(
      path.join(polyDir, "diode.va"),
      `module pn_diode(anode, cathode);\n  electrical anode, cathode;\n  parameter real Is = 1e-14;\nendmodule\n`,
    );
    fs.writeFileSync(
      path.join(polyDir, "rover.urdf"),
      `<robot name="mars_rover"><link name="chassis"/><joint name="wheel_joint" type="continuous"/></robot>\n`,
    );
    fs.writeFileSync(path.join(polyDir, "telemetry.csv"), `time,voltage,current\n0.0,28.1,4.2\n`);

    const indexed = indexRemainingPolyglotFiles({
      extractedDir: polyDir,
      packageName: "PolyPkg",
      version: "1.0.0",
    });

    const names = new Set(indexed.map((i) => i.metadata.className));
    expect(names.has("cmos_opamp")).toBe(true);
    expect(names.has("mounting_bracket")).toBe(true);
    expect(names.has("pn_diode")).toBe(true);
    expect(names.has("mars_rover")).toBe(true);
    expect(names.has("telemetry")).toBe(true);

    for (const item of indexed) {
      expect(item.iconSvg).toContain("<svg");
      expect(item.diagramSvg).toContain("<svg");
      expect(item.metadata.documentation).toContain("<div>");
    }
  });

  it("seeds and refreshes preloaded SysML@2026.3.0 and Modelica@4.1.0 libraries with READMEs, nested definitions, and SVGs", async () => {
    const { LibraryStorage } = await import("../src/storage.js");
    const { seedPrepackagedLibraries } = await import("../src/util/seed-examples.js");
    const db = new LibraryDatabase();
    const storage = new LibraryStorage();
    const fakeQueue = {
      enqueueProcess: () => {},
    } as any;

    await seedPrepackagedLibraries(storage, db, fakeQueue);

    const sysmlPkg = db.getPackage("SysML");
    expect(sysmlPkg).not.toBeNull();
    expect(Boolean(sysmlPkg!.readme && sysmlPkg!.readme.length > 100)).toBe(true);

    const sysmlRoot = db.getClass("SysML", "2026.3.0", "SysML");
    expect(sysmlRoot).not.toBeNull();
    const partsPart = db.getClass("SysML", "2026.3.0", "Parts.Part");
    expect(partsPart).not.toBeNull();
    expect(partsPart!.description).toContain("Base definition for all structural system elements");

    const partDiagram = storage.readSvg("SysML", "2026.3.0", "Parts.Part", "diagram");
    expect(Boolean(partDiagram && partDiagram.includes("<svg"))).toBe(true);

    const modelicaPkg = db.getPackage("Modelica");
    if (modelicaPkg && db.getClasses("Modelica", "4.1.0").length > 0) {
      expect(Boolean(modelicaPkg.readme && modelicaPkg.readme.length > 50)).toBe(true);
      const resistor = db.getClass("Modelica", "4.1.0", "Modelica.Electrical.Analog.Basic.Resistor");
      if (resistor) {
        expect(resistor.description).toBe("Ideal linear electrical resistor");
      }
    }

    db.close();
  });
});
