// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert/strict";
import { test } from "node:test";
import {
  getStdlibById,
  getStdlibCatalog,
  getStdlibsByPack,
  getStdlibsByTier,
  getStdlibsForLanguage,
} from "../src/catalog/index.js";

test("getStdlibCatalog returns valid catalog with libraries", () => {
  const catalog = getStdlibCatalog();
  assert.ok(catalog.version);
  assert.ok(Array.isArray(catalog.libraries));
  assert.ok(catalog.libraries.length >= 10);

  for (const lib of catalog.libraries) {
    assert.ok(lib.id, "Library must have an id");
    assert.ok(lib.language, "Library must have a language");
    assert.ok(lib.packageName, "Library must have a packageName");
    assert.ok(lib.version, "Library must have a version");
    assert.ok(lib.description, "Library must have a description");
    assert.ok(lib.license, "Library must have a license");
    assert.ok(lib.tier, "Library must have a tier");
    assert.ok(lib.domain, "Library must have a domain");
    assert.ok(lib.pack, "Library must have a pack");
    assert.ok(lib.filename.endsWith(".zip"), "Filename should be a zip archive");
  }
});

test("Core libraries exist in catalog", () => {
  const msl = getStdlibById("modelica-msl-4.1.0");
  assert.ok(msl);
  assert.equal(msl.packageName, "Modelica");
  assert.equal(msl.version, "4.1.0");
  assert.equal(msl.tier, "tier1_core");
  assert.equal(msl.pack, "core");

  const sysml = getStdlibById("sysml-v2-2026-03");
  assert.ok(sysml);
  assert.equal(sysml.packageName, "SysML");
  assert.equal(sysml.version, "2026.3.0");
  assert.equal(sysml.tier, "tier1_core");
  assert.equal(sysml.pack, "core");
});

test("getStdlibsForLanguage finds language libraries correctly", () => {
  const modelicaLibs = getStdlibsForLanguage("modelica");
  assert.ok(modelicaLibs.length >= 1);
  assert.equal(modelicaLibs[0]?.packageName, "Modelica");

  const spiceLibs = getStdlibsForLanguage("spice");
  assert.ok(spiceLibs.length >= 1);
  assert.equal(spiceLibs[0]?.packageName, "SPICE-Standard");
});

test("getStdlibsByPack groups correctly", () => {
  const coreLibs = getStdlibsByPack("core");
  assert.ok(coreLibs.length >= 2);
  assert.ok(coreLibs.some((l) => l.packageName === "Modelica"));
  assert.ok(coreLibs.some((l) => l.packageName === "SysML"));

  const powerLibs = getStdlibsByPack("power-energy");
  assert.ok(powerLibs.length >= 2);
  assert.ok(powerLibs.some((l) => l.packageName === "SPICE-Standard"));

  const allLibs = getStdlibsByPack("all");
  assert.equal(allLibs.length, getStdlibCatalog().libraries.length);
});

test("getStdlibsByTier filters core vs domain correctly", () => {
  const tier1 = getStdlibsByTier("tier1_core");
  assert.ok(tier1.length >= 2);
  assert.ok(tier1.every((l) => l.tier === "tier1_core"));

  const tier2 = getStdlibsByTier("tier2_domain");
  assert.ok(tier2.length >= 5);
  assert.ok(tier2.every((l) => l.tier === "tier2_domain"));
});
