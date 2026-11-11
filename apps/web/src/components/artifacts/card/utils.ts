// SPDX-License-Identifier: AGPL-3.0-or-later

import type { PlaceholderType } from "./types";

export function resolvePlaceholder(vt?: string): PlaceholderType {
  if (!vt) return "generic";
  const v = vt.toLowerCase();
  if (v === "cfd" || v === "cfd-result" || v === "cfd-animation") return "cfd";
  if (v === "fea" || v === "fea-result") return "fea";
  if (
    v === "cad" ||
    v === "cad-step" ||
    v === "cad_step" ||
    v === "cad-3d-viewer" ||
    v === "step" ||
    v === "stp" ||
    v === "3d-model" ||
    v === "qif" ||
    v === "urdf" ||
    v === "sdf" ||
    v === "xacro"
  ) {
    return "cad";
  }
  if (v === "gcode" || v === "cam-result" || v === "cam") return "gcode";
  if (v === "fmu" || v === "fmi" || v === "fmu-package" || v === "fmu-simulator" || v === "ssp" || v === "ssd") {
    return "fmu";
  }
  if (v === "sysml" || v === "sysml2" || v === "sysml-architecture-viewer" || v === "kerml") {
    return "sysml";
  }
  if (v === "dataset" || v === "dataset-table" || v === "csv" || v === "tsv" || v === "json-table") {
    return "dataset";
  }
  if (v === "simulation-plot" || v === "vega" || v === "vega-plot" || v === "psout") {
    return "plot";
  }
  if (v === "pscad" || v === "pscx" || v === "pslx" || v === "spice" || v === "ibis" || v === "circuit") {
    return "circuit";
  }
  if (v === "psse" || v === "raw" || v === "opendss" || v === "grid" || v === "powerflow") {
    return "network";
  }
  if (
    v === "swmm" ||
    v === "epanet" ||
    v === "lps" ||
    v === "olga" ||
    v === "relap5" ||
    v === "eclipse" ||
    v === "rocets" ||
    v === "hydraulic" ||
    v === "piping"
  ) {
    return "hydraulic";
  }
  if (
    v === "easy5" ||
    v === "sima" ||
    v === "gtsuite" ||
    v === "gensys" ||
    v === "simpack" ||
    v === "spck" ||
    v === "sim" ||
    v === "aspen" ||
    v === "touchstone" ||
    v === "openscenario" ||
    v === "sbml" ||
    v === "jsbsim" ||
    v === "schematic"
  ) {
    return "schematic";
  }
  if (v === "fea-deck" || v === "fea-inp") return "fea";
  if (v === "cfd-config" || v === "cfd-su2") return "cfd";
  if (v === "pdf" || v === "tei-document") return "pdf";
  return "generic";
}

/**
 * Maps any artifact view_type, dialect, or file format to a standardized, concise uppercase badge.
 * Examples: 'csv' -> 'CSV', 'cad-step' -> 'STEP', 'modelica-code' -> 'MODELICA', 'sysml2' -> 'SYSML'.
 */
export function formatViewType(rawType?: string, viewConfig?: any): string {
  const vt = String(rawType || viewConfig?.view_type || "")
    .trim()
    .toLowerCase();
  const format = String(viewConfig?.format || "")
    .trim()
    .toLowerCase();
  const dialect = String(viewConfig?.dialect || "")
    .trim()
    .toLowerCase();

  if (format === "tsv" || vt === "tsv") return "TSV";
  if (format === "csv" || vt === "csv" || vt === "dataset" || vt === "dataset-table" || vt === "json-table") {
    return "CSV";
  }
  if (
    vt === "cad" ||
    vt === "cad-step" ||
    vt === "cad_step" ||
    vt === "cad-3d-viewer" ||
    vt === "step" ||
    vt === "stp"
  ) {
    return "STEP";
  }
  if (vt === "3d-model" || vt === "usd") return "3D";
  if (vt === "pdf") return "PDF";
  if (vt === "picture" || vt === "image") return "IMAGE";
  if (vt === "video" || vt === "youtube_video") return "VIDEO";
  if (vt === "audio") return "AUDIO";
  if (
    vt === "modelica" ||
    vt === "modelica-code" ||
    vt === "modelica-diagram" ||
    vt === "morsel" ||
    vt === "polyglot-morsel"
  ) {
    if (dialect === "msx" || dialect === "modelscript") return "MODELSCRIPT";
    return "MODELICA";
  }
  if (vt === "modelscript" || vt === "msx") return "MODELSCRIPT";
  if (vt === "sysml" || vt === "sysml2" || vt === "sysml-architecture-viewer" || vt === "kerml") {
    return "SYSML";
  }
  if (vt === "simulation-plot" || vt === "simulation" || vt === "simulation-result") {
    return "SIMULATION";
  }
  if (vt === "fea" || vt === "fea-deck" || vt === "fea-inp" || vt === "fea-result") return "FEA";
  if (vt === "cfd" || vt === "cfd-config" || vt === "cfd-su2" || vt === "cfd-result" || vt === "cfd-animation") {
    return "CFD";
  }
  if (vt === "fmu" || vt === "fmu-package" || vt === "fmu-simulator" || vt === "fmi") return "FMU";
  if (vt === "ssp" || vt === "ssd") return "SSP";
  if (vt === "pscad" || vt === "pscx" || vt === "pslx") return "PSCAD";
  if (vt === "psout" || vt === "waveform" || vt === "comtrade" || vt === "oscillography") {
    return "COMTRADE";
  }
  if (vt === "psse" || vt === "raw" || vt === "powerflow" || vt === "sld") return "PSSE";
  if (vt === "olga" || vt === "opi") return "OLGA";
  if (vt === "easy5" || vt === "ez5") return "EASY5";
  if (vt === "rocets" || vt === "roc") return "ROCETS";
  if (vt === "lps" || vt === "pipelinestudio") return "LPS";
  if (vt === "sima") return "SIMA";
  if (vt === "gtsuite" || vt === "gtm") return "GT-SUITE";
  if (vt === "gensys") return "GENSYS";
  if (vt === "simpack" || vt === "spck" || vt === "mbs") return "SIMPACK";
  if (vt === "urdf" || vt === "sdf" || vt === "xacro") return "URDF";
  if (vt === "qif") return "QIF";
  if (vt === "reqif" || vt === "reqifz") return "REQIF";
  if (vt === "gcode" || vt === "cam-result" || vt === "cam") return "G-CODE";
  if (vt === "owl" || vt === "owl2") return "OWL";
  if (vt === "mermaid" || vt === "mermaid-diagram" || vt === "diagram") return "DIAGRAM";
  if (vt === "vega" || vt === "vega-plot") return "VEGA";
  if (vt === "webgpu" || vt === "webgpu-simulation" || vt === "gpu-simulation") return "WEBGPU";
  if (vt === "tei-document" || vt === "tei") return "TEI";
  if (vt === "digital-thread" || vt === "digital_thread" || vt === "thread-explorer") {
    return "THREAD";
  }
  if (vt === "digital-twin" || vt === "digital-twin-dashboard" || vt === "digital_twin_dashboard") {
    return "TWIN";
  }
  if (vt === "aas-package" || vt === "cyber-physical-system" || vt === "hardware-project") {
    return "AAS";
  }
  if (vt === "package" || vt === "library") return "PACKAGE";
  if (vt === "repository" || vt === "repo") return "REPO";
  if (vt === "solution" || vt === "engineering-app" || vt === "app") return "APP";
  if (vt === "link-preview") return "LINK";
  if (!vt) return "ARTIFACT";
  return vt.replace(/-viewer$|-result$|-code$|-deck$/i, "").toUpperCase();
}

export function resolveThumbnailUrls(viewConfig: any): {
  resolvedThumbnailUrl: string | undefined;
  resolvedThumbnailUrlLight: string | undefined;
  resolvedThumbnailUrlDark: string | undefined;
} {
  let resolvedThumbnailUrl = viewConfig?.thumbnailUrl || viewConfig?.thumbnail_url;
  if (resolvedThumbnailUrl && resolvedThumbnailUrl.startsWith("/thumbnails/")) {
    resolvedThumbnailUrl = `/api${resolvedThumbnailUrl}`;
  } else if (resolvedThumbnailUrl && resolvedThumbnailUrl.startsWith("/uploads/")) {
    resolvedThumbnailUrl = `/api/v1/storage${resolvedThumbnailUrl}`;
  }
  if (resolvedThumbnailUrl && resolvedThumbnailUrl.endsWith(".urdf.thumb.svg")) {
    resolvedThumbnailUrl = `${resolvedThumbnailUrl}?v=3d2`;
  }

  let resolvedThumbnailUrlLight = viewConfig?.thumbnailUrlLight;
  if (resolvedThumbnailUrlLight && resolvedThumbnailUrlLight.startsWith("/thumbnails/")) {
    resolvedThumbnailUrlLight = `/api${resolvedThumbnailUrlLight}`;
  } else if (resolvedThumbnailUrlLight && resolvedThumbnailUrlLight.startsWith("/uploads/")) {
    resolvedThumbnailUrlLight = `/api/v1/storage${resolvedThumbnailUrlLight}`;
  }
  if (resolvedThumbnailUrlLight && resolvedThumbnailUrlLight.endsWith(".urdf.thumb.svg")) {
    resolvedThumbnailUrlLight = `${resolvedThumbnailUrlLight}?v=3d2`;
  }

  let resolvedThumbnailUrlDark = viewConfig?.thumbnailUrlDark;
  if (resolvedThumbnailUrlDark && resolvedThumbnailUrlDark.startsWith("/thumbnails/")) {
    resolvedThumbnailUrlDark = `/api${resolvedThumbnailUrlDark}`;
  } else if (resolvedThumbnailUrlDark && resolvedThumbnailUrlDark.startsWith("/uploads/")) {
    resolvedThumbnailUrlDark = `/api/v1/storage${resolvedThumbnailUrlDark}`;
  }
  if (resolvedThumbnailUrlDark && resolvedThumbnailUrlDark.endsWith(".urdf.thumb.svg")) {
    resolvedThumbnailUrlDark = `${resolvedThumbnailUrlDark}?v=3d2`;
  }

  // If a pre-generated vector SVG is available in viewConfig and the thumbnail is either missing,
  // a stale auto-captured raster snapshot (/thumbnails/artifact_), or a 3D isometric scene (URDF/QIF),
  // prioritize the pristine vector SVG.
  const hasInlineSvg = typeof viewConfig?.svg === "string" && viewConfig.svg.trim().startsWith("<svg");
  const isUrdf3dSvg =
    hasInlineSvg && (viewConfig.svg.includes('data-urdf-3d="true"') || viewConfig.svg.includes("3D FK Pose"));
  const isQif3dSvg =
    hasInlineSvg &&
    (viewConfig.svg.includes('data-qif-3d="true"') || viewConfig.svg.includes('data-testid="qif-3d-svg"'));
  const is3dSceneSvg = isUrdf3dSvg || isQif3dSvg;
  const isStaleRaster = !resolvedThumbnailUrl || resolvedThumbnailUrl.includes("/thumbnails/artifact_");
  if (hasInlineSvg && (isStaleRaster || is3dSceneSvg)) {
    const dataUri = `data:image/svg+xml;utf8,${encodeURIComponent(viewConfig.svg.trim())}`;
    resolvedThumbnailUrl = dataUri;
    resolvedThumbnailUrlLight =
      !is3dSceneSvg && resolvedThumbnailUrlLight && !resolvedThumbnailUrlLight.includes("/thumbnails/artifact_")
        ? resolvedThumbnailUrlLight
        : dataUri;
    resolvedThumbnailUrlDark =
      !is3dSceneSvg && resolvedThumbnailUrlDark && !resolvedThumbnailUrlDark.includes("/thumbnails/artifact_")
        ? resolvedThumbnailUrlDark
        : dataUri;
  }

  return {
    resolvedThumbnailUrl,
    resolvedThumbnailUrlLight,
    resolvedThumbnailUrlDark,
  };
}
