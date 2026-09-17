import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  LanguageResolver,
  listAllLanguages,
  registerLanguage,
  unregisterLanguage,
} from "../src/util/language-registry.js";

describe("Universal Language Registry & Resolver", () => {
  const tempDir = path.join(os.tmpdir(), `modelscript-test-reg-${Date.now()}`);

  beforeAll(() => {
    process.env.MODELSCRIPT_LANGUAGES_DIR = tempDir;
  });

  afterAll(() => {
    delete process.env.MODELSCRIPT_LANGUAGES_DIR;
    if (fs.existsSync(tempDir)) {
      try {
        fs.rmSync(tempDir, { recursive: true, force: true });
      } catch {}
    }
  });

  test("should list all built-in languages with their recognized extensions", () => {
    const { builtIn } = listAllLanguages();
    const ids = builtIn.map((b) => b.id);
    expect(ids).toContain("modelica");
    expect(ids).toContain("sysml2");
    expect(ids).toContain("scad");
    expect(ids).toContain("step");
    expect(ids).toContain("owl2");
    expect(ids).toContain("csv");

    const exts = LanguageResolver.getAllExtensions();
    expect(exts).toContain(".mo");
    expect(exts).toContain(".sysml");
    expect(exts).toContain(".scad");
    expect(exts).toContain(".step");
  });

  test("should resolve built-in languages by file extension", async () => {
    const moLang = await LanguageResolver.resolve("pump.mo");
    expect(moLang.manifest.id).toBe("modelica");
    expect(moLang.manifest.name).toBe("Modelica");

    const sysmlLang = await LanguageResolver.resolve("architecture.sysml");
    expect(sysmlLang.manifest.id).toBe("sysml2");

    const scadLang = await LanguageResolver.resolve("bracket.scad");
    expect(scadLang.manifest.id).toBe("scad");

    const stepLang = await LanguageResolver.resolve("assembly.step");
    expect(stepLang.manifest.id).toBe("step");
  });

  test("should resolve language via explicit override flag", async () => {
    const overrideLang = await LanguageResolver.resolve("custom_model.txt", "modelica");
    expect(overrideLang.manifest.id).toBe("modelica");

    const scadOverride = await LanguageResolver.resolve("test.any", "scad");
    expect(scadOverride.manifest.id).toBe("scad");
  });

  test("should register, resolve, and unregister user language in catalog", async () => {
    const customId = "minirobot";
    registerLanguage({
      id: customId,
      name: "MiniRobot",
      extensions: [".mbot", ".robot"],
    });

    const resolved = await LanguageResolver.resolve("rover.mbot");
    expect(resolved.manifest.id).toBe(customId);
    expect(resolved.manifest.name).toBe("MiniRobot");

    const resolved2 = await LanguageResolver.resolve("rover.robot");
    expect(resolved2.manifest.id).toBe(customId);

    const unregistered = unregisterLanguage(customId);
    expect(unregistered).toBe(true);

    await expect(LanguageResolver.resolve("rover.mbot")).rejects.toThrow("Unknown file extension");
  });
});

describe("Universal Formatting & Unparsing", () => {
  test("should format Modelica code with proper keyword and equation indentation", async () => {
    const lang = await LanguageResolver.resolve("test.mo");
    const unformatted = `model Oscillator
Real x;
equation
der(x) = -x;
end Oscillator;`;

    const formatted = await lang.format(unformatted, { indentSize: 2 });
    expect(formatted).toContain("  Real x;");
    expect(formatted).toContain("  der(x) = -x;");
    expect(formatted.startsWith("model Oscillator")).toBe(true);
    expect(formatted.trim().endsWith("end Oscillator;")).toBe(true);
  });

  test("should format STEP document with standardized spacing and records", async () => {
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
    expect(formatted).toContain("#1=PRODUCT ('Cube','Test');");
    expect(formatted).toContain("#2=APPLICATION_CONTEXT('automotive');");
  });

  test("should format SysML v2 with clean block indentation", async () => {
    const lang = await LanguageResolver.resolve("model.sysml");
    const rawSysml = `package Vehicle {
part def Chassis {
attribute mass : Real;
}
}`;

    const formatted = await lang.format(rawSysml, { indentSize: 2 });
    expect(formatted).toContain("  part def Chassis {");
    expect(formatted).toContain("    attribute mass : Real;");
  });

  test("should unparse code cleanly", async () => {
    const lang = await LanguageResolver.resolve("sample.mo");
    const code = `model Spring
  Real f;
equation
  f = 0;
end Spring;`;

    const unparsed = await lang.unparse(code);
    expect(unparsed).toContain("model Spring");
    expect(unparsed).toContain("end Spring;");
  });
});

describe("Parser Execution across Built-in Languages", () => {
  test("should load parser and parse Modelica source into CST", async () => {
    const lang = await LanguageResolver.resolve("test.mo");
    const { parser } = await lang.loadParser();
    expect(parser).toBeDefined();

    const tree = parser.parse("model M equation x = 1; end M;");
    expect(tree).toBeDefined();
    expect(tree.rootNode).toBeDefined();
    expect(tree.rootNode.toString()).toContain("class_definition");
  });

  test("should load parser and parse OpenSCAD source into CST", async () => {
    const lang = await LanguageResolver.resolve("part.scad");
    const { parser } = await lang.loadParser();
    expect(parser).toBeDefined();

    const tree = parser.parse("cube([10, 20, 30]);");
    expect(tree).toBeDefined();
    expect(tree.rootNode).toBeDefined();
    expect(tree.rootNode.toString().length).toBeGreaterThan(0);
  });
});
