// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { asn1ToDae } from "../src/dae/asn1-to-dae.js";
import { asn1ToC, asn1ToJsonSchema, asn1ToSdl } from "../src/projections/index.js";

const SAMPLE_SCHEMA = `
GooseMini DEFINITIONS IMPLICIT TAGS ::= BEGIN

GooseHeader ::= SEQUENCE {
  gocbRef VisibleString (SIZE (1..64)),
  timeAllowedToLive INTEGER (1..65535),
  stNum INTEGER (0..4294967295),
  sqNum INTEGER (0..4294967295),
  simulation BOOLEAN,
  confRev INTEGER (0..65535) OPTIONAL
}

TripStatus ::= ENUMERATED {
  normal(0),
  trip(1),
  fault(2)
}

END
`;

describe("ASN.1 DAE Lowering & Polyglot Projections", () => {
  it("lowers ASN.1 wire-size and bandwidth budget equations directly into DAEBuilder", () => {
    const { builder, lowering } = asn1ToDae(SAMPLE_SCHEMA, { defaultMessageRateHz: 250 });
    assert.equal(lowering.bounds.size, 2);
    assert.ok(lowering.equationCount >= 10);
    assert.ok(lowering.stateVarIndices.length >= 3);
    assert.ok(lowering.variableMap.has("GooseHeader_peak_bw_bps"));
    assert.ok(lowering.variableMap.has("GooseHeader_tx_bytes"));
    assert.ok(lowering.variableMap.has("GooseMini_total_peak_bw_bps"));
    assert.ok(builder.varCount >= 14);
    assert.ok(builder.eqCount >= 10);
  });

  it("projects ASN.1 to ITU-T Z.100 SDL-88 NEWTYPE, C99 structs, and JSON Schema Draft 2020-12", () => {
    const sdl = asn1ToSdl(SAMPLE_SCHEMA);
    assert.ok(sdl.includes("PACKAGE GooseMini;"));
    assert.ok(sdl.includes("NEWTYPE GooseHeader"));
    assert.ok(sdl.includes("STRUCT"));
    assert.ok(sdl.includes("LITERALS normal, trip, fault;"));

    const cCode = asn1ToC(SAMPLE_SCHEMA);
    assert.ok(cCode.includes("#ifndef ASN1_GOOSEMINI_H"));
    assert.ok(cCode.includes("typedef struct GooseHeader"));
    assert.ok(cCode.includes("bool has_confRev;"));
    assert.ok(cCode.includes("typedef enum TripStatus"));

    const js = asn1ToJsonSchema(SAMPLE_SCHEMA) as { $schema: string; $defs: Record<string, unknown> };
    assert.equal(js.$schema, "https://json-schema.org/draft/2020-12/schema");
    assert.ok(js.$defs["GooseHeader"]);
    assert.ok(js.$defs["TripStatus"]);
  });
});
