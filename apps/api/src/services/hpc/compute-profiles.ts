// SPDX-License-Identifier: AGPL-3.0-or-later

import type { ComputeProfile } from "./hpc-types.js";

/**
 * Standard pre-configured compute profiles / node flavors.
 */
export const COMPUTE_PROFILES: Record<string, ComputeProfile> = {
  standard: {
    id: "standard",
    name: "Standard Compute",
    description: "4 CPUs, 16 GB RAM. Ideal for general ODE/DAE models, 2D FEA, and lightweight test runs.",
    partition: "compute",
    cpus: 4,
    memoryMb: 16384,
    tasksPerNode: 1,
    nodes: 1,
    costCreditsPerHour: 10,
  },
  "high-memory": {
    id: "high-memory",
    name: "High Memory",
    description:
      "16 CPUs, 256 GB RAM. Optimized for dense 3D solid FEA meshes, large CAD geometry, and heavy solver memory footprints.",
    partition: "highmem",
    cpus: 16,
    memoryMb: 262144,
    tasksPerNode: 1,
    nodes: 1,
    costCreditsPerHour: 35,
  },
  "gpu-a100": {
    id: "gpu-a100",
    name: "GPU Accelerated (A100)",
    description:
      "8 CPUs, 64 GB RAM, 1x NVIDIA A100 GPU. Designed for neural surrogate training, physics ML, and GPU-accelerated solvers.",
    partition: "gpu",
    cpus: 8,
    memoryMb: 65536,
    gpus: 1,
    gpuType: "a100",
    tasksPerNode: 1,
    nodes: 1,
    costCreditsPerHour: 80,
  },
  "hpc-mpi-64": {
    id: "hpc-mpi-64",
    name: "Distributed Cluster (64 MPI Ranks)",
    description:
      "64 CPUs across 2 nodes (32 tasks/node), 128 GB RAM. Built for multi-node distributed CFD (SU2 / OpenFOAM) over InfiniBand.",
    partition: "mpi",
    cpus: 1,
    tasksPerNode: 32,
    nodes: 2,
    memoryMb: 131072,
    costCreditsPerHour: 150,
  },
};

/**
 * Retrieves a compute profile by ID, falling back to 'standard'.
 */
export function getComputeProfile(id?: string): ComputeProfile {
  if (id && COMPUTE_PROFILES[id]) {
    return COMPUTE_PROFILES[id];
  }
  return COMPUTE_PROFILES["standard"]!;
}

/**
 * Lists all registered compute profiles.
 */
export function listComputeProfiles(): ComputeProfile[] {
  return Object.values(COMPUTE_PROFILES);
}

/**
 * Calculates billed credits from elapsed runtime and the profile's hourly rate.
 */
export function calculateCostCredits(elapsedSeconds: number, profile: ComputeProfile): number {
  if (elapsedSeconds <= 0) return 0;
  const hours = elapsedSeconds / 3600;
  const credits = hours * profile.costCreditsPerHour;
  // Round to 2 decimal places with minimum charge of 0.01 credit
  return Math.max(0.01, Math.round(credits * 100) / 100);
}
