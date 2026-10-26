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
    v === "3d-model"
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
  if (
    v === "pscad" ||
    v === "pscx" ||
    v === "pslx" ||
    v === "psse" ||
    v === "raw" ||
    v === "easy5" ||
    v === "rocets" ||
    v === "lps" ||
    v === "sima" ||
    v === "gtsuite" ||
    v === "aspen" ||
    v === "swmm" ||
    v === "touchstone" ||
    v === "ibis" ||
    v === "opendss" ||
    v === "openscenario" ||
    v === "relap5" ||
    v === "eclipse" ||
    v === "sbml" ||
    v === "jsbsim"
  ) {
    return "plot";
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
  }

  let resolvedThumbnailUrlLight = viewConfig?.thumbnailUrlLight;
  if (resolvedThumbnailUrlLight && resolvedThumbnailUrlLight.startsWith("/thumbnails/")) {
    resolvedThumbnailUrlLight = `/api${resolvedThumbnailUrlLight}`;
  }

  let resolvedThumbnailUrlDark = viewConfig?.thumbnailUrlDark;
  if (resolvedThumbnailUrlDark && resolvedThumbnailUrlDark.startsWith("/thumbnails/")) {
    resolvedThumbnailUrlDark = `/api${resolvedThumbnailUrlDark}`;
  }

  return {
    resolvedThumbnailUrl,
    resolvedThumbnailUrlLight,
    resolvedThumbnailUrlDark,
  };
}
