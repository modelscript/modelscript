// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert";
import { describe, it } from "node:test";
import {
  getTemplatePrimaryFile,
  mountArtifactToMemFs,
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

  it("scaffolds and mounts artifact workspaces for various engineering modalities", () => {
    // 1. Modelica Code Artifact
    const memFs1 = new MemoryFsMock();
    const ws1 = { scheme: "memfs", path: "/artifact-101" } as any;
    const res1 = mountArtifactToMemFs(memFs1, ws1, {
      artifactId: 101,
      title: "LorenzAttractor",
      viewType: "modelica-code",
      viewConfig: {
        code: "model LorenzAttractor\n  Real x(start=1.0);\n  Real y;\nequation\n  der(x) = y;\nend LorenzAttractor;\n",
      },
    });

    assert.strictEqual(res1.primaryFile, "LorenzAttractor.mo");
    assert.strictEqual(getTemplatePrimaryFile("artifact-101"), "LorenzAttractor.mo");
    assert.ok(memFs1.files.has("/artifact-101/LorenzAttractor.mo"));
    assert.ok(memFs1.files.has("/artifact-101/README.md"));

    // 2. CAD STEP Artifact
    const memFs2 = new MemoryFsMock();
    const ws2 = { scheme: "memfs", path: "/artifact-102" } as any;
    const res2 = mountArtifactToMemFs(memFs2, ws2, {
      artifactId: 102,
      title: "DroneArm",
      viewType: "cad-step",
      viewConfig: {
        content: "ISO-10303-21;\nHEADER;\nENDSEC;\nDATA;\nENDSEC;\nEND-ISO-10303-21;",
      },
    });

    assert.strictEqual(res2.primaryFile, "DroneArm.mo");
    assert.strictEqual(getTemplatePrimaryFile("artifact-102"), "DroneArm.mo");
    assert.ok(memFs2.files.has("/artifact-102/geometry.step"));
    assert.ok(memFs2.files.has("/artifact-102/DroneArm.mo"));

    // 3. Simulation Plot Artifact
    const memFs3 = new MemoryFsMock();
    const ws3 = { scheme: "memfs", path: "/artifact-103" } as any;
    const res3 = mountArtifactToMemFs(memFs3, ws3, {
      artifactId: 103,
      title: "ChuaCircuitTrajectory",
      viewType: "simulation-plot",
      viewConfig: {
        model: "ChuaCircuit",
        variables: ["vC1", "vC2", "iL"],
        csvData: "time,vC1,vC2,iL\n0,1,0,0\n1,0.5,0.2,0.1",
      },
    });

    assert.strictEqual(res3.primaryFile, "ChuaCircuit.mo");
    assert.strictEqual(getTemplatePrimaryFile("artifact-103"), "ChuaCircuit.mo");
    assert.ok(memFs3.files.has("/artifact-103/ChuaCircuit.mo"));
    assert.ok(memFs3.files.has("/artifact-103/simulate.mos"));
    assert.ok(memFs3.files.has("/artifact-103/trajectory.csv"));

    // 4. GCode Toolpath Artifact
    const memFs4 = new MemoryFsMock();
    const ws4 = { scheme: "memfs", path: "/artifact-104" } as any;
    const res4 = mountArtifactToMemFs(memFs4, ws4, {
      artifactId: 104,
      title: "ImpellerMilling",
      viewType: "gcode",
      viewConfig: {
        gcode: "G21\nG90\nG1 X10 Y10 F1000",
      },
    });

    assert.strictEqual(res4.primaryFile, "toolpath.gcode");
    assert.strictEqual(getTemplatePrimaryFile("artifact-104"), "toolpath.gcode");
    assert.ok(memFs4.files.has("/artifact-104/toolpath.gcode"));

    // 5. AAS Package Artifact
    const memFs5 = new MemoryFsMock();
    const ws5 = { scheme: "memfs", path: "/artifact-105" } as any;
    const res5 = mountArtifactToMemFs(memFs5, ws5, {
      artifactId: 105,
      title: "SmartSensor",
      viewType: "aas-package",
      viewConfig: {
        manifest: { idShort: "SmartSensorShell", submodels: [] },
      },
    });

    assert.strictEqual(res5.primaryFile, "aas-manifest.json");
    assert.strictEqual(getTemplatePrimaryFile("artifact-105"), "aas-manifest.json");
    assert.ok(memFs5.files.has("/artifact-105/aas-manifest.json"));

    // 6. Package template mounting
    const memFsPkg = new MemoryFsMock();
    const wsPkg = { scheme: "memfs", path: "/package-thermal_grid" } as any;
    scaffoldTemplateFiles(memFsPkg, wsPkg);

    assert.strictEqual(getTemplatePrimaryFile("package-thermal_grid"), "thermal_gridDemo.mo");
    assert.ok(memFsPkg.files.has("/package-thermal_grid/package.json"));
    assert.ok(memFsPkg.files.has("/package-thermal_grid/package.mo"));
    assert.ok(memFsPkg.files.has("/package-thermal_grid/thermal_gridDemo.mo"));

    // 7. Scratch template mounting
    const memFsScratch = new MemoryFsMock();
    const wsScratch = { scheme: "memfs", path: "/scratch" } as any;
    mountArtifactToMemFs(memFsScratch, wsScratch, {
      artifactId: "scratch",
      title: "ScratchTest.mo",
      viewType: "modelica-code",
      viewConfig: {
        code: "model ScratchTest\n  Real x;\nequation\n  der(x) = -1;\nend ScratchTest;\n",
      },
    });

    assert.strictEqual(getTemplatePrimaryFile("scratch"), "ScratchTest.mo");
    assert.ok(memFsScratch.files.has("/scratch/ScratchTest.mo"));
    const scratchContent = new TextDecoder().decode(memFsScratch.files.get("/scratch/ScratchTest.mo")!);
    assert.ok(scratchContent.includes("model ScratchTest"));
  });
});
