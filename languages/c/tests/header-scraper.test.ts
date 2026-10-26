// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert/strict";
import test, { describe } from "node:test";
import { bindCHeaderToModelica, scrapeCHeader } from "../src/bridge/index.js";

describe("@modelscript/c Header Scraper & Modelica External Binder Suite", () => {
  test("scrapes function prototypes and struct definitions from C header", () => {
    const header = `
typedef double Real;

struct MotorParams {
  double resistance;
  double inductance;
  double torque_constant;
};

extern double motor_torque(double current, const struct MotorParams* p);
void motor_reset(struct MotorParams* p);
`;

    const scraped = scrapeCHeader(header);
    assert.equal(scraped.functions.length, 2);
    assert.equal(scraped.structs.length, 1);
    assert.equal(scraped.structs[0]!.name, "MotorParams");
    assert.equal(scraped.structs[0]!.fields.length, 3);

    const torqueFn = scraped.functions.find((f) => f.name === "motor_torque");
    assert.ok(torqueFn);
    assert.equal(torqueFn.returnType, "double");
    assert.equal(torqueFn.params.length, 2);
  });

  test("generates valid Modelica external C bindings from C header", () => {
    const header = `
double lowpass_filter(double input, double dt, double tau);
`;
    const moCode = bindCHeaderToModelica(header, "filter.h");

    assert.ok(moCode.includes("function lowpass_filter"));
    assert.ok(moCode.includes("input Real input;"));
    assert.ok(moCode.includes("input Real dt;"));
    assert.ok(moCode.includes("input Real tau;"));
    assert.ok(moCode.includes("output Real y;"));
    assert.ok(moCode.includes('external "C" y = lowpass_filter(input, dt, tau)'));
    assert.ok(moCode.includes('annotation(Include = "#include \\"filter.h\\"");'));
    assert.ok(moCode.includes("end lowpass_filter;"));
  });
});
