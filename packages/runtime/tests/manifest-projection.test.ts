// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, it } from "node:test";
import {
  projectAtopileYaml,
  projectCombineOmexManifest,
  projectFortranFpmToml,
  projectKiCadLibTable,
  projectLegacyModelScriptJson,
  projectModelicaPackageMo,
  projectPyProjectToml,
  resolveManifestFromDir,
} from "../src/workspace/manifest-projection.js";

describe("Virtual modelscript.yaml projection from historical language manifests", () => {
  it("projects Modelica package.mo annotations (version + uses) into a virtual manifest", () => {
    const mo = `
package ThermalPlant "District heating thermal plant"
  annotation(
    version = "2.1.0",
    uses(
      Modelica(version = "4.0.0"),
      Buildings(version = "10.0.0")
    )
  );
end ThermalPlant;
`;
    const manifest = projectModelicaPackageMo(mo, "fallback-dir");
    assert.ok(manifest);
    assert.equal(manifest.name, "ThermalPlant");
    assert.equal(manifest.version, "2.1.0");
    assert.equal(manifest.description, "District heating thermal plant");
    assert.deepEqual(manifest.dependencies, {
      Modelica: "4.0.0",
      Buildings: "10.0.0",
    });
    assert.deepEqual(manifest.languages, ["modelica"]);
  });

  it("projects Atopile ato.yaml into a virtual manifest", () => {
    const ato = `
ato-version: ^0.2.0
package:
  identifier: acme/buck-converter
  version: 0.4.2
  summary: 48V to 12V synchronous buck converter
dependencies:
  - identifier: atopile/ti-tps5430
    release: 1.2.0
`;
    const manifest = projectAtopileYaml(ato, "fallback");
    assert.ok(manifest);
    assert.equal(manifest.name, "acme/buck-converter");
    assert.equal(manifest.version, "0.4.2");
    assert.deepEqual(manifest.dependencies, { "atopile/ti-tps5430": "1.2.0" });
    assert.deepEqual(manifest.languages, ["atopile"]);
  });

  it("projects Fortran fpm.toml into a virtual manifest", () => {
    const toml = `
name = "aero-kernel"
version = "1.3.0"
description = "Aerodynamic solver kernel"

[dependencies]
stdlib = { git = "https://github.com/fortran-lang/stdlib", tag = "v0.6.0" }
`;
    const manifest = projectFortranFpmToml(toml, "fallback");
    assert.ok(manifest);
    assert.equal(manifest.name, "aero-kernel");
    assert.equal(manifest.version, "1.3.0");
    assert.deepEqual(manifest.dependencies, { stdlib: "v0.6.0" });
  });

  it("projects Python pyproject.toml into a virtual manifest", () => {
    const py = `
[project]
name = "grid-study"
version = "0.9.1"
description = "PyPSA grid model"
dependencies = ["pypsa>=0.28", "numpy>=1.26"]
`;
    const manifest = projectPyProjectToml(py, "fallback");
    assert.ok(manifest);
    assert.equal(manifest.name, "grid-study");
    assert.equal(manifest.version, "0.9.1");
    assert.deepEqual(manifest.dependencies, { pypsa: ">=0.28", numpy: ">=1.26" });
  });

  it("projects KiCad sym-lib-table into a virtual manifest", () => {
    const kicad = `(sym_lib_table (lib (name "PowerRegulators") (type "KiCad") (uri "\${KIPRJMOD}/libs/power.kicad_sym")))`;
    const manifest = projectKiCadLibTable(kicad, "board-rev2");
    assert.ok(manifest);
    assert.equal(manifest.name, "board-rev2");
    assert.deepEqual(manifest.dependencies, { PowerRegulators: "${KIPRJMOD}/libs/power.kicad_sym" });
  });

  it("projects COMBINE/OMEX manifest.xml into a virtual manifest", () => {
    const xml = `<omexManifest><content location="./model.sbml" format="http://identifiers.org/combine.specifications/sbml"/></omexManifest>`;
    const manifest = projectCombineOmexManifest(xml, "pk-model");
    assert.ok(manifest);
    assert.deepEqual(manifest.artifacts, ["model.sbml"]);
    assert.deepEqual(manifest.languages, ["sbml"]);
  });

  it("projects legacy modelscript.json into a virtual manifest", () => {
    const legacy = JSON.stringify({ name: "legacy-pkg", version: "1.0.0", dependencies: { Modelica: "^4.0.0" } });
    const manifest = projectLegacyModelScriptJson(legacy, "fallback");
    assert.ok(manifest);
    assert.equal(manifest.name, "legacy-pkg");
    assert.deepEqual(manifest.dependencies, { Modelica: "^4.0.0" });
  });

  it("prefers explicit modelscript.yaml over historical manifests in resolveManifestFromDir", async () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "msx-manifest-proj-"));
    try {
      fs.writeFileSync(
        path.join(tmpDir, "package.mo"),
        `package FromMo annotation(version="1.0.0", uses(Modelica(version="4.0.0"))); end FromMo;`,
      );
      const projected = await resolveManifestFromDir(tmpDir);
      assert.ok(projected);
      assert.equal(projected.virtual, true);
      assert.equal(projected.projectorId, "modelica-package-mo");
      assert.equal(projected.manifest.name, "FromMo");

      fs.writeFileSync(path.join(tmpDir, "modelscript.yaml"), `name: explicit-pkg\nversion: "2.0.0"\n`);
      const explicit = await resolveManifestFromDir(tmpDir);
      assert.ok(explicit);
      assert.equal(explicit.virtual, false);
      assert.equal(explicit.projectorId, "modelscript.yaml");
      assert.equal(explicit.manifest.name, "explicit-pkg");
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });
});
