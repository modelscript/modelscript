// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { pregenerateServerSvgThumbnail } from "../src/services/artifact-preprocessor.js";

test("Universal Post Artifact Fallback Pipeline for Fortran and Code Dialects", async (t) => {
  const tmpDir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "artifact-test-")));

  await t.test("Fortran 90 subroutine produces static SVG thumbnail with data-preview-mode='code'", async () => {
    const fortranFile = path.join(tmpDir, "thrust.f90");
    const fortranCode = `subroutine calc_thrust(mass_flow, v_exit, thrust)
  implicit none
  real, intent(in) :: mass_flow, v_exit
  real, intent(out) :: thrust
  thrust = mass_flow * v_exit
end subroutine calc_thrust`;
    fs.writeFileSync(fortranFile, fortranCode, "utf-8");

    const result = await pregenerateServerSvgThumbnail(fortranFile, "fortran", "thrust.f90", tmpDir);

    assert.ok(result.svg, "Must produce a static SVG for Fortran");
    assert.ok(result.svg.includes("<svg"), "Must be a valid SVG string");
    assert.ok(result.svg.includes('data-preview-mode="code"'), "Must have data-preview-mode='code'");
    assert.ok(result.svg.includes("calc_thrust"), "Must detect subroutine name");
    assert.ok(result.svg.includes("FORTRAN 90"), "Must include Fortran 90 badge");
    assert.ok(result.thumbnailUrl, "Must generate a saved thumbnail URL on disk");
  });

  await t.test("C subroutine produces static SVG thumbnail with data-preview-mode='code'", async () => {
    const cFile = path.join(tmpDir, "kernel.c");
    const cCode = `#include <stdio.h>

void compute_forces(const double* pos, double* forces, int n) {
  for (int i = 0; i < n; i++) {
    forces[i] = pos[i] * 9.81;
  }
}`;
    fs.writeFileSync(cFile, cCode, "utf-8");

    const result = await pregenerateServerSvgThumbnail(cFile, "c", "kernel.c", tmpDir);

    assert.ok(result.svg, "Must produce a static SVG for C code");
    assert.ok(result.svg.includes('data-preview-mode="code"'));
    assert.ok(result.svg.includes("kernel"));
  });

  // Cleanup
  fs.rmSync(tmpDir, { recursive: true, force: true });
});
