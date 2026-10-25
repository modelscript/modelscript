// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { after, before, describe, it } from "node:test";
import { Lint } from "../src/commands/lint.js";
import { LanguageResolver, listAllLanguages } from "../src/util/language-registry.js";

async function runLintJson(args: {
  path: string;
  paths?: string[];
  language?: string;
  profile?: "DL" | "EL";
  strict?: boolean;
}): Promise<{ diags: any[]; exitCode: number | undefined }> {
  const logs: string[] = [];
  const origLog = console.log;
  const origExitCode = process.exitCode;
  process.exitCode = 0;
  console.log = (...msgs: any[]) => {
    logs.push(msgs.map(String).join(" "));
  };
  try {
    await Lint.handler({
      ...args,
      paths: args.paths,
      format: "json",
      _: ["lint"],
      $0: "msx",
    } as any);
    const exitCode = typeof process.exitCode === "number" ? process.exitCode : undefined;
    const raw = logs.join("\n").trim();
    const diags = raw ? JSON.parse(raw) : [];
    return { diags, exitCode };
  } finally {
    console.log = origLog;
    process.exitCode = origExitCode;
  }
}

describe("Unified Polyglot CLI Linter (`msx lint`)", () => {
  const scratchDir = path.resolve(import.meta.dirname, "scratch_lint_unified");

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

  it("registers all polyglot extensions in LanguageResolver", async () => {
    const { builtIn } = listAllLanguages();
    const ids = builtIn.map((b) => b.id);
    for (const expectedId of [
      "modelica",
      "sysml2",
      "owl2",
      "scad",
      "step",
      "csv",
      "ssp",
      "cfd",
      "fea",
      "pscad",
      "fortran",
      "easy5",
      "rocets",
      "lps",
      "sima",
      "gtsuite",
    ]) {
      assert.ok(ids.includes(expectedId), `Expected built-in language '${expectedId}'`);
    }

    const kerml = await LanguageResolver.resolve("stdlib.kerml");
    assert.strictEqual(kerml.manifest.id, "sysml2");

    const owl2 = await LanguageResolver.resolve("domain.owl2");
    assert.strictEqual(owl2.manifest.id, "owl2");

    const ssd = await LanguageResolver.resolve("SystemStructure.ssd");
    assert.strictEqual(ssd.manifest.id, "ssp");

    const cfg = await LanguageResolver.resolve("wing.cfg");
    assert.strictEqual(cfg.manifest.id, "cfd");

    const inp = await LanguageResolver.resolve("beam.inp");
    assert.strictEqual(inp.manifest.id, "fea");

    const pscx = await LanguageResolver.resolve("grid.pscx");
    assert.strictEqual(pscx.manifest.id, "pscad");

    const f90 = await LanguageResolver.resolve("calc.f90");
    assert.strictEqual(f90.manifest.id, "fortran");
  });

  it("lints Modelica (.mo) files with Salsa semantic checks and CST lints", async () => {
    const validMo = path.join(scratchDir, "ValidOscillator.mo");
    fs.writeFileSync(
      validMo,
      `model ValidOscillator
  parameter Real k = 10.0;
  Real x(start = 1.0);
  Real v(start = 0.0);
equation
  der(x) = v;
  der(v) = -k * x;
end ValidOscillator;`,
      "utf-8",
    );

    const { diags: validDiags, exitCode: validExit } = await runLintJson({ path: validMo });
    const validErrors = validDiags.filter((d) => d.severity === "error");
    assert.strictEqual(validErrors.length, 0);
    assert.strictEqual(validExit, 0);

    const invalidMo = path.join(scratchDir, "BrokenModel.mo");
    fs.writeFileSync(
      invalidMo,
      `model BrokenModel
  Real x = "not_a_number";
equation
  x = unknownVar + 1.0;
end BrokenModel;`,
      "utf-8",
    );

    const { diags: invalidDiags, exitCode: invalidExit } = await runLintJson({ path: invalidMo });
    assert.ok(invalidDiags.length > 0, "Expected diagnostics on invalid Modelica model");
    assert.strictEqual(invalidExit, 1);
    assert.ok(
      invalidDiags.some(
        (d) =>
          d.code === "M2002" ||
          d.code === "M3001" ||
          d.lintName?.includes("type-mismatch") ||
          d.lintName?.includes("variable-not-found"),
      ),
      `Expected M2002 or M3001 in ${JSON.stringify(invalidDiags)}`,
    );
  });

  it("lints SysML v2 (.sysml) and KerML (.kerml) files with embedded stdlib and formal verifiers", async () => {
    const validSysml = path.join(scratchDir, "ValidVehicle.sysml");
    fs.writeFileSync(
      validSysml,
      `package ValidVehicle {
  part def Vehicle {
    attribute mass : Real = 1500.0;
    attribute active : Boolean = true;
  }
}`,
      "utf-8",
    );

    const { diags: validDiags } = await runLintJson({ path: validSysml });
    const validErrors = validDiags.filter((d) => d.severity === "error");
    assert.strictEqual(
      validErrors.length,
      0,
      `Expected 0 errors on valid SysML v2 model with stdlib types, got: ${JSON.stringify(validErrors)}`,
    );

    const invalidKerml = path.join(scratchDir, "InvalidTypes.kerml");
    fs.writeFileSync(
      invalidKerml,
      `package InvalidTypes {
  part def Controller {
    attribute count : Integer = "wrong";
  }
}`,
      "utf-8",
    );

    const { diags: invalidDiags, exitCode } = await runLintJson({ path: invalidKerml });
    assert.ok(invalidDiags.length > 0, "Expected type mismatch diagnostic on invalid .kerml file");
    assert.strictEqual(exitCode, 1);
    assert.ok(
      invalidDiags.some((d) => d.code === "S3001" || d.lintName === "type-mismatch-assignment"),
      `Expected S3001 on .kerml file, got: ${JSON.stringify(invalidDiags)}`,
    );
  });

  it("lints OWL 2 (.owl) ontologies across structural, DL, EL profile, and reasoner consistency rules", async () => {
    const invalidOwl = path.join(scratchDir, "BrokenOntology.owl");
    fs.writeFileSync(
      invalidOwl,
      `Prefix(:=<http://example.com/ont#>)
Ontology(<http://example.com/ont>
  Declaration(ObjectProperty(:p))
  Declaration(DataProperty(:p))
  Declaration(Class(:A))
  Declaration(Class(:B))
  Declaration(NamedIndividual(:x))
  DisjointClasses(:A :B)
  SubClassOf(:A :B)
  ClassAssertion(:A :x)
  SubClassOf(:A ObjectComplementOf(:B))
)`,
      "utf-8",
    );

    const { diags: dlDiags, exitCode } = await runLintJson({ path: invalidOwl, profile: "DL" });
    assert.strictEqual(exitCode, 1);
    const codes = new Set(dlDiags.map((d) => d.code));
    assert.ok(codes.has("O3001"), `Expected O3001 property punning error, got ${JSON.stringify(dlDiags)}`);
    assert.ok(
      codes.has("O5001") || codes.has("O5003"),
      `Expected O5001/O5003 unsatisfiable class or inconsistency error, got ${JSON.stringify(dlDiags)}`,
    );

    const { diags: elDiags } = await runLintJson({ path: invalidOwl, profile: "EL" });
    assert.ok(
      elDiags.some((d) => d.code === "O6001"),
      `Expected O6001 EL profile violation for ObjectComplementOf, got ${JSON.stringify(elDiags)}`,
    );
  });

  it("lints OpenSCAD (.scad), CFD (.cfg), FEA (.inp), STEP (.step), and CSV (.csv) files", async () => {
    const scadFile = path.join(scratchDir, "bad_cube.scad");
    fs.writeFileSync(scadFile, `cube(size = -5);`, "utf-8");
    const { diags: scadDiags } = await runLintJson({ path: scadFile });
    assert.ok(scadDiags.length > 0, "Expected OpenSCAD linter diagnostic for negative cube size");

    const cfdFile = path.join(scratchDir, "bad_config.cfg");
    fs.writeFileSync(cfdFile, `MACH_NUMBER = 0.8\nINVALID_LINE_WITHOUT_EQUALS\n`, "utf-8");
    const { diags: cfdDiags } = await runLintJson({ path: cfdFile });
    assert.ok(
      cfdDiags.some((d) => d.code === "CFD-001"),
      `Expected CFD-001 diagnostic, got ${JSON.stringify(cfdDiags)}`,
    );

    const feaFile = path.join(scratchDir, "bad_deck.inp");
    fs.writeFileSync(feaFile, `*NODE\n1, 0.0, 0.0, 0.0\n*BOGUS_CARD\n`, "utf-8");
    const { diags: feaDiags } = await runLintJson({ path: feaFile });
    assert.ok(
      feaDiags.some((d) => d.code === "FEA-002"),
      `Expected FEA-002 unknown card diagnostic, got ${JSON.stringify(feaDiags)}`,
    );

    const stepFile = path.join(scratchDir, "bad_part.step");
    fs.writeFileSync(
      stepFile,
      `ISO-10303-21;
HEADER;
ENDSEC;
DATA;
#10 = PRODUCT('p1', 'Part 1', '', (#999));
ENDSEC;
END-ISO-10303-21;`,
      "utf-8",
    );
    const { diags: stepDiags } = await runLintJson({ path: stepFile });
    assert.ok(
      stepDiags.some((d) => d.code === "STEP-001"),
      `Expected STEP-001 undefined reference #999, got ${JSON.stringify(stepDiags)}`,
    );

    const f90File = path.join(scratchDir, "bad_script.f90");
    fs.writeFileSync(
      f90File,
      `SUBROUTINE bad()
  IMPLICIT NONE
  Y = 20.0
END SUBROUTINE
`,
      "utf-8",
    );
    const { diags: f90Diags } = await runLintJson({ path: f90File });
    assert.ok(
      f90Diags.some((d) => d.code === "M4070"),
      `Expected M4070 undeclared variable diagnostic in Fortran, got ${JSON.stringify(f90Diags)}`,
    );

    const ez5File = path.join(scratchDir, "loop.ez5");
    fs.writeFileSync(
      ez5File,
      `MODEL: LoopTest
COMPONENTS:
  GA01 TYPE=GP/GA
    XP: K=2.0
  SJ01 TYPE=GP/SJ
    XP: SGN1=1.0, SGN2=1.0
CONNECTIONS:
  GA01.OUT -> SJ01.IN1
  SJ01.OUT -> GA01.IN
`,
      "utf-8",
    );
    const { diags: ez5Diags } = await runLintJson({ path: ez5File });
    assert.ok(
      ez5Diags.some((d) => d.code === "M7002"),
      `Expected M7002 algebraic loop diagnostic in EASY5, got ${JSON.stringify(ez5Diags)}`,
    );

    const simaFile = path.join(scratchDir, "semi.sima");
    fs.writeFileSync(
      simaFile,
      `<?xml version="1.0" encoding="UTF-8"?>
<sima:SlenderSystem name="NegativeGM" waterDepth="200.0">
  <sima:Vessel name="Semi" length="100.0" displacement="15000.0" gmt="-1.5" gml="10.0" draft="20.0" />
</sima:SlenderSystem>
`,
      "utf-8",
    );
    const { diags: simaDiags } = await runLintJson({ path: simaFile });
    assert.ok(
      simaDiags.some((d) => d.code === "M7001"),
      `Expected M7001 negative metacentric height diagnostic in SIMA, got ${JSON.stringify(simaDiags)}`,
    );

    const gtmFile = path.join(scratchDir, "engine.gtm");
    fs.writeFileSync(
      gtmFile,
      `MODEL: BadEngine
SPEED: 3000.0
LAMBDA: 3.5

COMPONENTS:
  CYL1 = cylinder (BORE = 0.0825, STROKE = 0.0928, ROD = 0.144, CR = 35.0, ANCHOR = 15, DURATION = 45)
`,
      "utf-8",
    );
    const { diags: gtmDiags } = await runLintJson({ path: gtmFile });
    assert.ok(
      gtmDiags.some((d) => d.code === "M9005"),
      `Expected M9005 compression ratio diagnostic in GT-SUITE, got ${JSON.stringify(gtmDiags)}`,
    );

    // Filter directory linting by --language
    const { diags: filteredCfd } = await runLintJson({ path: scratchDir, language: "cfd" });
    assert.ok(filteredCfd.length > 0);
    assert.ok(
      filteredCfd.every((d) => d.resource.endsWith(".cfg")),
      "Expected --language cfd to only lint .cfg files",
    );
  });
});
