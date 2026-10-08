// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { after, before, describe, it } from "node:test";
import {
  LanguageResolver,
  listAllLanguages,
  registerLanguage,
  unregisterLanguage,
} from "../src/util/language-registry.js";

describe("Universal Language Registry & Resolver", () => {
  const tempDir = path.join(os.tmpdir(), `modelscript-test-reg-${Date.now()}`);

  before(() => {
    process.env.MODELSCRIPT_LANGUAGES_DIR = tempDir;
  });

  after(() => {
    delete process.env.MODELSCRIPT_LANGUAGES_DIR;
    if (fs.existsSync(tempDir)) {
      try {
        fs.rmSync(tempDir, { recursive: true, force: true });
      } catch {}
    }
  });

  it("should list all built-in languages with their recognized extensions", () => {
    const { builtIn } = listAllLanguages();
    const ids = builtIn.map((b) => b.id);
    assert.ok(ids.includes("modelica"));
    assert.ok(ids.includes("sysml2"));
    assert.ok(ids.includes("scad"));
    assert.ok(ids.includes("step"));
    assert.ok(ids.includes("owl2"));
    assert.ok(ids.includes("csv"));

    const exts = LanguageResolver.getAllExtensions();
    assert.ok(exts.includes(".mo"));
    assert.ok(exts.includes(".sysml"));
    assert.ok(exts.includes(".scad"));
    assert.ok(exts.includes(".step"));
  });

  it("should resolve built-in languages by file extension", async () => {
    const moLang = await LanguageResolver.resolve("pump.mo");
    assert.strictEqual(moLang.manifest.id, "modelica");
    assert.strictEqual(moLang.manifest.name, "Modelica");

    const sysmlLang = await LanguageResolver.resolve("architecture.sysml");
    assert.strictEqual(sysmlLang.manifest.id, "sysml2");

    const scadLang = await LanguageResolver.resolve("bracket.scad");
    assert.strictEqual(scadLang.manifest.id, "scad");

    const stepLang = await LanguageResolver.resolve("assembly.step");
    assert.strictEqual(stepLang.manifest.id, "step");
  });

  it("should resolve language via explicit override flag", async () => {
    const overrideLang = await LanguageResolver.resolve("custom_model.txt", "modelica");
    assert.strictEqual(overrideLang.manifest.id, "modelica");

    const scadOverride = await LanguageResolver.resolve("test.any", "scad");
    assert.strictEqual(scadOverride.manifest.id, "scad");
  });

  it("should register, resolve, and unregister user language in catalog", async () => {
    const customId = "minirobot";
    registerLanguage({
      id: customId,
      name: "MiniRobot",
      extensions: [".mbot", ".robot"],
    });

    const resolved = await LanguageResolver.resolve("rover.mbot");
    assert.strictEqual(resolved.manifest.id, customId);
    assert.strictEqual(resolved.manifest.name, "MiniRobot");

    const resolved2 = await LanguageResolver.resolve("rover.robot");
    assert.strictEqual(resolved2.manifest.id, customId);

    const unregistered = unregisterLanguage(customId);
    assert.strictEqual(unregistered, true);

    await assert.rejects(async () => {
      await LanguageResolver.resolve("rover.mbot");
    }, /Unknown file extension/);
  });
});

describe("Universal Formatting & Unparsing", () => {
  it("should format Modelica code with proper keyword and equation indentation", async () => {
    const lang = await LanguageResolver.resolve("test.mo");
    const unformatted = `model Oscillator
Real x;
equation
der(x) = -x;
end Oscillator;`;

    const formatted = await lang.format(unformatted, { indentSize: 2 });
    assert.ok(formatted.includes("  Real x;"));
    assert.ok(formatted.includes("  der(x) = -x;"));
    assert.ok(formatted.startsWith("model Oscillator"));
    assert.ok(formatted.trim().endsWith("end Oscillator;"));
  });

  it("should format STEP document with standardized spacing and records", async () => {
    const lang = await LanguageResolver.resolve("part.step");
    const rawStep = `ISO-10303-21;
HEADER;
ENDSEC;
DATA;
#1= PRODUCT ( 'Cube' , 'Test' );
#2=APPLICATION_CONTEXT('automotive');
ENDSEC;
END-ISO-10303-21;`;

    const formatted = await lang.format(rawStep);
    assert.ok(formatted.includes("#1=PRODUCT ('Cube','Test');"));
    assert.ok(formatted.includes("#2=APPLICATION_CONTEXT('automotive');"));
  });

  it("should format SysML v2 with clean block indentation", async () => {
    const lang = await LanguageResolver.resolve("model.sysml");
    const rawSysml = `package Vehicle {
part def Chassis {
attribute mass : Real;
}
}`;

    const formatted = await lang.format(rawSysml, { indentSize: 2 });
    assert.ok(formatted.includes("  part def Chassis {"));
    assert.ok(formatted.includes("    attribute mass : Real;"));
  });

  it("should unparse code cleanly", async () => {
    const lang = await LanguageResolver.resolve("sample.mo");
    const code = `model Spring
  Real f;
equation
  f = 0;
end Spring;`;

    const unparsed = await lang.unparse(code);
    assert.ok(unparsed.includes("model Spring"));
    assert.ok(unparsed.includes("end Spring;"));
  });
});

describe("Parser Execution across Built-in Languages", () => {
  it("should load parser and parse Modelica source into CST", async () => {
    const lang = await LanguageResolver.resolve("test.mo");
    const { parser } = await lang.loadParser();
    assert.ok(parser != null);

    const tree = parser.parse("model M equation x = 1; end M;");
    assert.ok(tree != null);
    assert.ok(tree.rootNode != null);
    assert.ok(tree.rootNode.toString().includes("class_definition"));
  });

  it("should load parser and parse OpenSCAD source into CST", async () => {
    const lang = await LanguageResolver.resolve("part.scad");
    const { parser } = await lang.loadParser();
    assert.ok(parser != null);

    const tree = parser.parse("cube([10, 20, 30]);");
    assert.ok(tree != null);
    assert.ok(tree.rootNode != null);
    assert.ok(tree.rootNode.toString().length > 0);
  });
});
