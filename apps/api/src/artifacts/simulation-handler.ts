// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Simulation Result Artifact Handler
 *
 * Handles FEA (Finite Element Analysis) and CFD (Computational Fluid Dynamics)
 * result files. Supports VTK XML formats (.vtu, .vtp, .vtk).
 *
 * At publish time, extracts mesh statistics and field metadata.
 * For web viewing, provides a viewer descriptor that maps to
 * the SimulationResultViewer frontend component.
 */

import type { ArtifactHandler, ArtifactMetadata, ArtifactViewDescriptor } from "./registry.js";

export interface SimulationFieldMeta {
  name: string;
  association: "point" | "cell";
  numComponents: number;
  range: [number, number];
  unit?: string;
}

export interface SimulationDetails {
  format: string;
  meshType?: string;
  numPoints?: number;
  numCells?: number;
  bounds?: [number, number, number, number, number, number];
  fields?: SimulationFieldMeta[];
  solverInfo?: {
    name: string;
    version?: string;
  };
}

export class SimulationArtifactHandler implements ArtifactHandler {
  readonly type = "simulation";
  readonly displayName = "Simulation Results (FEA/CFD)";
  readonly extensions = [".vtu", ".vtp", ".vtk"];

  async extractMetadata(_fileBuffer: Buffer, filePath: string): Promise<ArtifactMetadata | null> {
    // Basic metadata from file extension
    const ext = filePath.substring(filePath.lastIndexOf(".")).toLowerCase();
    const formatMap: Record<string, string> = {
      ".vtu": "VTK XML Unstructured Grid",
      ".vtp": "VTK XML PolyData",
      ".vtk": "VTK Legacy",
    };

    return {
      type: this.type,
      path: filePath,
      description: `Simulation result (${formatMap[ext] || "VTK"})`,
      details: { format: ext } as Record<string, unknown>,
    };
  }

  validate(artifact: Record<string, unknown>): string[] {
    const errors: string[] = [];
    if (!artifact.path) errors.push("Missing artifact path");
    return errors;
  }

  getViewDescriptor(metadata: ArtifactMetadata): ArtifactViewDescriptor | null {
    return {
      viewer: "simulation-result",
      label: "3D Results Viewer",
      icon: "flame",
      config: { ...metadata.details },
    };
  }
}
