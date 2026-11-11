// SPDX-License-Identifier: AGPL-3.0-or-later

import { resolveModelicaBitmapUri } from "@modelscript/modelica/diagram/data";
import assert from "node:assert/strict";
import test from "node:test";
import { getLanguageIconSvg } from "../src/util/language-icons.js";

test("Package Icons & Polyglot Badges Resolution", async (t) => {
  await t.test("getLanguageIconSvg provides distinct icons for polyglot simulation formats", () => {
    const epanetSvg = getLanguageIconSvg("epanet");
    assert.ok(epanetSvg.includes("<svg"), "EPANET svg should be valid svg");
    assert.ok(epanetSvg.includes("H2O") || epanetSvg.includes("#0284c7"), "EPANET svg contains water badge graphics");

    const opendssSvg = getLanguageIconSvg("opendss");
    assert.ok(opendssSvg.includes("<svg"), "OpenDSS svg should be valid svg");

    const psseSvg = getLanguageIconSvg("psse");
    assert.ok(psseSvg.includes("<svg"), "PSSE svg should be valid svg");

    const urdfSvg = getLanguageIconSvg("urdf");
    assert.ok(urdfSvg.includes("<svg"), "URDF svg should be valid svg");

    const spiceSvg = getLanguageIconSvg("spice");
    assert.ok(spiceSvg.includes("<svg"), "SPICE svg should be valid svg");
  });

  await t.test("resolveModelicaBitmapUri resolves modelica:// URIs and already encoded data URIs", () => {
    // Data URI pass-through
    const dataUri =
      "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==";
    assert.equal(resolveModelicaBitmapUri(dataUri), dataUri);

    // OpenIPSL / MSL / Modelica logo resolution
    const resolved =
      resolveModelicaBitmapUri("modelica://Modelica/Resources/Images/Blocks/Sources/Constant.png") ??
      resolveModelicaBitmapUri("modelica://Modelica/assets/icon-light.png") ??
      resolveModelicaBitmapUri("modelica://OpenIPSL/Resources/images/OpenIPSL_Logo.png") ??
      resolveModelicaBitmapUri("modelica://ModelicaReference/Resources/Images/sin.png");
    assert.ok(resolved, "Should resolve Modelica image from package resources");
    assert.ok(resolved.startsWith("data:image/png;base64,"), "Should return base64 encoded PNG data URI");
    assert.ok(resolved.length > 1000, "Base64 data URI should contain image payload");
  });
});
