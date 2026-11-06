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
    v === "qif"
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

  let resolvedThumbnailUrlLight = viewConfig?.thumbnailUrlLight;
  if (resolvedThumbnailUrlLight && resolvedThumbnailUrlLight.startsWith("/thumbnails/")) {
    resolvedThumbnailUrlLight = `/api${resolvedThumbnailUrlLight}`;
  } else if (resolvedThumbnailUrlLight && resolvedThumbnailUrlLight.startsWith("/uploads/")) {
    resolvedThumbnailUrlLight = `/api/v1/storage${resolvedThumbnailUrlLight}`;
  }

  let resolvedThumbnailUrlDark = viewConfig?.thumbnailUrlDark;
  if (resolvedThumbnailUrlDark && resolvedThumbnailUrlDark.startsWith("/thumbnails/")) {
    resolvedThumbnailUrlDark = `/api${resolvedThumbnailUrlDark}`;
  } else if (resolvedThumbnailUrlDark && resolvedThumbnailUrlDark.startsWith("/uploads/")) {
    resolvedThumbnailUrlDark = `/api/v1/storage${resolvedThumbnailUrlDark}`;
  }

  // If a pre-generated vector SVG is available in viewConfig and the thumbnail is either missing
  // or a stale auto-captured raster snapshot (/thumbnails/artifact_), prioritize the pristine vector SVG.
  const hasInlineSvg = typeof viewConfig?.svg === "string" && viewConfig.svg.trim().startsWith("<svg");
  const isStaleRaster = !resolvedThumbnailUrl || resolvedThumbnailUrl.includes("/thumbnails/artifact_");
  if (hasInlineSvg && isStaleRaster) {
    const dataUri = `data:image/svg+xml;utf8,${encodeURIComponent(viewConfig.svg.trim())}`;
    resolvedThumbnailUrl = dataUri;
    resolvedThumbnailUrlLight =
      resolvedThumbnailUrlLight && !resolvedThumbnailUrlLight.includes("/thumbnails/artifact_")
        ? resolvedThumbnailUrlLight
        : dataUri;
    resolvedThumbnailUrlDark =
      resolvedThumbnailUrlDark && !resolvedThumbnailUrlDark.includes("/thumbnails/artifact_")
        ? resolvedThumbnailUrlDark
        : dataUri;
  }

  return {
    resolvedThumbnailUrl,
    resolvedThumbnailUrlLight,
    resolvedThumbnailUrlDark,
  };
}
