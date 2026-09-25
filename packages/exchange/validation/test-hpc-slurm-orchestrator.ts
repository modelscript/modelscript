// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert";
import {
  HpcSlurmCfdProvider,
  InSituSliceCodec,
  type CfdSimulationJobSpec,
  type ParallelDecompositionSpec,
} from "../src/hpc/index.js";

async function main() {
  console.log("=== Testing Declarative HPC Slurm Orchestrator & In-Situ Telemetry ===");

  // 1. Test Automated OpenFOAM decomposeParDict Generation
  {
    console.log("1. Testing decomposeParDict synthesis...");
    const scotchSpec: ParallelDecompositionSpec = {
      method: "scotch",
      numberOfSubdomains: 128,
    };
    const scotchDict = HpcSlurmCfdProvider.generateDecomposeParDict(scotchSpec);
    assert.ok(scotchDict.includes("numberOfSubdomains 128;"));
    assert.ok(scotchDict.includes("method          scotch;"));
    assert.ok(scotchDict.includes("scotchCoeffs"));

    const hierSpec: ParallelDecompositionSpec = {
      method: "hierarchical",
      numberOfSubdomains: 64,
      directionalSplit: [4, 4, 4],
      delta: 0.002,
    };
    const hierDict = HpcSlurmCfdProvider.generateDecomposeParDict(hierSpec);
    assert.ok(hierDict.includes("numberOfSubdomains 64;"));
    assert.ok(hierDict.includes("method          hierarchical;"));
    assert.ok(hierDict.includes("n           ( 4 4 4 );"));
    assert.ok(hierDict.includes("delta       0.002;"));
    console.log("  ✓ Scotch & Hierarchical decomposeParDict generation verified.");
  }

  // 2. Test Slurm sbatch Script Generation
  {
    console.log("2. Testing Slurm sbatch script synthesis...");
    const jobSpec: CfdSimulationJobSpec = {
      jobId: "aero-wing-cfd-01",
      modelName: "TransonicWing",
      solver: "pimpleFoam",
      caseDir: "/shared/scratch/aero-wing",
      cluster: {
        endpoint: "hpc.internal:6820",
        scheduler: "slurm",
        partition: "gpu-h100",
        nodes: 4,
        tasksPerNode: 32,
        gpusPerNode: 4,
        walltime: "04:00:00",
        account: "aero-research",
        modules: ["openfoam/v2312", "openmpi/4.1.5", "cuda/12.2"],
      },
      decomposition: {
        method: "scotch",
        numberOfSubdomains: 128,
      },
      telemetry: {
        enabled: true,
        sampleIntervalSteps: 10,
      },
    };

    const sbatchScript = HpcSlurmCfdProvider.generateSbatchScript(jobSpec);
    assert.ok(sbatchScript.includes("#SBATCH --job-name=modelscript-aero-wing-cfd-01"));
    assert.ok(sbatchScript.includes("#SBATCH --nodes=4"));
    assert.ok(sbatchScript.includes("#SBATCH --ntasks-per-node=32"));
    assert.ok(sbatchScript.includes("#SBATCH --partition=gpu-h100"));
    assert.ok(sbatchScript.includes("#SBATCH --gpus-per-node=4"));
    assert.ok(sbatchScript.includes("#SBATCH --time=04:00:00"));
    assert.ok(sbatchScript.includes("module load openfoam/v2312"));
    assert.ok(sbatchScript.includes("decomposePar -force"));
    assert.ok(sbatchScript.includes("srun --mpi=pmix -n 128 pimpleFoam -parallel"));
    console.log("  ✓ Declarative sbatch submission script validated.");
  }

  // 3. Test In-Situ Binary Planar Cut-Plane Telemetry Codec
  {
    console.log("3. Testing In-Situ 2D planar telemetry slice codec...");
    const syntheticSlice = InSituSliceCodec.synthesizeSlice(
      [0.5, 0.0, 0.25],
      [0, 0, 1],
      [2.0, 1.0],
      [15, 8],
      0.15,
      150,
    );

    assert.strictEqual(syntheticSlice.numVertices, 15 * 8);
    assert.strictEqual(syntheticSlice.numTriangles, 14 * 7 * 2);
    assert.ok(syntheticSlice.fields.velocityMagnitude);
    assert.ok(syntheticSlice.fields.pressure);

    const binaryChunk = InSituSliceCodec.serialize(syntheticSlice);
    assert.ok(binaryChunk.byteLength > 64, "Binary chunk must contain header + geometry + fields");

    const decodedSlice = InSituSliceCodec.deserialize(binaryChunk);
    assert.strictEqual(decodedSlice.step, 150);
    assert.ok(Math.abs(decodedSlice.time - 0.15) < 1e-6);
    assert.strictEqual(decodedSlice.numVertices, 120);
    assert.strictEqual(decodedSlice.numTriangles, 196);
    assert.strictEqual(decodedSlice.positions.length, 360);
    assert.strictEqual(decodedSlice.indices.length, 588);

    assert.ok(
      Math.abs(decodedSlice.fields.pressure![0]! - syntheticSlice.fields.pressure![0]!) < 1e-5,
      "Decoded pressure field must match synthesized values",
    );
    console.log(`  ✓ In-situ slice compressed to ${binaryChunk.byteLength} bytes with zero disk overhead.`);
  }

  // 4. Test HpcSlurmCfdProvider Co-Simulation Lifecycle
  {
    console.log("4. Testing HpcSlurmCfdProvider co-simulation lifecycle...");
    const jobSpec: CfdSimulationJobSpec = {
      jobId: "drone-aero-01",
      modelName: "QuadcopterBody",
      solver: "icoFoam",
      caseDir: "",
      cluster: {
        endpoint: "slurm-cluster:6820",
        scheduler: "slurm",
        partition: "standard",
        nodes: 2,
        tasksPerNode: 16,
        walltime: "01:00:00",
      },
      decomposition: {
        method: "scotch",
        numberOfSubdomains: 32,
      },
      telemetry: {
        enabled: true,
        sampleIntervalSteps: 1,
        cutPlanes: [
          {
            planeId: "symmetry_y",
            origin: [0, 0, 0],
            normal: [0, 1, 0],
            fields: ["velocityMagnitude", "pressure"],
          },
        ],
      },
    };

    const provider = new HpcSlurmCfdProvider(jobSpec);
    await provider.initialize(0.0, 0.5, 0.01);

    // Step 5 times
    for (let s = 1; s <= 5; s++) {
      await provider.doStep((s - 1) * 0.01, 0.01);
      const outputs = await provider.getOutputs();
      const drag = outputs.get("total_drag_force") as number;
      const maxVel = outputs.get("max_velocity") as number;
      assert.ok(drag > 0, "Drag force must be positive");
      assert.ok(maxVel > 0, "Velocity must be positive");
    }

    const inSituSlice = provider.getInSituSlice();
    assert.ok(inSituSlice !== null, "In-situ slice must be extracted");
    assert.strictEqual(inSituSlice!.step, 5);

    const vtkBuffer = await provider.getVtkBuffer();
    assert.ok(vtkBuffer !== null, "VTK / in-situ buffer must be available");
    assert.ok(vtkBuffer!.length > 0);

    await provider.terminate();
    console.log("  ✓ HpcSlurmCfdProvider co-simulation steps & in-situ telemetry verified.");
  }

  console.log("All HPC Slurm Orchestrator & In-Situ Telemetry tests passed successfully!");
}

main().catch((err) => {
  console.error("Test failed:", err);
  process.exit(1);
});
