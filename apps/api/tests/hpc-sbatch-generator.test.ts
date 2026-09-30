// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert";
import test from "node:test";
import { COMPUTE_PROFILES } from "../src/services/hpc/compute-profiles.js";
import type { HpcJobSpec } from "../src/services/hpc/hpc-types.js";
import { generateSbatchScript } from "../src/services/hpc/sbatch-generator.js";

test("HPC .sbatch Generator", async (t) => {
  await t.test("generates standard single-node CPU script", () => {
    const profile = COMPUTE_PROFILES["standard"]!;
    const spec: HpcJobSpec = {
      jobId: "test-std-100",
      name: "Standard-Simulation",
      command: "ccx",
      args: ["-i", "job"],
      workingDir: "/workspace",
      resources: {
        cpusPerTask: profile.cpus,
        memoryMb: profile.memoryMb,
        partition: profile.partition,
        timeLimitMinutes: 120,
      },
      env: {
        SOLVER_OPT: "FAST",
      },
    };

    const sbatch = generateSbatchScript(spec);

    assert.ok(sbatch.includes("#!/bin/bash"), "Should have bash shebang");
    assert.ok(sbatch.includes("#SBATCH --job-name=Standard-Simulation"), "Should set job name");
    assert.ok(sbatch.includes("#SBATCH --output=slurm-%j.out"), "Should direct output");
    assert.ok(sbatch.includes("#SBATCH --nodes=1"), "Should default to 1 node");
    assert.ok(sbatch.includes("#SBATCH --cpus-per-task=4"), "Should set 4 cpus");
    assert.ok(sbatch.includes("#SBATCH --mem=16384M"), "Should set memory");
    assert.ok(sbatch.includes("#SBATCH --partition=compute"), "Should set partition");
    assert.ok(sbatch.includes("#SBATCH --time=02:00:00"), "Should format time as HH:MM:SS");
    assert.ok(sbatch.includes("export OMP_NUM_THREADS=4"), "Should set OpenMP thread count");
    assert.ok(sbatch.includes('export SOLVER_OPT="FAST"'), "Should export custom env variable");
    assert.ok(sbatch.includes("ccx -i job"), "Should run command directly");
    assert.ok(!sbatch.includes("srun"), "Should not use srun for single-task job");
  });

  await t.test("generates GPU-accelerated script with Apptainer", () => {
    const profile = COMPUTE_PROFILES["gpu-a100"]!;
    const spec: HpcJobSpec = {
      jobId: "test-gpu-200",
      name: "GPU-Surrogate",
      command: "python3",
      args: ["train.py", "--epochs", "50"],
      workingDir: "/workspace",
      apptainerImage: "/images/pytorch.sif",
      resources: {
        cpusPerTask: profile.cpus,
        memoryMb: profile.memoryMb,
        partition: profile.partition,
        gpus: profile.gpus,
        gpuType: profile.gpuType,
      },
    };

    const sbatch = generateSbatchScript(spec);

    assert.ok(sbatch.includes("#SBATCH --gres=gpu:a100:1"), "Should include GPU GRES directive");
    assert.ok(sbatch.includes("#SBATCH --partition=gpu"), "Should use GPU partition");
    assert.ok(
      sbatch.includes("apptainer exec --nv /images/pytorch.sif python3 train.py --epochs 50"),
      "Should wrap in apptainer with nv",
    );
  });

  await t.test("generates multi-node MPI script with srun wrapper", () => {
    const profile = COMPUTE_PROFILES["hpc-mpi-64"]!;
    const spec: HpcJobSpec = {
      jobId: "test-mpi-300",
      name: "Aerodynamic-SU2",
      command: "SU2_CFD",
      args: ["config.cfg"],
      workingDir: "/workspace",
      modules: ["openmpi/4.1.4", "su2/7.5.0"],
      resources: {
        nodes: profile.nodes,
        tasksPerNode: profile.tasksPerNode,
        cpusPerTask: profile.cpus,
        memoryMb: profile.memoryMb,
        partition: profile.partition,
      },
    };

    const sbatch = generateSbatchScript(spec);

    assert.ok(sbatch.includes("#SBATCH --nodes=2"), "Should request 2 nodes");
    assert.ok(sbatch.includes("#SBATCH --ntasks-per-node=32"), "Should request 32 tasks/node");
    assert.ok(sbatch.includes("#SBATCH --cpus-per-task=1"), "Should set 1 cpu/task");
    assert.ok(sbatch.includes("module load openmpi/4.1.4"), "Should load openmpi module");
    assert.ok(sbatch.includes("module load su2/7.5.0"), "Should load su2 module");
    assert.ok(sbatch.includes("srun SU2_CFD config.cfg"), "Should wrap multi-task MPI in srun");
  });

  await t.test("generates network-isolated zero-egress scripts", () => {
    // 1. Apptainer container network isolation
    const apptainerSpec: HpcJobSpec = {
      jobId: "iso-apptainer",
      name: "Sandbox-Apptainer",
      command: "python3",
      args: ["run.py"],
      workingDir: "/workspace",
      apptainerImage: "/images/sandbox.sif",
      resources: { networkIsolation: true },
    };
    const sbatchApptainer = generateSbatchScript(apptainerSpec);
    assert.ok(
      sbatchApptainer.includes("apptainer exec --net --network none /images/sandbox.sif python3 run.py"),
      "Apptainer should include --net --network none",
    );
    assert.ok(sbatchApptainer.includes("# --- Security & Zero-Egress Network Isolation ---"));

    // 2. Native unshare network isolation
    const nativeSpec: HpcJobSpec = {
      jobId: "iso-native",
      name: "Sandbox-Native",
      command: "omc",
      args: ["simulate.mos"],
      workingDir: "/workspace",
      resources: {},
      sandbox: { networkIsolation: true },
    };
    const sbatchNative = generateSbatchScript(nativeSpec);
    assert.ok(
      sbatchNative.includes("unshare -n -r omc simulate.mos"),
      "Native command should be wrapped with unshare -n -r",
    );
  });
});
