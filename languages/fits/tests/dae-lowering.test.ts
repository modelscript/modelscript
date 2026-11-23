// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { lowerFitsToDae } from "../src/dae/index.js";
import { decodeFitsBinary, encodeFitsBinary } from "../src/parser/index.js";
import { fitsToCcsdsMetadata, fitsToCsv, fitsToJsonMetadata, fitsToSvg } from "../src/projections/index.js";

describe("FITS DAE Lowering & Multi-Format Projections", () => {
  const sampleBinary = encodeFitsBinary([
    {
      kind: "PRIMARY",
      bitpix: -32,
      axes: [4, 4],
      bscale: 2.0,
      bzero: 100.0,
      data: [102, 104, 108, 112, 104, 150, 220, 110, 106, 210, 340, 115, 102, 105, 109, 103],
      extraCards: [
        { keyword: "OBJECT", value: "M42_Orion", comment: "Orion Nebula" },
        { keyword: "TELESCOP", value: "JWST", comment: "Observatory" },
        { keyword: "DATE-OBS", value: "2026-06-15T04:30:00.000", comment: "Observation UTC" },
        { keyword: "EXPTIME", value: 120.0, comment: "Exposure time (s)" },
        { keyword: "CTYPE1", value: "RA---TAN" },
        { keyword: "CTYPE2", value: "DEC--TAN" },
        { keyword: "CRVAL1", value: 83.8221 },
        { keyword: "CRVAL2", value: -5.3911 },
        { keyword: "CRPIX1", value: 2.5 },
        { keyword: "CRPIX2", value: 2.5 },
        { keyword: "CD1_1", value: -0.000277778 },
        { keyword: "CD2_2", value: 0.000277778 },
      ],
    },
  ]);

  const doc = decodeFitsBinary(sampleBinary, "file:///m42.fits");

  it("lowers FITS photometry and Beer-Lambert radiative transfer into a balanced DAEBuilder arena", () => {
    const arena = lowerFitsToDae(doc, { kappa: 0.15, emissivity: 0.08, apertureArea: 2.5 });
    const varCount = arena.getVarCount();
    const eqCount = arena.getEqCount();

    assert.ok(varCount >= 14, `Expected >= 14 DAE variables, got ${varCount}`);
    assert.strictEqual(varCount, eqCount, "DAE system must be structurally balanced (varCount === eqCount)");
  });

  it("projects FITS document to CSV with WCS coordinates, JSON metadata, CCSDS KVN, and SVG reticle", () => {
    const csv = fitsToCsv(doc, 0);
    assert.ok(csv.startsWith("x,y,value,ra_deg,dec_deg\n"));
    const csvLines = csv.trim().split("\n");
    assert.strictEqual(csvLines.length, 17); // 1 header + 16 pixels

    const json = fitsToJsonMetadata(doc);
    assert.strictEqual(json.hduCount, 1);
    assert.strictEqual(json.hdus[0]!.wcs?.projection, "TAN");
    assert.deepStrictEqual(json.hdus[0]!.imageShape, [4, 4]);
    assert.ok(json.hdus[0]!.statistics!.max >= 339.9);

    const ccsds = fitsToCcsdsMetadata(doc, 0);
    assert.ok(ccsds.includes("CCSDS_TDM_VERS = 2.0"));
    assert.ok(ccsds.includes("PARTICIPANT_1 = JWST"));
    assert.ok(ccsds.includes("PARTICIPANT_2 = M42_Orion"));
    assert.ok(ccsds.includes("83.822100"));

    const svg = fitsToSvg(doc, 0, 128);
    assert.ok(svg.startsWith("<svg "));
    assert.ok(svg.includes("M42_Orion"));
    assert.ok(svg.includes("TAN"));
    assert.ok(svg.endsWith("</svg>"));
  });
});
