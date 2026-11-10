// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert/strict";
import test from "node:test";
import { lintAntimony, parseAntimony, AntimonyErrorCode } from "../src/index.js";

test("Antimony Linter: detects empty module (M9001) and undefined compartment (M9002)", () => {
  const docEmpty = parseAntimony("model M1() compartment c1 = 1.0; end");
  const diagsEmpty = lintAntimony(docEmpty);
  assert.ok(diagsEmpty.some((d) => d.code === AntimonyErrorCode.EMPTY_ANTIMONY_MODULE.code));

  const docNoComp = parseAntimony("model M2() species S in nonExistent = 1.0; J1: S => P; 0.1 * S; end");
  const diagsNoComp = lintAntimony(docNoComp);
  assert.ok(diagsNoComp.some((d) => d.code === AntimonyErrorCode.UNDEFINED_COMPARTMENT_IN_SPECIES.code));
});

test("Antimony Linter: detects missing rate law (M9003) and negative stoichiometry (M9004)", () => {
  const docNoRate = parseAntimony("model M3() species A = 1.0, B = 0.0; J_bad: A -> B; end");
  const diagsNoRate = lintAntimony(docNoRate);
  assert.ok(diagsNoRate.some((d) => d.code === AntimonyErrorCode.MISSING_REACTION_RATE_LAW.code));

  const docNegStoich = parseAntimony("model M4() species A = 1.0, B = 0.0; J_bad: -1 A -> B; 0.5 * A; end");
  const diagsNegStoich = lintAntimony(docNegStoich);
  assert.ok(diagsNegStoich.some((d) => d.code === AntimonyErrorCode.NEGATIVE_STOICHIOMETRIC_COEFFICIENT.code));
});
