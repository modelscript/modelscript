// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { lowerNasaCdfToDae } from "../src/dae/index.js";
import { parseCdfSkeleton } from "../src/parser/skt-parser.js";
import { nasaCdfToCcsds, nasaCdfToCsv, nasaCdfToFits } from "../src/projections/index.js";

const TELEMETRY_SKT = `#header
  CDF NAME: mms1_fgm_brst.cdf
  DATA ENCODING: NETWORK
  MAJORITY: ROW_MAJOR
  FORMAT: SINGLE
  VERSION: 3.8.0
#GLOBALattributes
  "Project" 0: CDF_CHAR { "MMS" }
  "Source_name" 0: CDF_CHAR { "MMS1" }
  "Discipline" 0: CDF_CHAR { "Space Physics>Magnetospheric Science" }
  "Data_type" 0: CDF_CHAR { "L2" }
  "Descriptor" 0: CDF_CHAR { "FGM" }
#VARIABLEattributes
  "DEPEND_0"
  "UNITS"
  "VALIDMIN"
  "VALIDMAX"
#variables
  "EPOCH" CDF_EPOCH 1 0:[] T
    [0] = "2025-03-15T12:00:00.000Z"
    [1] = "2025-03-15T12:00:01.000Z"
  .
  "B_GSE" CDF_REAL8 1 1:[3] T T
    "DEPEND_0" CDF_CHAR { "EPOCH" }
    "UNITS" CDF_CHAR { "nT" }
    "VALIDMIN" CDF_REAL8 { -1000.0, -1000.0, -1000.0 }
    "VALIDMAX" CDF_REAL8 { 1000.0, 1000.0, 1000.0 }
    [0] = { 3.0, 4.0, 0.0 }
    [1] = { 3.0, 4.0, 0.0 }
  .
  "N_PROTON" CDF_REAL4 1 0:[] T
    "DEPEND_0" CDF_CHAR { "EPOCH" }
    "UNITS" CDF_CHAR { "cm^-3" }
    "VALIDMIN" CDF_REAL4 { 0.0 }
    "VALIDMAX" CDF_REAL4 { 500.0 }
    [0] = 5.0
    [1] = 5.0
  .
#end
`;

describe("NASA CDF DAE Lowering & Polyglot Projections", () => {
  it("lowers magnetometer & plasma telemetry into a balanced DAEBuilder (varCount === eqCount)", () => {
    const doc = parseCdfSkeleton(TELEMETRY_SKT);
    const dae = lowerNasaCdfToDae(doc);
    assert.ok(dae.getVarCount() >= 12);
    assert.equal(dae.getVarCount(), dae.getEqCount(), "DAE arena must be structurally balanced");
  });

  it("projects CDF telemetry to CSV, FITS 4.0 BINTABLE, and CCSDS TDM KVN", () => {
    const doc = parseCdfSkeleton(TELEMETRY_SKT);

    const csv = nasaCdfToCsv(doc);
    assert.ok(csv.includes("EPOCH,B_GSE_0,B_GSE_1,B_GSE_2,N_PROTON"));
    assert.ok(csv.includes("2025-03-15T12:00:00.000Z,3,4,0,5"));

    const fits = nasaCdfToFits(doc);
    assert.ok(fits.includes("SIMPLE  ="));
    assert.ok(fits.includes("XTENSION= 'BINTABLE'"));
    assert.ok(fits.includes("TTYPE2  = 'B_GSE"));
    assert.ok(fits.includes("TFORM2  = '3D"));

    const ccsds = nasaCdfToCcsds(doc);
    assert.ok(ccsds.includes("CCSDS_TDM_VERS = 2.0"));
    assert.ok(ccsds.includes("ORIGINATOR     = MMS"));
    assert.ok(ccsds.includes("TIME_SYSTEM    = UTC"));
    assert.ok(ccsds.includes("|B|"));
  });
});
