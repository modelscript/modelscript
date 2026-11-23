// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { renderNetcdfHeatmapSvg } from "../src/diagram/index.js";
import { netcdfIndexing } from "../src/indexing.js";
import { getNetcdfCompletions, getNetcdfDocumentSymbols, getNetcdfHover, validateNetcdf } from "../src/lsp.js";
import { parseCdl } from "../src/parser/index.js";
import { NetcdfPanel } from "../src/ui/NetcdfPanel.js";

const UI_SAMPLE_CDL = `netcdf sst_map {
dimensions:
  time = UNLIMITED ; // (2 currently)
  lat = 3 ;
  lon = 4 ;
variables:
  float lat(lat) ;
    lat:units = "degrees_north" ;
    lat:long_name = "Latitude" ;
  float lon(lon) ;
    lon:units = "degrees_east" ;
    lon:long_name = "Longitude" ;
  float temperature(time, lat, lon) ;
    temperature:units = "K" ;
    temperature:long_name = "Sea Surface Temperature" ;
  :Conventions = "CF-1.8" ;
data:
  lat = -20, 0, 20 ;
  lon = 120, 140, 160, 180 ;
  temperature =
    290, 292, 294, 295,
    296, 298, 299, 297,
    291, 293, 295, 294,
    291, 293, 295, 296,
    297, 299, 300, 298,
    292, 294, 296, 295 ;
}
`;

describe("NetCDF LSP, Indexing, SVG Heatmap Visualizer & React Panel", () => {
  it("provides LSP diagnostics, document symbols, hover, and completions", () => {
    const diags = validateNetcdf(UI_SAMPLE_CDL);
    assert.strictEqual(diags.length, 0);

    const symbols = getNetcdfDocumentSymbols(UI_SAMPLE_CDL);
    assert.strictEqual(symbols.length, 1);
    assert.strictEqual(symbols[0]?.name, "sst_map");
    assert.ok((symbols[0]?.children?.length ?? 0) >= 6);

    // Hover on 'temperature' declaration line (0-indexed line 12)
    const lines = UI_SAMPLE_CDL.split("\n");
    const tempLine = lines.findIndex((l) => l.includes("float temperature"));
    const tempCol = lines[tempLine]!.indexOf("temperature") + 2;
    const hover = getNetcdfHover(UI_SAMPLE_CDL, { line: tempLine, character: tempCol });
    assert.ok(hover, "Should return hover for variable 'temperature'");
    assert.ok(hover.contents.value.includes("temperature"));
    assert.ok(hover.contents.value.includes("Stats:"));

    const completions = getNetcdfCompletions(UI_SAMPLE_CDL, { line: 0, character: 0 });
    assert.ok(completions.some((c) => c.label === "UNLIMITED"));
    assert.ok(completions.some((c) => c.label === "double"));
    assert.ok(completions.some((c) => c.label === "temperature"));
  });

  it("recognizes .cdl/.nc/.cdf files in netcdfIndexing", () => {
    assert.strictEqual(netcdfIndexing.canIndex("file:///atmos.cdl", ""), true);
    assert.strictEqual(netcdfIndexing.canIndex("file:///atmos.nc", ""), true);
    assert.strictEqual(netcdfIndexing.canIndex("file:///unknown.txt", UI_SAMPLE_CDL), true);
    assert.strictEqual(netcdfIndexing.canIndex("file:///other.txt", "hello world"), false);
  });

  it("renders pure SVG 2D heatmap with Viridis colorbar, contours, and 3D slice support", () => {
    const ds = parseCdl(UI_SAMPLE_CDL);
    const svgDark = renderNetcdfHeatmapSvg(ds, { variableName: "temperature", sliceIndex: 1, colorMode: "dark" });
    assert.ok(svgDark.startsWith("<svg"));
    assert.ok(svgDark.endsWith("</svg>"));
    assert.ok(svgDark.includes('data-netcdf-var="temperature"'));
    assert.ok(svgDark.includes("nc-viridis"));
    assert.ok(svgDark.includes("nc-contours"));
    assert.ok(svgDark.includes("[time=1]"));

    const svgLight = renderNetcdfHeatmapSvg(ds, { variableName: "temperature", colorMode: "light" });
    assert.ok(svgLight.includes("#ffffff"));
  });

  it("exports NetcdfPanel React component", () => {
    assert.strictEqual(typeof NetcdfPanel, "function");
  });
});
