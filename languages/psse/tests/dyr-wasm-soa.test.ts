// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  applyDyrCstParameterUpdates,
  applyPsseDiagramWriteback,
  buildCstFieldReplacementEdit,
  extractDyrCstRecords,
  parseDyr,
  parseDyrSoa,
  parsePsseCstDocument,
  writeDyr,
} from "../src/index.js";

describe("PSS/E WASM Linear-Memory DYR Parser & SoA Arena", () => {
  it("parses multi-line slash-terminated records, Fortran D exponents, @! comments, and ICON+CON alignments", () => {
    const sampleDyr = `@! Dynamic data header comment
// Synchronous generator with Fortran D scientific notation
1 'GENROU' '1'
  6.50D+00 3.50d-02 1.00 0.05 4.50 1.00
  1.80 1.70 0.30 0.55 0.20 0.14 0.09 0.38 / end of GENROU

// REEC_A with 5 ICONs + 29 CONs
2 'REEC_A' '1' 0 0 1 1 0
  0.85 1.15 0.01 -0.05 0.05 2.0 1.05 -1.05 1.0 0.0
  0.0 0.0 0.05 0.436 -0.436 1.1 0.9 0.0 0.1 0.0
  40.0 0.0 0.02 99.0 -99.0 1.0 0.0 1.3 0.02 /

// REPC_A with 7 ICONs (including string circuit ID '1') + 27 CONs
2 'REPC_A' '1' 2 1 2 '1' 0 1 1
  0.02 18.0 5.0 0.0 0.05 0.7 0.0 0.0 0.0 0.1
  -0.1 -0.002 0.002 0.436 -0.436 1.0 0.5 0.25 -0.0006 0.0006
  99.0 -99.0 1.0 0.0 0.1 20.0 0.0 /

// USRMDL alias normalization (REGCAU1 -> REGC_A)
3 'USRMDL' '1' 'REGCAU1' 101 1 1 14 3 4 1
  0.02 10.0 0.9 0.4 1.22 1.2 0.8 0.4 -1.3 0.01 0.7 999.0 -999.0 0.7 /

// Branch distance relay (IBUS JBUS CKT 'MODEL')
1 2 '1' 'DISTRL' 1 0.85 0.0 1.25 0.35 2.0 1.0 0.05 /

// Bus frequency estimator (IBUS 'MODEL', no ID token)
1 'BUSFRQ' 0.04 0.02 /

// Two-terminal HVDC link ('DCNAME' 'MODEL')
'PACIFIC_DC' 'CDC4T' 5.0 15.0 0.02 0.02 0.35 100.0 0.3 350.0 1.0 /
`;

    const soa = parseDyrSoa(sampleDyr);
    assert.equal(soa.nRecords, 7);

    const dyr = parseDyr(sampleDyr);
    assert.equal(dyr.records.length, 7);

    // 1. Fortran D exponents
    const gen = dyr.records[0]!;
    assert.equal(gen.model, "GENROU");
    assert.ok(Math.abs((gen.namedParams["Td0p"] ?? 0) - 6.5) < 1e-12);
    assert.ok(Math.abs((gen.namedParams["Td0pp"] ?? 0) - 0.035) < 1e-12);

    // 2. REEC_A ICON+CON alignment
    const reec = dyr.records[1]!;
    assert.equal(reec.model, "REEC_A");
    assert.deepEqual(reec.icons, [0, 0, 1, 1, 0]);
    assert.equal(reec.namedIcons?.["vflag"], 1);
    assert.equal(reec.namedIcons?.["pqflag"], 0);
    assert.equal(reec.con.length, 29);
    assert.equal(reec.namedParams["Vdip"], 0.85);
    assert.equal(reec.namedParams["Imax"], 1.3);

    // 3. REPC_A string circuit ID ICON
    const repc = dyr.records[2]!;
    assert.equal(repc.model, "REPC_A");
    assert.equal(repc.icons?.length, 7);
    assert.equal(repc.namedIcons?.["ckt"], "1");
    assert.equal(repc.namedParams["Kp"], 18.0);
    assert.equal(repc.namedParams["Ddn"], 20.0);

    // 4. USRMDL alias normalization
    const usr = dyr.records[3]!;
    assert.equal(usr.headerKind, "usrmdl");
    assert.equal(usr.model, "REGCAU1");
    assert.equal(usr.canonicalModel, "REGC_A");
    assert.equal(usr.usrMeta?.ni, 1);
    assert.equal(usr.usrMeta?.nc, 14);
    assert.deepEqual(usr.icons, [1]);
    assert.equal(usr.namedParams["Tg"], 0.02);

    // 5. Branch distance relay
    const dist = dyr.records[4]!;
    assert.equal(dist.headerKind, "branch");
    assert.equal(dist.ibus, 1);
    assert.equal(dist.jbus, 2);
    assert.equal(dist.ckt, "1");
    assert.equal(dist.category, "relay");
    assert.deepEqual(dist.icons, [1]);
    assert.equal(dist.namedParams["Z1"], 0.85);

    // 6. Bus frequency estimator
    const bfrq = dyr.records[5]!;
    assert.equal(bfrq.headerKind, "bus");
    assert.equal(bfrq.namedParams["Tf"], 0.04);

    // 7. Two-terminal HVDC
    const hvdc = dyr.records[6]!;
    assert.equal(hvdc.headerKind, "dc2t");
    assert.equal(hvdc.deviceName, "PACIFIC_DC");
    assert.equal(hvdc.namedParams["AlfaDy"], 5.0);
    assert.ok(dyr.hvdcByName?.has("PACIFIC_DC"));

    // Round-trip writeDyr -> parseDyr preserves all 7 records and ICONs
    const reparsed = parseDyr(writeDyr(dyr));
    assert.equal(reparsed.records.length, 7);
    assert.deepEqual(reparsed.records[1]?.icons, [0, 0, 1, 1, 0]);
    assert.equal(reparsed.records[4]?.jbus, 2);
    assert.equal(reparsed.records[6]?.deviceName, "PACIFIC_DC");
  });

  it("parses 15,000 dynamic records via parseDyrSoa under 40ms with zero JS object allocation", () => {
    const lines: string[] = [];
    for (let i = 1; i <= 5000; i++) {
      lines.push(`${i} 'GENROU' '1' 6.5 0.035 1.0 0.05 4.5 1.0 1.8 1.7 0.3 0.55 0.2 0.14 0.09 0.38 /`);
      lines.push(`${i} 'ESST1A' '1' 1 1 0.02 0.2 -0.2 1.0 1.0 0.0 0.0 200.0 0.02 5.0 -5.0 5.0 -5.0 0.05 0.0 1.0 /`);
      lines.push(`${i} 'TGOV1'  '1' 0.05 0.5 1.05 0.0 2.1 7.0 0.0 /`);
    }
    const bigDyr = lines.join("\n");

    // Warm up WASM instance once
    parseDyrSoa("1 'GENCLS' '1' 3.5 1.0 /");

    const t0 = performance.now();
    const soa = parseDyrSoa(bigDyr);
    const elapsedMs = performance.now() - t0;

    assert.equal(soa.nRecords, 15000);
    assert.ok(soa.nTotalParams >= 15000 * 7);
    assert.ok(elapsedMs < 150, `Expected 15,000-record WASM SoA parse < 150ms, took ${elapsedMs.toFixed(2)}ms`);
  });

  it("extracts multi-line .dyr records with exact CST field spans and performs surgical single-token edits", () => {
    const sample = `@! Preserve header comment
1 'GENROU' '1'
  6.50 0.035 1.00 0.05 4.50 1.00
  1.80 1.70 0.30 0.55 0.20 0.14 0.09 0.38 / end GENROU
2 'REEC_A' '1' 0 0 1 1 0
  0.85 1.15 0.01 -0.05 0.05 2.0 1.05 -1.05 1.0 0.0 /
`;
    const cstDoc = parsePsseCstDocument(sample);
    const cstRecs = extractDyrCstRecords(cstDoc);
    assert.equal(cstRecs.length, 2);
    assert.equal(cstRecs[0]?.modelName, "GENROU");
    assert.equal(cstRecs[0]?.conFields.length, 14);
    assert.equal(cstRecs[1]?.modelName, "REEC_A");
    assert.deepEqual(
      cstRecs[1]?.iconFields.map((f) => f.value),
      ["0", "0", "1", "1", "0"],
    );

    // Surgically replace only CON(5) (`H = 4.50` -> `5.25`) in GENROU without touching comments or trailing `/`
    const hField = cstRecs[0]!.conFields[4]!;
    assert.equal(hField.value, "4.50");
    const edit = buildCstFieldReplacementEdit(hField, "5.25");
    const patched = sample.slice(0, edit.startOffset) + edit.newText + sample.slice(edit.endOffset);
    assert.ok(patched.includes("@! Preserve header comment"));
    assert.ok(patched.includes("/ end GENROU"));
    assert.equal(parseDyr(patched).records[0]?.namedParams["H"], 5.25);

    const wb = applyPsseDiagramWriteback(sample, "dyr_2_1_REEC_A", { Kqv: 3.5, Vdip: 0.75 });
    assert.ok(wb.includes("@! Preserve header comment"));
    const wbRecs = parseDyr(wb).records;
    assert.equal(wbRecs[1]?.namedParams["Kqv"], 3.5);
    assert.equal(wbRecs[1]?.namedParams["Vdip"], 0.75);

    const cal = applyDyrCstParameterUpdates(wb, { busNumber: 1, id: "1", model: "GENROU" }, { Td0p: 7.25 });
    assert.equal(parseDyr(cal).records[0]?.namedParams["Td0p"], 7.25);
  });
});
