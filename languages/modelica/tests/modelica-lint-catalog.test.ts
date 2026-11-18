// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Catalog consistency guard for Modelica CST lints.
 *
 * CST lints are transpiled to AssemblyScript and therefore cannot import `ModelicaErrorCode`
 * (its message closures cannot be lowered), so `code`/`severity` are duplicated as literals in
 * each `CompilerLint`. This test keeps the two in sync:
 *
 * - every lint code is unique (messages/severities are keyed by code in the generated bindings,
 *   so duplicate codes silently overwrite each other's message),
 * - every lint code is registered in `ModelicaErrorCode`,
 * - lint severity matches the registered severity.
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { ModelicaErrorCode } from "../src/errors.js";
import { allModelicaLints } from "../src/lints/index.js";

interface LintLike {
  code?: number | string;
  severity?: string;
}

const registered = new Map<number, { key: string; severity: string }>();
for (const [key, def] of Object.entries(ModelicaErrorCode)) {
  registered.set(def.code, { key, severity: def.severity });
}

describe("Modelica lint catalog consistency", () => {
  it("assigns a unique code to every CST lint", () => {
    const byCode = new Map<number, string[]>();
    for (const [name, lint] of Object.entries(allModelicaLints)) {
      const code = Number((lint as LintLike).code);
      assert.ok(Number.isFinite(code) && code > 0, `lint '${name}' has no numeric code`);
      byCode.set(code, [...(byCode.get(code) ?? []), name]);
    }
    const dups = [...byCode.entries()].filter(([, names]) => names.length > 1);
    assert.deepEqual(
      dups.map(([code, names]) => `M${code}: ${names.join(", ")}`),
      [],
      "duplicate lint codes overwrite each other's message/severity in the generated bindings",
    );
  });

  it("registers every CST lint code in ModelicaErrorCode with a matching severity", () => {
    const problems: string[] = [];
    for (const [name, lint] of Object.entries(allModelicaLints)) {
      const code = Number((lint as LintLike).code);
      const reg = registered.get(code);
      if (!reg) {
        problems.push(`lint '${name}' uses unregistered code M${code}`);
        continue;
      }
      const sev = (lint as LintLike).severity;
      if (sev !== reg.severity) {
        problems.push(`lint '${name}' (M${code}) severity '${sev}' != ModelicaErrorCode.${reg.key} '${reg.severity}'`);
      }
    }
    assert.deepEqual(problems, []);
  });

  it("does not reuse a code across ModelicaErrorCode entries", () => {
    const seen = new Map<number, string>();
    const dups: string[] = [];
    for (const [key, def] of Object.entries(ModelicaErrorCode)) {
      const prev = seen.get(def.code);
      if (prev) dups.push(`M${def.code}: ${prev}, ${key}`);
      else seen.set(def.code, key);
    }
    assert.deepEqual(dups, []);
  });
});
