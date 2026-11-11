// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert/strict";
import test from "node:test";
import { lintMlxtran, parseMlxtran } from "../src/index.js";

test("MLXTRAN Linter: valid model produces zero diagnostics", () => {
  const model = `
[LONGITUDINAL]
input = {ka, V, Cl}
EQUATION:
ddt_Ad = -ka * Ad
ddt_Ac = ka * Ad - (Cl / V) * Ac
Cc = Ac / V
OUTPUT:
output = {Cc}
`;
  const doc = parseMlxtran(model);
  const diags = lintMlxtran(doc);
  assert.equal(diags.length, 0);
});

test("MLXTRAN Linter: flags missing longitudinal header M9421", () => {
  const bad = `
input = {ka, V, Cl}
EQUATION:
ddt_Ad = -ka * Ad
ddt_Ac = ka * Ad - (Cl / V) * Ac
Cc = Ac / V
OUTPUT:
output = {Cc}
`;
  const doc = parseMlxtran(bad);
  const diags = lintMlxtran(doc);
  assert.ok(diags.some((d) => d.code === 9421));
});

test("MLXTRAN Linter: flags undeclared parameter reference M9422", () => {
  const bad = `
[LONGITUDINAL]
input = {V, Cl}
EQUATION:
ddt_Ac = ka * Ad - (Cl / V) * Ac
Cc = Ac / V
OUTPUT:
output = {Cc}
`;
  const doc = parseMlxtran(bad);
  const diags = lintMlxtran(doc);
  assert.ok(diags.some((d) => d.code === 9422));
});

test("MLXTRAN Linter: flags negative parameter bound M9425 and duplicate equation M9426", () => {
  const bad = `
[LONGITUDINAL]
input = {ka = {min = -5.0}, V, Cl}
EQUATION:
Cc = 1.0
Cc = 2.0
OUTPUT:
output = {Cc}
`;
  const doc = parseMlxtran(bad);
  const diags = lintMlxtran(doc);
  assert.ok(diags.some((d) => d.code === 9425));
  assert.ok(diags.some((d) => d.code === 9426));
});

test("MLXTRAN Linter: flags unbalanced self-transfer M9430", () => {
  const bad = `
[LONGITUDINAL]
input = {ka, V, Cl}
EQUATION:
Cc = 1.0
OUTPUT:
output = {Cc}
PK:
transfer(from=1, to=1, kt=0.5)
`;
  const doc = parseMlxtran(bad);
  const diags = lintMlxtran(doc);
  assert.ok(diags.some((d) => d.code === 9430));
});
