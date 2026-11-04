// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert";
import { describe, it } from "node:test";
import {
  EXAMPLES_BY_LANGUAGE,
  EXAMPLE_TEMPLATES,
  LANGUAGE_GROUPS,
  LANGUAGE_TILES,
  TEMPLATE_ALIASES,
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

describe("66-Language Catalog & 2-Level Example Templates Suite", () => {
  it("defines all 15 domain groups and all 66 polyglot language tiles with maturity tiers", () => {
    assert.strictEqual(LANGUAGE_GROUPS.length, 15, "Must define 15 domain groups");
    assert.strictEqual(LANGUAGE_TILES.length, 66, "Must define all 66 languages");

    const groupIds = new Set(LANGUAGE_GROUPS.map((g) => g.id));
    for (const lang of LANGUAGE_TILES) {
      assert.ok(groupIds.has(lang.group), `Language '${lang.id}' has unknown group '${lang.group}'`);
      assert.ok(
        ["stable", "beta", "preview"].includes(lang.tier),
        `Language '${lang.id}' has invalid maturity tier '${lang.tier}'`,
      );
      const examples = EXAMPLES_BY_LANGUAGE.get(lang.id) ?? [];
      assert.ok(examples.length >= 1, `Language '${lang.id}' must have at least 1 verified example workspace`);
    }
  });

  const allTemplates = [
    "empty",
    "blank",
    "stress-test",
    "unknown-fallback-template",
    ...Object.keys(TEMPLATE_ALIASES),
    ...EXAMPLE_TEMPLATES.map((ex) => ex.id),
  ];

  for (const tpl of allTemplates) {
    if (tpl === "empty" || tpl === "blank" || tpl === "unknown-fallback-template") {
      it(`scaffolds empty template '${tpl}' with zero files and empty primary file`, () => {
        const memFs = new MemoryFsMock();
        const workspaceUri = { scheme: "memfs", path: "/" + tpl } as any;

        scaffoldTemplateFiles(memFs, workspaceUri);
        assert.strictEqual(memFs.files.size, 0, `Template '${tpl}' must be completely empty`);

        const primary = getTemplatePrimaryFile(tpl);
        assert.strictEqual(primary, "", `Template '${tpl}' must have empty string primary file`);
      });
    } else {
      it(`scaffolds template '${tpl}' and resolves an existing non-empty primary file`, () => {
        const memFs = new MemoryFsMock();
        const workspaceUri = { scheme: "memfs", path: "/" + tpl } as any;

        scaffoldTemplateFiles(memFs, workspaceUri);
        assert.ok(memFs.files.size > 0, `Template '${tpl}' must scaffold at least one file`);

        const primary = getTemplatePrimaryFile(tpl);
        assert.ok(primary, `Template '${tpl}' must have a non-empty primary file`);

        const expectedFullPath = "/" + tpl + "/" + primary;
        const fileNames = Array.from(memFs.files.keys());
        assert.ok(
          memFs.files.has(expectedFullPath),
          `Primary file '${primary}' for template '${tpl}' does not exist in scaffolded files: [${fileNames.join(", ")}]`,
        );

        for (const [filePath, content] of memFs.files.entries()) {
          assert.ok(content.byteLength > 0, `File '${filePath}' in template '${tpl}' must not be empty`);
        }
      });
    }
  }

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
    assert.ok(!memFs1.files.has("/artifact-101/README.md"), "Must not inject synthetic README.md");

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

    assert.strictEqual(res2.primaryFile, "geometry.step");
    assert.strictEqual(getTemplatePrimaryFile("artifact-102"), "geometry.step");
    assert.ok(memFs2.files.has("/artifact-102/geometry.step"));
    assert.ok(!memFs2.files.has("/artifact-102/DroneArm.mo"), "Must not create fake Modelica wrapper for STEP file");
    assert.ok(!memFs2.files.has("/artifact-102/README.md"), "Must not inject synthetic README.md");

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
    assert.ok(!memFs3.files.has("/artifact-103/README.md"));

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
    assert.ok(!memFs4.files.has("/artifact-104/README.md"));

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
    assert.ok(!memFs5.files.has("/artifact-105/README.md"));

    // 6. Package template & package artifact mounting
    const memFsPkg = new MemoryFsMock();
    const wsPkg = { scheme: "memfs", path: "/package-thermal_grid" } as any;
    scaffoldTemplateFiles(memFsPkg, wsPkg);

    assert.strictEqual(getTemplatePrimaryFile("package-thermal_grid"), "package.mo");
    assert.ok(memFsPkg.files.has("/package-thermal_grid/package.mo"));
    assert.ok(!memFsPkg.files.has("/package-thermal_grid/thermal_gridDemo.mo"));
    assert.ok(!memFsPkg.files.has("/package-thermal_grid/README.md"));

    // 6b. Package card artifact (like artifact-51 Modelica@4.1.0)
    const memFsPkgCard = new MemoryFsMock();
    const wsPkgCard = { scheme: "memfs", path: "/artifact-51" } as any;
    const resPkgCard = mountArtifactToMemFs(memFsPkgCard, wsPkgCard, {
      artifactId: 51,
      title: "Modelica@4.1.0",
      viewType: "package",
      viewConfig: {
        name: "Modelica",
        version: "4.1.0",
        description: "Modelica Standard Library 4.1.0",
      },
      files: {
        "package.mo": 'within ;\npackage Modelica "Modelica Standard Library"\nend Modelica;\n',
        "package.order": "Blocks\nElectrical\nMechanics\n",
      },
      primaryFile: "package.mo",
    });

    assert.strictEqual(resPkgCard.primaryFile, "package.mo");
    assert.strictEqual(getTemplatePrimaryFile("artifact-51"), "package.mo");
    assert.ok(memFsPkgCard.files.has("/artifact-51/package.mo"));
    assert.ok(memFsPkgCard.files.has("/artifact-51/package.order"));
    assert.ok(!memFsPkgCard.files.has("/artifact-51/ArtifactModel_51.mo"));
    assert.ok(!memFsPkgCard.files.has("/artifact-51/README.md"));

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

    // 8. SysML v2 Artifact (e.g. ArtemisLunarLanderGNC artifact-3)
    const memFsSysml = new MemoryFsMock();
    const wsSysml = { scheme: "memfs", path: "/artifact-3" } as any;
    const resSysml = mountArtifactToMemFs(memFsSysml, wsSysml, {
      artifactId: 3,
      title: "ArtemisLunarLanderGNC — OMG SysML v2 Descent & Touchdown Architecture",
      viewType: "sysml2",
      primaryFile: "ArtemisLunarLanderGNC.sysml",
      viewConfig: {
        filename: "ArtemisLunarLanderGNC.sysml",
        code: "package ArtemisLunarLanderGNC {\n  part def Lander;\n}\n",
      },
    });

    assert.strictEqual(resSysml.primaryFile, "ArtemisLunarLanderGNC.sysml");
    assert.strictEqual(getTemplatePrimaryFile("artifact-3"), "ArtemisLunarLanderGNC.sysml");
    assert.ok(memFsSysml.files.has("/artifact-3/ArtemisLunarLanderGNC.sysml"));
    assert.ok(!memFsSysml.files.has("/artifact-3/README.md"), "Must not inject synthetic README.md");
    assert.ok(
      !memFsSysml.files.has("/artifact-3/ArtifactModel.mo"),
      "Must not create dummy ArtifactModel.mo for SysML v2",
    );

    // 9. Multi-file Artifact Workspace mounting
    const memFsMulti = new MemoryFsMock();
    const wsMulti = { scheme: "memfs", path: "/artifact-106" } as any;
    const resMulti = mountArtifactToMemFs(memFsMulti, wsMulti, {
      artifactId: 106,
      title: "BatteryThermalManagement",
      viewType: "modelscript",
      files: {
        "main.msx": "package Main;\nend Main;\n",
        "battery.msx": "package Battery;\nend Battery;\n",
        "thermal.msx": "package Thermal;\nend Thermal;\n",
      },
      primaryFile: "main.msx",
    });

    assert.strictEqual(resMulti.primaryFile, "main.msx");
    assert.strictEqual(getTemplatePrimaryFile("artifact-106"), "main.msx");
    assert.ok(memFsMulti.files.has("/artifact-106/main.msx"));
    assert.ok(memFsMulti.files.has("/artifact-106/battery.msx"));
    assert.ok(memFsMulti.files.has("/artifact-106/thermal.msx"));
    assert.ok(!memFsMulti.files.has("/artifact-106/README.md"));

    // 10. Direct URL navigation (#memfs:artifact-777) hydrated via localStorage
    const storageMap = new Map<string, string>();
    const mockStorage = {
      getItem: (k: string) => storageMap.get(k) ?? null,
      setItem: (k: string, v: string) => storageMap.set(k, v),
      removeItem: (k: string) => storageMap.delete(k),
      clear: () => storageMap.clear(),
      length: 0,
      key: () => null,
    };
    const originalLocalStorage = (globalThis as any).localStorage;
    try {
      (globalThis as any).localStorage = mockStorage;
      mockStorage.setItem(
        "modelscript.artifact_777",
        JSON.stringify({
          artifactId: 777,
          title: "HydratedFromLocalStorage",
          viewType: "sysml2",
          filename: "VehicleArchitecture.sysml",
          viewConfig: {
            filename: "VehicleArchitecture.sysml",
            code: "package VehicleArchitecture {\n}\n",
          },
        }),
      );

      assert.strictEqual(getTemplatePrimaryFile("artifact-777"), "VehicleArchitecture.sysml");
      const memFsHydrated = new MemoryFsMock();
      const wsHydrated = { scheme: "memfs", path: "/artifact-777" } as any;
      scaffoldTemplateFiles(memFsHydrated, wsHydrated);

      assert.ok(memFsHydrated.files.has("/artifact-777/VehicleArchitecture.sysml"));
      assert.ok(!memFsHydrated.files.has("/artifact-777/ArtifactModel.mo"));
    } finally {
      (globalThis as any).localStorage = originalLocalStorage;
    }
  });
});
