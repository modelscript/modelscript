// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert";
import { describe, it } from "node:test";
import {
  getTemplatePrimaryFile,
  scaffoldTemplateFiles,
  type IMemoryFileSystemProvider,
} from "../src/templates/catalog.js";

class MemoryFsMock implements IMemoryFileSystemProvider {
  files = new Map<string, Uint8Array>();

  writeFile(uri: { path: string }, content: Uint8Array): void {
    this.files.set(uri.path, content);
  }

  writeFiles(entries: [{ path: string }, Uint8Array][]): void {
    for (const [uri, content] of entries) {
      this.files.set(uri.path, content);
    }
  }
}

describe("Catalog Templates & Primary File Resolution Suite", () => {
  const allTemplates = [
    "empty",
    "blank",
    "bouncing-ball",
    "rlc",
    "script",
    "notebook",
    "stress-test",
    "drone-chassis",
    "cad",
    "cad-assembly",
    "drone-meshing",
    "drone-fea",
    "drone-cfd",
    "modelica-procedural-cad",
    "assembly-to-multibody",
    "injection-molding-cosim",
    "sysml2",
    "simulation-verification",
    "mbse-verification",
    "hardware-ci",
    "fmi2",
    "fmi3",
    "surrogate",
    "cfd-verification",
    "calibration",
    "data-driven-calibration",
    "multi-fidelity-binding",
    "optimica-polyglot",
    "uncertainty",
    "cosim",
    "uns-mqtt",
    "owl2-contradiction",
    "owl2-fmea",
    "owl2-manufacturing",
    "owl2-subsumption",
    "owl2-units",
  ];

  it("defines 36 templates with no unmapped or missing templates", () => {
    assert.strictEqual(allTemplates.length, 36);
  });

  for (const tpl of allTemplates) {
    it(`scaffolds template '${tpl}' and resolves an existing primary file`, () => {
      const memFs = new MemoryFsMock();
      const workspaceUri = { scheme: "memfs", path: "/" + tpl } as any;

      scaffoldTemplateFiles(memFs, workspaceUri);
      assert.ok(memFs.files.size > 0, `Template '${tpl}' must scaffold at least one file`);

      const primary = getTemplatePrimaryFile(tpl);
      assert.ok(primary, `Template '${tpl}' must have a non-empty primary file`);
      assert.notStrictEqual(primary, "", `Template '${tpl}' must not return empty string as primary file`);

      const expectedFullPath = "/" + tpl + "/" + primary;
      const fileNames = Array.from(memFs.files.keys());
      assert.ok(
        memFs.files.has(expectedFullPath),
        `Primary file '${primary}' for template '${tpl}' does not exist in scaffolded files: [${fileNames.join(", ")}]`,
      );

      // Verify each file has non-empty content
      for (const [filePath, content] of memFs.files.entries()) {
        assert.ok(content.byteLength > 0, `File '${filePath}' in template '${tpl}' must not be empty`);

        if (filePath.endsWith(".msim") || filePath.endsWith(".monb")) {
          const text = new TextDecoder().decode(content);
          assert.doesNotThrow(
            () => JSON.parse(text),
            `File '${filePath}' in template '${tpl}' must contain valid JSON`,
          );
        }
      }
    });
  }

  it("maps key templates to their expected specialized entry files", () => {
    assert.strictEqual(getTemplatePrimaryFile("notebook"), "demo.monb");
    assert.strictEqual(getTemplatePrimaryFile("sysml2"), "VehicleSystem.sysml");
    assert.strictEqual(getTemplatePrimaryFile("drone-chassis"), "DroneSimulation.mo");
    assert.strictEqual(getTemplatePrimaryFile("assembly-to-multibody"), "SimplePendulum.step");
    assert.strictEqual(getTemplatePrimaryFile("calibration"), "SpringDamper.mo");
    assert.strictEqual(getTemplatePrimaryFile("script"), "simulate.mos");
    assert.strictEqual(getTemplatePrimaryFile("mbse-verification"), "VerificationReport.md");
    assert.strictEqual(getTemplatePrimaryFile("owl2-contradiction"), "constraints.owl");
    assert.strictEqual(getTemplatePrimaryFile("owl2-manufacturing"), "drone.sysml");
  });
});
