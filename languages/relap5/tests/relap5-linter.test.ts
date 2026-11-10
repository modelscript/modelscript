// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert/strict";
import test from "node:test";
import { lintRelap5, parseRelap5 } from "../src/index.js";

test("RELAP5 Linter: detects dangling volume connection and negative form loss (M8601, M8608)", () => {
  const flawedDeck = `100 Flawed Junction Deck
101 new transnt
1000000 Core pipe
1000101 1.0 1.0 1.0
1000501 1.55e7 560.0
1050000 BadJunc snglj
1050101 100 999 1.0
1050102 -0.5 0.2
. end`;

  const deck = parseRelap5(flawedDeck);
  const diags = lintRelap5(deck);

  assert.ok(diags.find((d) => d.code === 8601), "Expected M8601 dangling volume");
  assert.ok(diags.find((d) => d.code === 8608), "Expected M8608 negative form loss");
});

test("RELAP5 Linter: detects negative heat capacity and adverse elevation (M8603, M8607)", () => {
  const flawedDeck = `100 Flawed Deck
101 new transnt
1000000 Core pipe
1000101 1.0 2.0 2.0
1000201 0.0 5.0
1000501 1.55e7 560.0
10100000 5 1
10100101 -15.0 -2.0e6
. end`;

  const deck = parseRelap5(flawedDeck);
  const diags = lintRelap5(deck);

  assert.ok(diags.find((d) => d.code === 8603), "Expected M8603 negative conductivity");
  assert.ok(diags.find((d) => d.code === 8607), "Expected M8607 adverse elevation");
});
