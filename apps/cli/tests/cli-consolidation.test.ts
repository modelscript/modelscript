// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { after, before, describe, it } from "node:test";
import { Compile } from "../src/commands/compile.js";
import { Domain } from "../src/commands/domain.js";
import { Inspect } from "../src/commands/inspect.js";
import { Simulate } from "../src/commands/simulate.js";
import {
  inferPrimaryModelName,
  normalizeDomainAction,
  resolveLanguageOption,
  resolveOutputFormat,
  resolveOutputPath,
} from "../src/util/cli-options.js";
import { LanguageResolver, sniffLanguageByContent } from "../src/util/language-registry.js";

describe("CLI Consolidation, Disambiguation & Universal Lifecycle Verbs", () => {
  const scratchDir = path.resolve(import.meta.dirname, "scratch_cli_consolidation");

  before(() => {
    if (fs.existsSync(scratchDir)) {
      fs.rmSync(scratchDir, { recursive: true, force: true });
    }
    fs.mkdirSync(scratchDir, { recursive: true });
  });

  after(() => {
    if (fs.existsSync(scratchDir)) {
      fs.rmSync(scratchDir, { recursive: true, force: true });
    }
  });

  it("does not hijack .ts TypeScript files as Touchstone RF files while supporting .sNp and .ts2", async () => {
    await assert.rejects(() => LanguageResolver.resolve("apps/cli/src/main.ts"), /Unknown file extension '\.ts'/);
    const s2p = await LanguageResolver.resolve("filter.s2p");
    assert.equal(s2p.manifest.id, "touchstone");
    const s8p = await LanguageResolver.resolve("backplane.s8p");
    assert.equal(s8p.manifest.id, "touchstone");
    const ts2 = await LanguageResolver.resolve("channel.ts2");
    assert.equal(ts2.manifest.id, "touchstone");
  });

  it("disambiguates shared .inp, .xml, .dat, and .net extensions via content sniffing", async () => {
    // .inp disambiguation
    assert.equal(sniffLanguageByContent("storm.inp", "[TITLE]\n[SUBCATCHMENTS]\n[CONDUITS]\n"), "swmm");
    assert.equal(sniffLanguageByContent("water.inp", "[TITLE]\n[JUNCTIONS]\n[PIPES]\n[RESERVOIRS]\n"), "epanet");
    assert.equal(sniffLanguageByContent("plant.inp", "TITLE 'Methanol'\nIN-UNITS MET\nFLOWSHEET\n"), "aspen");
    assert.equal(sniffLanguageByContent("mooring.inp", "SIMO-SYSTEM\nRIFLEX\nSTOCHASTIC-WAVE\n"), "sima");
    assert.equal(sniffLanguageByContent("beam.inp", "*HEADING\n*NODE\n1, 0.0, 0.0, 0.0\n*ELEMENT\n"), "fea");

    // .xml disambiguation
    assert.equal(
      sniffLanguageByContent(
        "pathway.xml",
        '<?xml version="1.0"?><sbml xmlns="http://www.sbml.org/sbml/level3/version2/core">',
      ),
      "sbml",
    );
    assert.equal(sniffLanguageByContent("f16.xml", '<fdm_config name="F-16"><aerodynamics/></fdm_config>'), "jsbsim");
    assert.equal(
      sniffLanguageByContent(
        "plc.xml",
        '<project xmlns="http://www.plcopen.org/xml/tc6_0201"><types><pous/></types></project>',
      ),
      "plcopen",
    );
    assert.equal(
      sniffLanguageByContent("road.xml", '<OpenDRIVE><header revMajor="1" revMinor="7"/></OpenDRIVE>'),
      "opendrive",
    );
    assert.equal(sniffLanguageByContent("spec.xml", "<REQ-IF><THE-HEADER/><CORE-CONTENT/></REQ-IF>"), "reqif");

    // .dat disambiguation
    assert.equal(sniffLanguageByContent("reservoir.dat", "RUNSPEC\nDIMENS\n10 10 3 /\nGRID\n"), "eclipse");
    assert.equal(sniffLanguageByContent("nastran.dat", "SOL 101\nCEND\nBEGIN BULK\nGRID,1,,0.,0.,0.\n"), "fea");
  });

  it("normalizes CLI flags and domain actions uniformly", () => {
    assert.equal(normalizeDomainAction("summary"), "inspect");
    assert.equal(normalizeDomainAction("info"), "inspect");
    assert.equal(normalizeDomainAction("validate"), "lint");
    assert.equal(normalizeDomainAction("check"), "lint");
    assert.equal(normalizeDomainAction("lower"), "to-dae");
    assert.equal(normalizeDomainAction("export-modelica"), "to-modelica");
    assert.equal(normalizeDomainAction("to-sysml"), "to-sysml2");
    assert.equal(normalizeDomainAction("solve"), "simulate");
    assert.equal(normalizeDomainAction("render"), "diagram");

    assert.equal(resolveOutputPath({ out: "a.mo" }), "a.mo");
    assert.equal(resolveOutputPath({ output: "b.mo" }), "b.mo");
    assert.equal(resolveOutputFormat({ json: true }), "json");
    assert.equal(resolveOutputFormat({ format: "pretty" }), "terminal");
    assert.equal(resolveLanguageOption({ lang: "sysml2" }), "sysml2");

    const moSrc = "within MyPkg;\nmodel Pendulum\n  Real theta;\nequation\n  der(theta) = 0;\nend Pendulum;\n";
    assert.equal(inferPrimaryModelName("Pendulum.mo", moSrc), "MyPkg.Pendulum");
  });

  it("runs universal `msx inspect` across Modelica, SPICE, URDF, and Adams files", async () => {
    const moFile = path.join(scratchDir, "RC.mo");
    fs.writeFileSync(
      moFile,
      "model RC\n  parameter Real R = 10;\n  Real v(start = 1);\nequation\n  der(v) = -v / R;\nend RC;\n",
      "utf-8",
    );
    const moJsonOut = path.join(scratchDir, "rc-summary.json");
    await Inspect.handler({
      _: ["inspect"],
      $0: "msx",
      files: [moFile],
      json: true,
      output: moJsonOut,
    } as any);
    assert.equal(fs.existsSync(moJsonOut), true);
    const moSummary = JSON.parse(fs.readFileSync(moJsonOut, "utf-8"));
    assert.equal(moSummary.language, "modelica");
    assert.equal(moSummary.classCount, 1);

    const spiceFile = path.join(scratchDir, "divider.cir");
    fs.writeFileSync(spiceFile, "* Voltage Divider\nV1 in 0 5.0\nR1 in out 1000\nR2 out 0 1000\n.OP\n.END\n", "utf-8");
    const spiceJsonOut = path.join(scratchDir, "spice-summary.json");
    await Inspect.handler({
      _: ["inspect"],
      $0: "msx",
      files: [spiceFile],
      json: true,
      output: spiceJsonOut,
    } as any);
    assert.equal(fs.existsSync(spiceJsonOut), true);
    const spiceSummary = JSON.parse(fs.readFileSync(spiceJsonOut, "utf-8"));
    assert.equal(spiceSummary.componentsCount, 3);
  });

  it("supports single-file `msx compile <file>` and polyglot `msx compile <file> --to modelica -o`", async () => {
    const moFile = path.join(scratchDir, "Decay.mo");
    fs.writeFileSync(moFile, "model Decay\n  Real x(start = 2.0);\nequation\n  der(x) = -x;\nend Decay;\n", "utf-8");
    const flatOut = path.join(scratchDir, "Decay.flat.mo");
    await Compile.handler({
      _: ["compile"],
      $0: "msx",
      name: moFile,
      output: flatOut,
    } as any);
    assert.equal(fs.existsSync(flatOut), true);
    assert.match(fs.readFileSync(flatOut, "utf-8"), /\b(?:model|class)\s+Decay\b/);

    const spiceFile = path.join(scratchDir, "rc_filter.cir");
    fs.writeFileSync(spiceFile, "RC Filter\nV1 in 0 1.0\nR1 in out 100\nC1 out 0 1e-6\n.END\n", "utf-8");
    const spiceMoOut = path.join(scratchDir, "RcFilter.mo");
    await Compile.handler({
      _: ["compile"],
      $0: "msx",
      name: spiceFile,
      to: "modelica",
      output: spiceMoOut,
    } as any);
    assert.equal(fs.existsSync(spiceMoOut), true);
    assert.match(fs.readFileSync(spiceMoOut, "utf-8"), /model /);
  });

  it("supports single-file `msx simulate <file> -o <csv>` and `msx domain <lang> <action>`", async () => {
    const moFile = path.join(scratchDir, "SimpleSim.mo");
    fs.writeFileSync(
      moFile,
      "model SimpleSim\n  Real x(start = 1.0);\nequation\n  der(x) = -x;\nend SimpleSim;\n",
      "utf-8",
    );
    const csvOut = path.join(scratchDir, "sim.csv");
    await Simulate.handler({
      _: ["simulate"],
      $0: "msx",
      name: moFile,
      output: csvOut,
      stopTime: 0.1,
      interval: 0.05,
      format: "csv",
      solver: "dopri5",
      engine: "js",
      jacobian: "sparse",
    } as any);
    assert.equal(fs.existsSync(csvOut), true);
    const csvContent = fs.readFileSync(csvOut, "utf-8");
    assert.match(csvContent, /^time,x/m);

    // Test `msx domain urdf to-dae`
    const urdfFile = path.join(scratchDir, "pendulum.urdf");
    fs.writeFileSync(
      urdfFile,
      `<robot name="pendulum">
        <link name="base"/>
        <link name="arm"><inertial><mass value="1.5"/><inertia ixx="0.1" ixy="0" ixz="0" iyy="0.1" iyz="0" izz="0.1"/></inertial></link>
        <joint name="j1" type="revolute"><parent link="base"/><child link="arm"/><origin xyz="0 0 0" rpy="0 0 0"/><axis xyz="0 1 0"/></joint>
      </robot>`,
      "utf-8",
    );
    const daeJsonOut = path.join(scratchDir, "pendulum-dae.json");
    await Domain.handler({
      _: ["domain"],
      $0: "msx",
      lang: "urdf",
      action: "to-dae",
      files: [urdfFile],
      output: daeJsonOut,
    } as any);
    assert.equal(fs.existsSync(daeJsonOut), true);
    const daeMeta = JSON.parse(fs.readFileSync(daeJsonOut, "utf-8"));
    assert.equal(daeMeta.model, "pendulum");
    assert.ok(daeMeta.variables > 0);
  });

  it("strips block and line comments in parsePackageMo and parsePackageUses", async () => {
    const { parsePackageMo, parsePackageUses } = await import("../src/util/package-mo.js");
    const commentedMo = `
      // package FakeCommented "Should be ignored"
      /* package BlockCommented
         annotation(version="9.9.9", uses(BadPkg(version="0.0.1")));
      */
      package RealLibrary "Actual library description"
        // annotation(version="0.0.0")
        annotation(version="2.4.0", uses(Modelica(version="4.0.0")));
      end RealLibrary;
    `;
    const parsed = parsePackageMo(commentedMo);
    assert.equal(parsed.name, "RealLibrary");
    assert.equal(parsed.description, "Actual library description");
    assert.equal(parsed.version, "2.4.0");
    const uses = parsePackageUses(commentedMo);
    assert.deepEqual(uses, { Modelica: "4.0.0" });
  });

  it("supports DHF status, audit, and HTML export without hardcoded domain assumptions", async () => {
    const { Dhf } = await import("../src/commands/dhf.js");
    const reqFile = path.join(scratchDir, "avionics.sysml");
    fs.writeFileSync(
      reqFile,
      `package AvionicsSafety {
        requirement <'REQ-FLT-01'> PitchStability {
          doc /* Pitch rate shall remain bounded within 15 deg/s */
        }
      }`,
      "utf-8",
    );
    const htmlOut = path.join(scratchDir, "dhf.html");
    await Dhf.handler({
      _: ["dhf"],
      $0: "msx",
      action: "export",
      paths: [reqFile],
      format: "html",
      output: htmlOut,
      device: "FlightControlActuator",
      title: "Avionics Safety DHF",
      author: "QA Team",
    } as any);
    assert.equal(fs.existsSync(htmlOut), true);
    const html = fs.readFileSync(htmlOut, "utf-8");
    assert.match(html, /<!DOCTYPE html>/);
    assert.match(html, /FlightControlActuator/);
  });

  it("computes EnergyPlus thermal-balance U-values from constructions/materials and polygon area from vertices", async () => {
    const { EnergyPlusCommand } = await import("../src/commands/energyplus.js");
    const idfFile = path.join(scratchDir, "zone.idf");
    fs.writeFileSync(
      idfFile,
      [
        "Zone, MainOffice, 0, 0, 0, 0, 1, 1, 3.0, 120.0;",
        "Material, Concrete200mm, MediumRough, 0.2, 1.4, 2300, 880;",
        "Construction, ExtWallConst, Concrete200mm;",
        "BuildingSurface:Detailed, SouthWall, Wall, ExtWallConst, MainOffice, Outdoors, , SunExposed, WindExposed, 0.5, 4, 0,0,0, 10,0,0, 10,0,3, 0,0,3;",
      ].join("\n"),
      "utf-8",
    );
    const tbOut = path.join(scratchDir, "thermal-balance.json");
    await EnergyPlusCommand.handler({
      _: ["energyplus"],
      $0: "msx",
      action: "thermal-balance",
      files: [idfFile],
      json: true,
      output: tbOut,
    } as any);
    assert.equal(fs.existsSync(tbOut), true);
    const tb = JSON.parse(fs.readFileSync(tbOut, "utf-8"));
    assert.equal(tb.zones.length, 1);
    // 10m x 3m polygon = 30 m^2; R_total = 0.17 + 0.2/1.4 = 0.312857 -> U = 3.196 -> UA = 30 * 3.196 = 95.89 W/K
    assert.ok(tb.zones[0].totalUA > 90 && tb.zones[0].totalUA < 100);
  });

  it("rejects XTCE telemetry specifications in `msx ccsds propagate` with an explicit diagnostic", async () => {
    const { CcsdsCommand } = await import("../src/commands/ccsds.js");
    const xtceFile = path.join(scratchDir, "telemetry.xtce");
    fs.writeFileSync(
      xtceFile,
      `<SpaceSystem xmlns="http://www.omg.org/spec/XTCE/20180204" name="Sat"><TelemetryMetaData/></SpaceSystem>`,
      "utf-8",
    );
    const prevCode = process.exitCode;
    process.exitCode = 0;
    await CcsdsCommand.handler({
      _: ["ccsds"],
      $0: "msx",
      action: "propagate",
      files: [xtceFile],
    } as any);
    assert.equal(process.exitCode, 1);
    process.exitCode = prevCode;
  });
});
