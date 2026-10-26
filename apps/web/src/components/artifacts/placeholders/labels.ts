// SPDX-License-Identifier: AGPL-3.0-or-later

export function getBadgeLabel(normType: string): string {
  switch (normType) {
    case "cfd":
    case "cfd-result":
    case "cfd-animation":
      return "CFD · FLUID DYNAMICS";
    case "fea":
    case "fea-result":
      return "FEA · STRUCTURAL TENSOR";
    case "cad":
    case "cad-step":
    case "3d-model":
      return "3D CAD · STEP GEOMETRY";
    case "gcode":
    case "cam":
      return "CAM · G-CODE TOOLPATH";
    case "fmu":
    case "fmi":
      return "FMI · CO-SIMULATION FMU";
    case "sysml":
    case "kerml":
      return "SYSML V2 · ARCHITECTURE";
    case "dataset":
    case "csv":
    case "tsv":
      return "DATASET · TABULAR MATRIX";
    case "plot":
      return "SIMULATION · TIME SERIES";
    case "pdf":
    case "tei-document":
      return "SPECIFICATION · TEI / PDF";
    default:
      return "MODELICA · SIMULATION ARTIFACT";
  }
}
