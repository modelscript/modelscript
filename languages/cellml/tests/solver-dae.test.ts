// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { lowerCellmlToDae } from "../src/dae/index.js";
import { lintCellmlDocument } from "../src/lints/index.js";
import { parseCellml } from "../src/parser/index.js";
import { solveCellml } from "../src/solvers/index.js";

export const HODGKIN_HUXLEY_FULL_CELLML = `<?xml version="1.0" encoding="UTF-8"?>
<model name="hodgkin_huxley_squid_axon_1952" xmlns="http://www.cellml.org/cellml/1.0#">
  <component name="environment">
    <variable name="time" units="millisecond" public_interface="out"/>
  </component>

  <component name="membrane">
    <variable name="time" units="millisecond" public_interface="in"/>
    <variable name="V" units="millivolt" initial_value="-65.0" public_interface="out"/>
    <variable name="Cm" units="microfarad_per_cmsq" initial_value="1.0"/>
    <variable name="i_Stim" units="microampere_per_cmsq"/>
    <variable name="i_Na" units="microampere_per_cmsq" public_interface="in"/>
    <variable name="i_K" units="microampere_per_cmsq" public_interface="in"/>
    <variable name="i_L" units="microampere_per_cmsq" public_interface="in"/>
    <math xmlns="http://www.w3.org/1998/Math/MathML">
      <apply>
        <eq/>
        <ci>i_Stim</ci>
        <piecewise>
          <piece>
            <cn>20.0</cn>
            <apply>
              <and/>
              <apply><geq/><ci>time</ci><cn>0.5</cn></apply>
              <apply><leq/><ci>time</ci><cn>1.5</cn></apply>
            </apply>
          </piece>
          <otherwise>
            <cn>0.0</cn>
          </otherwise>
        </piecewise>
      </apply>
      <apply>
        <eq/>
        <apply><diff/><bvar><ci>time</ci></bvar><ci>V</ci></apply>
        <apply>
          <divide/>
          <apply>
            <minus/>
            <ci>i_Stim</ci>
            <apply><plus/><ci>i_Na</ci><ci>i_K</ci><ci>i_L</ci></apply>
          </apply>
          <ci>Cm</ci>
        </apply>
      </apply>
    </math>
  </component>

  <component name="sodium_channel">
    <variable name="time" units="millisecond" public_interface="in"/>
    <variable name="V" units="millivolt" public_interface="in"/>
    <variable name="m" units="dimensionless" initial_value="0.0529"/>
    <variable name="h" units="dimensionless" initial_value="0.5961"/>
    <variable name="alpha_m" units="per_millisecond"/>
    <variable name="beta_m" units="per_millisecond"/>
    <variable name="alpha_h" units="per_millisecond"/>
    <variable name="beta_h" units="per_millisecond"/>
    <variable name="g_Na" units="millisiemens_per_cmsq" initial_value="120.0"/>
    <variable name="E_Na" units="millivolt" initial_value="50.0"/>
    <variable name="i_Na" units="microampere_per_cmsq" public_interface="out"/>
    <math xmlns="http://www.w3.org/1998/Math/MathML">
      <apply>
        <eq/>
        <ci>alpha_m</ci>
        <apply>
          <divide/>
          <apply><times/><cn>0.1</cn><apply><plus/><ci>V</ci><cn>40.0</cn></apply></apply>
          <apply><minus/><cn>1.0</cn><apply><exp/><apply><divide/><apply><minus/><apply><plus/><ci>V</ci><cn>40.0</cn></apply></apply><cn>10.0</cn></apply></apply></apply>
        </apply>
      </apply>
      <apply>
        <eq/>
        <ci>beta_m</ci>
        <apply><times/><cn>4.0</cn><apply><exp/><apply><divide/><apply><minus/><apply><plus/><ci>V</ci><cn>65.0</cn></apply></apply><cn>18.0</cn></apply></apply></apply>
      </apply>
      <apply>
        <eq/>
        <apply><diff/><bvar><ci>time</ci></bvar><ci>m</ci></apply>
        <apply>
          <minus/>
          <apply><times/><ci>alpha_m</ci><apply><minus/><cn>1.0</cn><ci>m</ci></apply></apply>
          <apply><times/><ci>beta_m</ci><ci>m</ci></apply>
        </apply>
      </apply>
      <apply>
        <eq/>
        <ci>alpha_h</ci>
        <apply><times/><cn>0.07</cn><apply><exp/><apply><divide/><apply><minus/><apply><plus/><ci>V</ci><cn>65.0</cn></apply></apply><cn>20.0</cn></apply></apply></apply>
      </apply>
      <apply>
        <eq/>
        <ci>beta_h</ci>
        <apply>
          <divide/>
          <cn>1.0</cn>
          <apply><plus/><cn>1.0</cn><apply><exp/><apply><divide/><apply><minus/><apply><plus/><ci>V</ci><cn>35.0</cn></apply></apply><cn>10.0</cn></apply></apply></apply>
        </apply>
      </apply>
      <apply>
        <eq/>
        <apply><diff/><bvar><ci>time</ci></bvar><ci>h</ci></apply>
        <apply>
          <minus/>
          <apply><times/><ci>alpha_h</ci><apply><minus/><cn>1.0</cn><ci>h</ci></apply></apply>
          <apply><times/><ci>beta_h</ci><ci>h</ci></apply>
        </apply>
      </apply>
      <apply>
        <eq/>
        <ci>i_Na</ci>
        <apply>
          <times/>
          <ci>g_Na</ci>
          <apply><power/><ci>m</ci><cn>3.0</cn></apply>
          <ci>h</ci>
          <apply><minus/><ci>V</ci><ci>E_Na</ci></apply>
        </apply>
      </apply>
    </math>
  </component>

  <component name="potassium_channel">
    <variable name="time" units="millisecond" public_interface="in"/>
    <variable name="V" units="millivolt" public_interface="in"/>
    <variable name="n" units="dimensionless" initial_value="0.3177"/>
    <variable name="alpha_n" units="per_millisecond"/>
    <variable name="beta_n" units="per_millisecond"/>
    <variable name="g_K" units="millisiemens_per_cmsq" initial_value="36.0"/>
    <variable name="E_K" units="millivolt" initial_value="-77.0"/>
    <variable name="i_K" units="microampere_per_cmsq" public_interface="out"/>
    <math xmlns="http://www.w3.org/1998/Math/MathML">
      <apply>
        <eq/>
        <ci>alpha_n</ci>
        <apply>
          <divide/>
          <apply><times/><cn>0.01</cn><apply><plus/><ci>V</ci><cn>55.0</cn></apply></apply>
          <apply><minus/><cn>1.0</cn><apply><exp/><apply><divide/><apply><minus/><apply><plus/><ci>V</ci><cn>55.0</cn></apply></apply><cn>10.0</cn></apply></apply></apply>
        </apply>
      </apply>
      <apply>
        <eq/>
        <ci>beta_n</ci>
        <apply><times/><cn>0.125</cn><apply><exp/><apply><divide/><apply><minus/><apply><plus/><ci>V</ci><cn>65.0</cn></apply></apply><cn>80.0</cn></apply></apply></apply>
      </apply>
      <apply>
        <eq/>
        <apply><diff/><bvar><ci>time</ci></bvar><ci>n</ci></apply>
        <apply>
          <minus/>
          <apply><times/><ci>alpha_n</ci><apply><minus/><cn>1.0</cn><ci>n</ci></apply></apply>
          <apply><times/><ci>beta_n</ci><ci>n</ci></apply>
        </apply>
      </apply>
      <apply>
        <eq/>
        <ci>i_K</ci>
        <apply>
          <times/>
          <ci>g_K</ci>
          <apply><power/><ci>n</ci><cn>4.0</cn></apply>
          <apply><minus/><ci>V</ci><ci>E_K</ci></apply>
        </apply>
      </apply>
    </math>
  </component>

  <component name="leakage_current">
    <variable name="V" units="millivolt" public_interface="in"/>
    <variable name="g_L" units="millisiemens_per_cmsq" initial_value="0.3"/>
    <variable name="E_L" units="millivolt" initial_value="-54.387"/>
    <variable name="i_L" units="microampere_per_cmsq" public_interface="out"/>
    <math xmlns="http://www.w3.org/1998/Math/MathML">
      <apply>
        <eq/>
        <ci>i_L</ci>
        <apply>
          <times/>
          <ci>g_L</ci>
          <apply><minus/><ci>V</ci><ci>E_L</ci></apply>
        </apply>
      </apply>
    </math>
  </component>

  <connection>
    <map_components component_1="environment" component_2="membrane"/>
    <map_variables variable_1="time" variable_2="time"/>
  </connection>
  <connection>
    <map_components component_1="environment" component_2="sodium_channel"/>
    <map_variables variable_1="time" variable_2="time"/>
  </connection>
  <connection>
    <map_components component_1="environment" component_2="potassium_channel"/>
    <map_variables variable_1="time" variable_2="time"/>
  </connection>
  <connection>
    <map_components component_1="membrane" component_2="sodium_channel"/>
    <map_variables variable_1="V" variable_2="V"/>
    <map_variables variable_1="i_Na" variable_2="i_Na"/>
  </connection>
  <connection>
    <map_components component_1="membrane" component_2="potassium_channel"/>
    <map_variables variable_1="V" variable_2="V"/>
    <map_variables variable_1="i_K" variable_2="i_K"/>
  </connection>
  <connection>
    <map_components component_1="membrane" component_2="leakage_current"/>
    <map_variables variable_1="V" variable_2="V"/>
    <map_variables variable_1="i_L" variable_2="i_L"/>
  </connection>
</model>`;

describe("CellML Solver (RK4 / Rush-Larsen) & DAEBuilder Lowering", () => {
  it("simulates Hodgkin-Huxley action potential depolarization and repolarization with RK4 and Rush-Larsen", () => {
    const doc = parseCellml(HODGKIN_HUXLEY_FULL_CELLML);
    const diags = lintCellmlDocument(doc);
    assert.equal(diags.length, 0);

    // 1. RK4 simulation
    const rk4Res = solveCellml(doc, { duration: 6.0, dt: 0.01, method: "rk4" });
    assert.equal(rk4Res.modelName, "hodgkin_huxley_squid_axon_1952");
    assert.equal(rk4Res.stepsCount, 600);
    assert.ok(rk4Res.rushLarsenVariables.includes("sodium_channel.m"));
    assert.ok(rk4Res.rushLarsenVariables.includes("sodium_channel.h"));
    assert.ok(rk4Res.rushLarsenVariables.includes("potassium_channel.n"));

    const vSeriesRk4 = rk4Res.states["membrane.V"]!;
    const maxVRk4 = Math.max(...vSeriesRk4);
    assert.ok(maxVRk4 > 15.0, `Expected action potential peak > +15 mV, got ${maxVRk4}`);

    // 2. Rush-Larsen gating integration
    const rlRes = solveCellml(doc, { duration: 6.0, dt: 0.01, method: "rush-larsen" });
    const vSeriesRl = rlRes.states["membrane.V"]!;
    const maxVRl = Math.max(...vSeriesRl);
    assert.ok(maxVRl > 15.0, `Expected Rush-Larsen action potential peak > +15 mV, got ${maxVRl}`);
    assert.ok(Math.abs(maxVRk4 - maxVRl) < 1.5, `RK4 (${maxVRk4}) and Rush-Larsen (${maxVRl}) peaks should agree`);
  });

  it("lowers multi-compartment CellML model into a structurally square DAEBuilder arena", () => {
    const doc = parseCellml(HODGKIN_HUXLEY_FULL_CELLML);
    const dae = lowerCellmlToDae(doc);

    assert.ok(dae.getVarCount() >= 20, `Expected >= 20 DAE variables, got ${dae.getVarCount()}`);
    assert.equal(
      dae.getVarCount(),
      dae.getEqCount(),
      `Expected square DAE (vars=${dae.getVarCount()}, eqs=${dae.getEqCount()})`,
    );

    assert.notEqual(dae.lookupVariable("membrane_V"), -1);
    assert.notEqual(dae.lookupVariable("sodium_channel_m"), -1);
    assert.notEqual(dae.lookupVariable("sodium_channel_h"), -1);
    assert.notEqual(dae.lookupVariable("potassium_channel_n"), -1);
    assert.notEqual(dae.lookupVariable("leakage_current_i_L"), -1);
  });
});
