// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  appendNmeaChecksum,
  getNmea0183Completions,
  getNmea0183DocumentSymbols,
  getNmea0183Hover,
  nmea0183Indexing,
  renderNmea0183SkyplotSvg,
  renderNmea0183Svg,
  renderNmea0183TrackSvg,
  validateNmea0183,
} from "../src/index.js";
import { Nmea0183Panel } from "../src/ui/Nmea0183Panel.js";

const SAMPLE_NMEA = [
  appendNmeaChecksum("$GPGGA,120000,3723.2475,N,12158.3416,W,1,09,1.0,12.0,M,-30.0,M,,"),
  appendNmeaChecksum("$GPRMC,120005,A,3723.2550,N,12158.3100,W,11.0,082.0,221126,013.5,E"),
  appendNmeaChecksum("$GPGSV,1,1,04,01,45,080,42,07,72,210,45,14,22,315,31,28,12,140,20"),
].join("\n");

describe("@modelscript/nmea0183 LSP, Indexing, SVG Diagram & UI Suite", () => {
  it("provides LSP validation, document symbols, hover, and completions", () => {
    const cleanDiags = validateNmea0183(SAMPLE_NMEA);
    assert.strictEqual(cleanDiags.length, 0);

    const badDiags = validateNmea0183("$GPGGA,120000,3723.2475,N,12158.3416,W,1,09,1.0,12.0,M,-30.0,M,,*00");
    assert.ok(badDiags.some((d) => d.code === "NMEA2001" && d.severity === 1));

    const symbols = getNmea0183DocumentSymbols(SAMPLE_NMEA);
    assert.strictEqual(symbols.length, 3);
    assert.strictEqual(symbols[0]!.name, "$GPGGA");

    const hover = getNmea0183Hover(SAMPLE_NMEA, { line: 0, character: 3 });
    assert.ok(hover);
    assert.ok(hover.contents.value.includes("$GPGGA"));
    assert.ok(hover.contents.value.includes("Global Positioning System"));

    const completions = getNmea0183Completions("GGA");
    assert.ok(completions.some((c) => c.label === "$GPGGA"));
  });

  it("supports UnifiedWorkspace indexing via nmea0183Indexing", () => {
    assert.strictEqual(nmea0183Indexing.canIndex("voyage.nmea", ""), true);
    assert.strictEqual(nmea0183Indexing.canIndex("unknown.txt", SAMPLE_NMEA), true);
    assert.strictEqual(nmea0183Indexing.canIndex("readme.md", "# hello"), false);

    const added: string[] = [];
    let parsedModel: unknown = null;
    nmea0183Indexing.indexFile({
      uri: "voyage.nmea",
      text: SAMPLE_NMEA,
      addSymbol: (name: string) => {
        added.push(name);
        return added.length;
      },
      setParsedModel: (m: unknown) => {
        parsedModel = m;
      },
    } as any);

    assert.ok(parsedModel !== null);
    assert.strictEqual(added.length, 4); // root + 3 sentences
  });

  it("renders pure SVG 2D GPS ground-track, polar satellite skyplot, and combined view", () => {
    const combined = renderNmea0183Svg(SAMPLE_NMEA);
    assert.ok(combined.startsWith("<svg") && combined.endsWith("</svg>"));
    assert.ok(combined.includes("<polyline"));
    assert.ok(combined.includes("GNSS Satellite Skyplot"));
    assert.ok(combined.includes("data-line="));

    const trackOnly = renderNmea0183TrackSvg(SAMPLE_NMEA);
    assert.ok(trackOnly.includes("<polyline"));

    const skyOnly = renderNmea0183SkyplotSvg(SAMPLE_NMEA);
    assert.ok(skyOnly.includes("PRN 1") && skyOnly.includes("PRN 7"));
  });

  it("exports React Nmea0183Panel component", () => {
    assert.strictEqual(typeof Nmea0183Panel, "function");
  });
});
