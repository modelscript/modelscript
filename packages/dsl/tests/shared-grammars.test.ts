// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  buildParser,
  createIniDeckLanguage,
  createJsonLanguage,
  createKeyValueBlockLanguage,
  createXmlLanguage,
} from "../src/index.js";

describe("Phase 4: Shared @modelscript/dsl Grammar Families", () => {
  it("compiles createJsonLanguage into AssemblyScript parser files", () => {
    const lang = createJsonLanguage("SharedJsonTest");
    const result = buildParser(lang as Parameters<typeof buildParser>[0]);
    assert.ok(result.assemblyScriptFiles.length > 0, "Expected generated AssemblyScript parser files");
    assert.equal(lang.name, "SharedJsonTest");
  });

  it("compiles createXmlLanguage into AssemblyScript parser files", () => {
    const lang = createXmlLanguage("SharedXmlTest");
    const result = buildParser(lang as Parameters<typeof buildParser>[0]);
    assert.ok(result.assemblyScriptFiles.length > 0, "Expected generated AssemblyScript parser files");
    assert.equal(lang.name, "SharedXmlTest");
  });

  it("compiles createIniDeckLanguage into AssemblyScript parser files", () => {
    const lang = createIniDeckLanguage("SharedIniTest");
    const result = buildParser(lang as Parameters<typeof buildParser>[0]);
    assert.ok(result.assemblyScriptFiles.length > 0, "Expected generated AssemblyScript parser files");
    assert.equal(lang.name, "SharedIniTest");
  });

  it("compiles createKeyValueBlockLanguage into AssemblyScript parser files", () => {
    const lang = createKeyValueBlockLanguage("SharedKvBlockTest");
    const result = buildParser(lang as Parameters<typeof buildParser>[0]);
    assert.ok(result.assemblyScriptFiles.length > 0, "Expected generated AssemblyScript parser files");
    assert.equal(lang.name, "SharedKvBlockTest");
  });
});
