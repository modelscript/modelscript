// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert/strict";
import test from "node:test";
import { BnglErrorCode, lintBngl, parseBngl } from "../src/index.js";

test("BNGL Linter: reports undeclared molecule type (M9051)", () => {
  const doc = parseBngl(`
    begin model
    begin molecule types
      A(x)
    end molecule types
    begin seed species
      A(x) 10
      UnknownMol(y) 5
    end seed species
    end model
  `);
  const diags = lintBngl(doc);
  assert.ok(diags.some((d) => d.code === BnglErrorCode.UNDECLARED_MOLECULE_TYPE.code));
});

test("BNGL Linter: reports undeclared component site (M9052)", () => {
  const doc = parseBngl(`
    begin model
    begin molecule types
      M(validSite)
    end molecule types
    begin seed species
      M(invalidSite) 10
    end seed species
    end model
  `);
  const diags = lintBngl(doc);
  assert.ok(diags.some((d) => d.code === BnglErrorCode.UNDECLARED_COMPONENT_SITE.code));
});

test("BNGL Linter: reports invalid internal state (M9053)", () => {
  const doc = parseBngl(`
    begin model
    begin molecule types
      M(site~0~1)
    end molecule types
    begin seed species
      M(site~invalidState) 10
    end seed species
    end model
  `);
  const diags = lintBngl(doc);
  assert.ok(diags.some((d) => d.code === BnglErrorCode.INVALID_INTERNAL_STATE.code));
});

test("BNGL Linter: reports dangling bond label (M9054)", () => {
  const doc = parseBngl(`
    begin model
    begin molecule types
      A(x)
      B(y)
    end molecule types
    begin seed species
      A(x!1).B(y) 10
    end seed species
    end model
  `);
  const diags = lintBngl(doc);
  assert.ok(diags.some((d) => d.code === BnglErrorCode.DANGLING_BOND_LABEL.code));
});

test("BNGL Linter: reports undefined rate parameter (M9055)", () => {
  const doc = parseBngl(`
    begin model
    begin molecule types
      A(x)
      B(y)
    end molecule types
    begin seed species
      A(x) 10
      B(y) 10
    end seed species
    begin reaction rules
      R1: A(x) + B(y) -> A(x!1).B(y!1) k_undefined
    end reaction rules
    end model
  `);
  const diags = lintBngl(doc);
  assert.ok(diags.some((d) => d.code === BnglErrorCode.UNDEFINED_RATE_PARAMETER.code));
});
