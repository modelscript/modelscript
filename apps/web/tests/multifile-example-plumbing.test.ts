// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { amplActionHandlers } from "../../../languages/ampl/src/lsp-actions.js";
import {
  ALL_ANSATZ_LANGUAGES,
  ANSATZ_LANGUAGE_MAP,
  resolveCompanionFileLanguage,
} from "../../../packages/editor/src/workbench/constants.js";

describe("Phase 0 Multi-File Example Plumbing", () => {
  it("resolves shared/ambiguous companion file extensions using active dialect context", () => {
    assert.equal(resolveCompanionFileLanguage("transport.dat", "ampl"), "ampl");
    assert.equal(resolveCompanionFileLanguage("sweep.run", "ampl"), "ampl");
    assert.equal(resolveCompanionFileLanguage("fault.cfg", "comtrade"), "comtrade");
    assert.equal(resolveCompanionFileLanguage("fault.dat", "comtrade"), "comtrade");
    assert.equal(resolveCompanionFileLanguage("EQ.xml", "cgmes"), "cgmes");
    assert.equal(resolveCompanionFileLanguage("TP.xml", "cgmes"), "cgmes");
    assert.equal(resolveCompanionFileLanguage("hh.mod", "nmodl"), "nmodl");
    assert.equal(resolveCompanionFileLanguage("nacl.cif", "iucr-cif"), "iucr-cif");
    assert.equal(resolveCompanionFileLanguage("therm.dat", "chemkin"), "chemkin");
    assert.equal(resolveCompanionFileLanguage("chem.inp", "chemkin"), "chemkin");
    assert.equal(resolveCompanionFileLanguage("ieee9.dyr", "psse"), "psse");
    assert.equal(resolveCompanionFileLanguage("gwf.npf", "modflow"), "modflow");
    assert.equal(resolveCompanionFileLanguage("channel.f01", "hec-ras"), "hec-ras");
    assert.equal(resolveCompanionFileLanguage("materials.mtl", "obj"), "obj");
    assert.equal(resolveCompanionFileLanguage("brdc.nav", "rinex"), "rinex");
    // Cross-language companion files
    assert.equal(resolveCompanionFileLanguage("highway.xodr", "openscenario"), "opendrive");
    assert.equal(resolveCompanionFileLanguage("enzyme.sbml", "sedml"), "sbml");
    assert.equal(resolveCompanionFileLanguage("kb.ttl", "sparql"), "owl2");
    assert.equal(resolveCompanionFileLanguage("data.csv", "nmtran"), "csv");
  });

  it("registers twentysim in ALL_ANSATZ_LANGUAGES and ANSATZ_LANGUAGE_MAP", () => {
    const info = ANSATZ_LANGUAGE_MAP.get("twentysim");
    assert.ok(info, "twentysim must be registered in ANSATZ_LANGUAGE_MAP");
    assert.equal(info.ext, "emx");
    assert.equal(info.supportsDiagram, true);
    assert.equal(info.supportsSimulation, true);
    assert.ok(
      ALL_ANSATZ_LANGUAGES.length >= 170,
      `Expected >= 170 Ansatz Editor languages, got ${ALL_ANSATZ_LANGUAGES.length}`,
    );
  });

  it("solves multi-file AMPL .mod + .dat via amplActionHandlers.ampl_solve with projectFiles", async () => {
    const modCode = `set ORIG;
set DEST;
param supply {ORIG} >= 0;
param demand {DEST} >= 0;
param cost {ORIG, DEST} >= 0;
var Trans {ORIG, DEST} >= 0;
minimize Total_Cost:
  sum {i in ORIG, j in DEST} cost[i,j] * Trans[i,j];
subject to Supply {i in ORIG}:
  sum {j in DEST} Trans[i,j] <= supply[i];
subject to Demand {j in DEST}:
  sum {i in ORIG} Trans[i,j] >= demand[j];
`;
    const datCode = `set ORIG := GARY CLEV PITT;
set DEST := FRA DET LAN;
param supply :=
  GARY 1400
  CLEV 2600
  PITT 2900;
param demand :=
  FRA 900
  DET 1200
  LAN 600;
param cost: FRA DET LAN :=
  GARY 39 14 11
  CLEV 27  9 12
  PITT 24 14 17;
`;
    const solveHandler = amplActionHandlers["ampl_solve"]!;
    const res = (await solveHandler(
      {
        uri: "file:///workspace/transport.mod",
        documentText: modCode,
        projectFiles: { "transport.mod": modCode, "transport.dat": datCode },
      },
      { documentText: modCode },
    )) as { status?: string; objectiveValue?: number };

    assert.ok(res, "ampl_solve should return a result");
    assert.equal(res.status, "OPTIMAL");
    assert.ok(
      typeof res.objectiveValue === "number" && res.objectiveValue > 0,
      `Expected positive optimal objective, got ${res.objectiveValue}`,
    );

    // Also works when invoked while viewing the .dat file!
    const resFromDat = (await solveHandler(
      {
        uri: "file:///workspace/transport.dat",
        documentText: datCode,
        projectFiles: { "transport.mod": modCode, "transport.dat": datCode },
      },
      { documentText: datCode },
    )) as { status?: string; objectiveValue?: number };
    assert.equal(resFromDat.status, "OPTIMAL");
    assert.equal(resFromDat.objectiveValue, res.objectiveValue);
  });
});
