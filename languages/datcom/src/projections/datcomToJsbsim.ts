// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Projects a USAF Digital DATCOM case and solved aerodynamic tables into JSBSim XML (`<fdm_config>`).
 */

import { solveDatcomCase, type SolveDatcomOptions } from "../solver/aero-solver.js";
import type { DatcomCase } from "../types.js";

function escapeXml(str: string): string {
  return str.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

/**
 * Generates a JSBSim `<fdm_config>` XML flight dynamics model from a Digital DATCOM case.
 */
export function datcomToJsbsim(c: DatcomCase, options?: SolveDatcomOptions): string {
  const aero = solveDatcomCase(c, options);
  const name = escapeXml(c.caseId || "DATCOM_AIRCRAFT");

  const ft2 = aero.SrefM2 / (0.3048 * 0.3048);
  const spanFt = aero.brefM / 0.3048;
  const chordFt = aero.cbarM / 0.3048;
  const cgIn = (aero.cgX / 0.0254).toFixed(2);
  const npIn = (aero.neutralPointX / 0.0254).toFixed(2);
  const weightLbs = (aero.massKg / 0.45359237).toFixed(1);

  const clRows = aero.polar.map((p) => `            ${p.alphaRad.toFixed(4)}  ${p.CL.toFixed(5)}`).join("\n");
  const cdRows = aero.polar.map((p) => `            ${p.alphaRad.toFixed(4)}  ${p.CD.toFixed(5)}`).join("\n");
  const cmRows = aero.polar.map((p) => `            ${p.alphaRad.toFixed(4)}  ${p.Cm.toFixed(5)}`).join("\n");

  return [
    `<?xml version="1.0" encoding="UTF-8"?>`,
    `<fdm_config name="${name}" version="2.0" release="PRODUCTION">`,
    `  <fileheader>`,
    `    <author>ModelScript @modelscript/datcom</author>`,
    `    <description>Generated from Digital DATCOM case ${name} (M=${aero.mach.toFixed(2)})</description>`,
    `  </fileheader>`,
    `  <metrics>`,
    `    <wingarea unit="FT2">${ft2.toFixed(3)}</wingarea>`,
    `    <wingspan unit="FT">${spanFt.toFixed(3)}</wingspan>`,
    `    <chord unit="FT">${chordFt.toFixed(3)}</chord>`,
    `    <location name="AERORP" unit="IN">`,
    `      <x>${npIn}</x><y>0.0</y><z>0.0</z>`,
    `    </location>`,
    `  </metrics>`,
    `  <mass_balance>`,
    `    <emptywt unit="LBS">${weightLbs}</emptywt>`,
    `    <location name="CG" unit="IN">`,
    `      <x>${cgIn}</x><y>0.0</y><z>0.0</z>`,
    `    </location>`,
    `  </mass_balance>`,
    `  <aerodynamics>`,
    `    <axis name="LIFT">`,
    `      <function name="aero/force/Lift_alpha">`,
    `        <product>`,
    `          <property>aero/qbar-psf</property>`,
    `          <property>metrics/Sw-sqft</property>`,
    `          <table>`,
    `            <independentVar lookup="row">aero/alpha-rad</independentVar>`,
    `            <tableData>`,
    clRows,
    `            </tableData>`,
    `          </table>`,
    `        </product>`,
    `      </function>`,
    `    </axis>`,
    `    <axis name="DRAG">`,
    `      <function name="aero/force/Drag_alpha">`,
    `        <product>`,
    `          <property>aero/qbar-psf</property>`,
    `          <property>metrics/Sw-sqft</property>`,
    `          <table>`,
    `            <independentVar lookup="row">aero/alpha-rad</independentVar>`,
    `            <tableData>`,
    cdRows,
    `            </tableData>`,
    `          </table>`,
    `        </product>`,
    `      </function>`,
    `    </axis>`,
    `    <axis name="PITCH">`,
    `      <function name="aero/moment/Pitch_alpha">`,
    `        <product>`,
    `          <property>aero/qbar-psf</property>`,
    `          <property>metrics/Sw-sqft</property>`,
    `          <property>metrics/cbarw-ft</property>`,
    `          <table>`,
    `            <independentVar lookup="row">aero/alpha-rad</independentVar>`,
    `            <tableData>`,
    cmRows,
    `            </tableData>`,
    `          </table>`,
    `        </product>`,
    `      </function>`,
    `      <function name="aero/moment/Pitch_damp">`,
    `        <product>`,
    `          <property>aero/qbar-psf</property>`,
    `          <property>metrics/Sw-sqft</property>`,
    `          <property>metrics/cbarw-ft</property>`,
    `          <property>aero/ci2vel</property>`,
    `          <property>velocities/q-aero-rad_sec</property>`,
    `          <value>${aero.Cmq.toFixed(5)}</value>`,
    `        </product>`,
    `      </function>`,
    `    </axis>`,
    `    <axis name="ROLL">`,
    `      <function name="aero/moment/Roll_damp">`,
    `        <product>`,
    `          <property>aero/qbar-psf</property>`,
    `          <property>metrics/Sw-sqft</property>`,
    `          <property>metrics/bw-ft</property>`,
    `          <property>aero/bi2vel</property>`,
    `          <property>velocities/p-aero-rad_sec</property>`,
    `          <value>${aero.Clp.toFixed(5)}</value>`,
    `        </product>`,
    `      </function>`,
    `    </axis>`,
    `    <axis name="YAW">`,
    `      <function name="aero/moment/Yaw_damp">`,
    `        <product>`,
    `          <property>aero/qbar-psf</property>`,
    `          <property>metrics/Sw-sqft</property>`,
    `          <property>metrics/bw-ft</property>`,
    `          <property>aero/bi2vel</property>`,
    `          <property>velocities/r-aero-rad_sec</property>`,
    `          <value>${aero.Cnr.toFixed(5)}</value>`,
    `        </product>`,
    `      </function>`,
    `    </axis>`,
    `  </aerodynamics>`,
    `</fdm_config>`,
    ``,
  ].join("\n");
}
