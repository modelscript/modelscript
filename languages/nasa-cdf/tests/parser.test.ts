// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { formatCdfSkeleton, parseCdfSkeleton, parseNasaCdf } from "../src/parser/index.js";

const SAMPLE_SKT = `! THEMIS-A Fluxgate Magnetometer L2 Skeleton Table
#header
  CDF NAME: tha_l2_fgm_20250315.cdf
  DATA ENCODING: NETWORK
  MAJORITY: ROW_MAJOR
  FORMAT: SINGLE
  VERSION: 3.8.0

#GLOBALattributes
  "Project" 0: CDF_CHAR { "THEMIS" }
  "Source_name" 0: CDF_CHAR { "THA>Themis Probe A" }
  "Discipline" 0: CDF_CHAR { "Space Physics>Magnetospheric Science" }
  "Data_type" 0: CDF_CHAR { "L2>Level 2 Science Data" }
  "Descriptor" 0: CDF_CHAR { "FGM>Fluxgate Magnetometer" }

#VARIABLEattributes
  "DEPEND_0"
  "UNITS"
  "VALIDMIN"
  "VALIDMAX"
  "FILLVAL"
  "VAR_TYPE"

#variables
  "EPOCH" CDF_EPOCH 1 0:[] T
    "VAR_TYPE" CDF_CHAR { "support_data" }
    "UNITS" CDF_CHAR { "ms" }
    [0] = "2025-03-15T12:00:00.000Z"
    [1] = "2025-03-15T12:00:01.000Z"
    [2] = "2025-03-15T12:00:02.000Z"
  .
  "B_GSE" CDF_REAL4 1 1:[3] T T
    "DEPEND_0" CDF_CHAR { "EPOCH" }
    "UNITS" CDF_CHAR { "nT" }
    "VALIDMIN" CDF_REAL4 { -65536.0, -65536.0, -65536.0 }
    "VALIDMAX" CDF_REAL4 { 65536.0, 65536.0, 65536.0 }
    "FILLVAL" CDF_REAL4 { -1.0e31 }
    "VAR_TYPE" CDF_CHAR { "data" }
    [0] = { 3.0, 4.0, 0.0 }
    [1] = { 6.0, 8.0, 0.0 }
    [2] = { 0.0, 0.0, 5.0 }
  .
#end
`;

describe("NASA CDF Skeleton Table (.skt) Parser", () => {
  it("parses #header, #GLOBALattributes, #VARIABLEattributes, #variables, and #end", () => {
    const doc = parseCdfSkeleton(SAMPLE_SKT, "tha_l2_fgm.skt");
    assert.equal(doc.isBinary, false);
    assert.equal(doc.formatVersion, "v3");
    assert.equal(doc.hasHeaderSection, true);
    assert.equal(doc.hasEndSection, true);
    assert.equal(doc.header.fileName, "tha_l2_fgm_20250315.cdf");
    assert.equal(doc.header.majority, "ROW_MAJOR");
    assert.equal(doc.header.encoding, "NETWORK");
    assert.equal(doc.header.format, "SINGLE");
    assert.equal(doc.globalAttributes.length, 5);
    assert.equal(doc.variableAttributeNames.length, 6);
    assert.equal(doc.variables.length, 2);
    assert.equal(doc.parseIssues.length, 0);

    const bGse = doc.variables[1]!;
    assert.equal(bGse.name, "B_GSE");
    assert.equal(bGse.dataType, "CDF_REAL4");
    assert.equal(bGse.numDims, 1);
    assert.deepEqual(bGse.dimSizes, [3]);
    assert.equal(bGse.attributes["UNITS"]?.values[0], "nT");
    assert.equal(bGse.values.length, 3);
    assert.deepEqual(bGse.values[0], [3, 4, 0]);
  });

  it("round-trips through formatCdfSkeleton -> parseCdfSkeleton", () => {
    const doc1 = parseCdfSkeleton(SAMPLE_SKT);
    const formatted = formatCdfSkeleton(doc1);
    const doc2 = parseCdfSkeleton(formatted);
    assert.equal(doc2.header.fileName, doc1.header.fileName);
    assert.equal(doc2.header.majority, doc1.header.majority);
    assert.equal(doc2.globalAttributes.length, doc1.globalAttributes.length);
    assert.equal(doc2.variables.length, doc1.variables.length);
    assert.deepEqual(doc2.variables[1]?.values, doc1.variables[1]?.values);
  });

  it("supports COLUMN_MAJOR and unified parseNasaCdf on UTF-8 bytes", () => {
    const colSkt = SAMPLE_SKT.replace("ROW_MAJOR", "COLUMN_MAJOR");
    const doc = parseNasaCdf(new TextEncoder().encode(colSkt));
    assert.equal(doc.header.majority, "COLUMN_MAJOR");
    assert.equal(doc.variables.length, 2);
  });
});
