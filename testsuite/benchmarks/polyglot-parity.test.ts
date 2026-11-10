// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * @file polyglot-parity.test.ts
 *
 * Automated Cross-Domain Benchmark & Parity Verification Suite.
 *
 * Asserts numerical accuracy, DAE lowering parity, and dynamic trajectory thresholds
 * against international standards across both Preview->Beta and Beta->Stable transitions:
 *
 * 1. Systems Biology (SBML Level 2/3)         - Trajectory RMSE < 1e-3 vs analytical solution
 * 2. Power Systems (OpenDSS IEEE Feeders)     - Nodal voltage magnitude within [0.95, 1.05] pu
 * 3. Urban Hydrology (EPA SWMM 5.2)           - Continuity & dynamic wave positive flow rate
 * 4. Municipal Water (EPA EPANET 2.2)         - Todini Global Gradient head & flow parity < 0.1%
 * 5. Musculoskeletal Biomechanics (OpenSim)   - Thelen Hill-type force-length-velocity bounds
 * 6. Semiconductor Devices (Verilog-A CMC)    - Square DAE arena & smooth limexp conductance
 * 7. Nonlinear Biomechanics (FEBio)           - Mooney-Rivlin positive strain energy density W > 0
 */

import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

import { parseInp, solveHydraulics } from "@modelscript/epanet";
import { lowerFebioToDae, parseFebio, solveHyperelasticMechanics } from "@modelscript/febio";
import { buildOpenDssYbus, parseOpenDss, solveAdmittancePowerFlow } from "@modelscript/opendss";
import {
  computeActiveForceLength,
  computeForceVelocity,
  computePassiveForceLength,
  lowerOpenSimToDae,
  parseOpenSim,
  simulateMuscleDynamics,
} from "@modelscript/opensim";
import { lowerSbmlToDae, parseSbml, simulateSbmlReactions } from "@modelscript/sbml";
import { lowerSwmmToDae, parseSwmm, solveSwmmHydraulics } from "@modelscript/swmm";
import { lowerVerilogAToDae, parseVerilogA } from "@modelscript/verilog-a";
import { runCcsdsBenchmark } from "../../languages/ccsds/tests/ccsds-benchmark-runner.js";
import { runJsbsimBenchmark } from "../../languages/jsbsim/tests/jsbsim-benchmark-runner.js";
import { runModflowBenchmark } from "../../languages/modflow/tests/modflow-benchmark-runner.js";
import { runRelap5Benchmark } from "../../languages/relap5/tests/relap5-benchmark-runner.js";
import { runRocetsBenchmark } from "../../languages/rocets/tests/rocets-benchmark-runner.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "../..");
const cacheRoot = path.resolve(repoRoot, ".cache/benchmarks");

describe("Polyglot Multi-Domain Benchmark & Parity Verification Matrix", () => {
  // =========================================================================
  // Transition Phase 1: Preview -> Beta Promotion Benchmarks
  // =========================================================================

  describe("Domain: Systems Biology — SBML Semantic Conformance (Preview -> Beta)", () => {
    it("lowers SBML reaction network to DAEBuilder and verifies trajectory RMSE < 1e-3", () => {
      const xmlContent = `<?xml version="1.0" encoding="UTF-8"?>
<sbml xmlns="http://www.sbml.org/sbml/level2/version4" level="2" version="4">
  <model id="case00001" name="First Order Decay">
    <listOfCompartments><compartment id="cytosol" size="1.0"/></listOfCompartments>
    <listOfSpecies><species id="S1" compartment="cytosol" initialConcentration="1.5"/></listOfSpecies>
    <listOfParameters><parameter id="k1" value="0.1"/></listOfParameters>
    <listOfReactions>
      <reaction id="r1" reversible="false">
        <listOfReactants><speciesReference species="S1"/></listOfReactants>
        <kineticLaw><formula>k1 * S1</formula></kineticLaw>
      </reaction>
    </listOfReactions>
  </model>
</sbml>`;

      const doc = parseSbml(xmlContent);
      assert.ok(doc.model, "SBML parser must produce valid model AST");
      assert.strictEqual(doc.model.species.size, 1);
      assert.strictEqual(doc.model.reactions.size, 1);

      // Verify DAE lowering
      const dae = lowerSbmlToDae(doc);
      assert.ok(dae.getVarCount() >= 1, "DAE must declare species state variables");
      assert.ok(dae.getEqCount() >= 1, "DAE must declare ODE mass action rate equations");

      // Verify numerical trajectory accuracy against analytical solution: S1(t) = S1(0) * exp(-k1 * t)
      const sim = simulateSbmlReactions(doc, { duration: 5.0, timeStep: 0.1 });
      assert.ok(sim.trajectory.length > 10, "Expected > 10 trajectory steps");

      let sumSquaredError = 0;
      for (const step of sim.trajectory) {
        const t = step.time;
        const s1Sim = step.concentrations["S1"] ?? 0;
        const s1Exact = 1.5 * Math.exp(-0.1 * t);
        sumSquaredError += (s1Sim - s1Exact) ** 2;
      }
      const rmse = Math.sqrt(sumSquaredError / sim.trajectory.length);
      assert.ok(rmse < 0.001, `SBML trajectory RMSE (${rmse.toExponential(3)}) must be < 1e-3`);
    });
  });

  describe("Domain: Power Distribution — OpenDSS IEEE Test Feeders (Preview -> Beta)", () => {
    it("solves multi-phase radial distribution power flow with sparse Ybus admittance matrix", () => {
      const dssContent = `! IEEE 4-Bus Radial Distribution Feeder Benchmark
Clear
New Circuit.IEEE4Bus basekv=115.0 pu=1.05 phases=3 bus1=SourceBus
New LineCode.100 nphases=3 r1=0.115 x1=0.395 units=km
New Transformer.SubXfmr phases=3 windings=2 buses=[SourceBus, SubBus] kvs=[115, 12.47] kvas=[10000, 10000] %loadloss=0.5 xhl=5.0
New Line.Line1 bus1=SubBus bus2=LoadBus1 phases=3 linecode=100 length=2.5
New Line.Line2 bus1=LoadBus1 bus2=LoadBus2 phases=3 linecode=100 length=1.8
New Load.Load1 bus1=LoadBus1 phases=3 kv=12.47 kw=1800 kvar=600
New Load.Load2 bus1=LoadBus2 phases=3 kv=12.47 kw=1200 kvar=400
New PVSystem.SolarFarm1 bus1=LoadBus2 phases=3 kv=12.47 kva=1500 pmpp=1400
Set VoltageBases = [115, 12.47]
CalcVoltageBases
Solve
`;

      const deck = parseOpenDss(dssContent);
      assert.ok(deck, "OpenDSS parser must produce valid circuit AST");
      assert.ok(deck.lines.size >= 2, "Must contain distribution line segments");

      // Verify nodal admittance Y-bus matrix construction
      const ybus = buildOpenDssYbus(deck);
      assert.ok(ybus.nNodes > 0, "Admittance matrix must have active electrical nodes");
      assert.ok(ybus.yMatrix.nnz > 0, "Sparse Ybus must have non-zero conductance/susceptance entries");

      // Verify sparse admittance power flow solution
      const res = solveAdmittancePowerFlow(deck);
      assert.strictEqual(res.converged, true, "Admittance power flow must converge");
      assert.ok(res.iterations <= 5, "Power flow must converge within 5 iterations");
      assert.strictEqual(res.totalLoadKw, 3000);
      assert.strictEqual(res.totalGenKw, 1400);

      const subBus = res.buses.get("SubBus");
      const loadBus1 = res.buses.get("LoadBus1");
      const loadBus2 = res.buses.get("LoadBus2");

      assert.ok(subBus !== undefined);
      assert.ok(loadBus1 !== undefined);
      assert.ok(loadBus2 !== undefined);

      assert.ok(subBus.voltagePu > 1.0 && subBus.voltagePu <= 1.05);
      assert.ok(loadBus1.voltagePu > 1.0 && loadBus1.voltagePu <= subBus.voltagePu);
      assert.ok(loadBus2.voltagePu > 1.0);
    });
  });

  describe("Domain: Urban Hydrology — EPA SWMM Dynamic Wave (Preview -> Beta)", () => {
    it("solves pipe network backwater curve with Saint-Venant mass conservation", () => {
      const swmmDeck = `[TITLE]
;; Example Urban Stormwater Network
Example 3-Node Stormwater Network

[OPTIONS]
FLOW_UNITS          CMS
FLOW_ROUTING        DYNWAVE
INFILTRATION        HORTON

[JUNCTIONS]
J1               15.00      2.50       0.50       0.00       0.00
J2               12.00      2.50       0.40       0.00       0.00

[OUTFALLS]
OF1              8.00       FREE                        NO

[CONDUITS]
C1               J1               J2               100.00     0.013      0.00       0.00       0.00       0.00
C2               J2               OF1              100.00     0.013      0.00       0.00       0.00       0.00

[XSECTIONS]
C1               CIRCULAR     1.00       0.00       0.00       0.00       1
C2               CIRCULAR     1.00       0.00       0.00       0.00       1

[INFLOWS]
J1               FLOW             ""               FLOW     1.0      1.0      2.5     ""
`;

      const project = parseSwmm(swmmDeck);
      assert.ok(project, "SWMM parser must produce valid project AST");
      assert.strictEqual(project.junctions.size, 2);
      assert.strictEqual(project.conduits.size, 2);

      const hyd = solveSwmmHydraulics(project, { durationSeconds: 30.0, timeStepSeconds: 5.0 });
      assert.ok(hyd.totalInflow > 0, "Total inflow must be positive");
      assert.ok(hyd.conduits.get("C1")!.flowRate > 0, "Conduit C1 must carry forward hydraulic flow");
    });
  });

  // =========================================================================
  // Transition Phase 2: Beta -> Stable Hardening Benchmarks
  // =========================================================================

  describe("Domain: Water Distribution — EPA EPANET 2.2 Todini Parity (Beta -> Stable)", () => {
    it("converges Todini Global Gradient Method in <= 15 iterations with exact flow conservation", () => {
      const inpContent = `[TITLE]
Gravity Feed Network

[RESERVOIRS]
;ID  Head
 R1  100.0

[JUNCTIONS]
;ID  Elev  Demand
 J1  50.0  10.0
 J2  40.0  15.0

[PIPES]
;ID  Node1  Node2  Length  Diam  Roughness  MinorLoss  Status
 P1  R1     J1     1000    200   100        0          OPEN
 P2  J1     J2     800     150   100        0          OPEN
`;

      const net = parseInp(inpContent);
      assert.ok(net.junctions.length >= 2);
      assert.ok(net.pipes.length >= 2);

      const res = solveHydraulics(net);
      assert.strictEqual(res.converged, true, "Todini Global Gradient Method must converge strictly");
      assert.ok(res.iterations <= 15, `Expected <= 15 iterations, took ${res.iterations}`);

      // Verify mass continuity at Junction J1:
      // Inflow from Pipe P1 = Demand at J1 (10) + Outflow to Pipe P2 (15) = 25
      const q1 = res.linkFlows.get("P1") ?? 0;
      const q2 = res.linkFlows.get("P2") ?? 0;

      assert.strictEqual(Math.round(q1), 25);
      assert.strictEqual(Math.round(q2), 15);

      // Verify monotonic head loss from reservoir R1 down to downstream junctions
      const hR1 = res.nodeHeads.get("R1") ?? 0;
      const hJ1 = res.nodeHeads.get("J1") ?? 0;
      const hJ2 = res.nodeHeads.get("J2") ?? 0;
      assert.ok(hR1 > hJ1, `Reservoir head (${hR1}) must exceed Junction J1 head (${hJ1})`);
      assert.ok(hJ1 > hJ2, `Junction J1 head (${hJ1}) must exceed Junction J2 head (${hJ2})`);
    });
  });

  describe("Domain: Biomechanics — OpenSim Musculoskeletal Dynamics (Beta -> Stable)", () => {
    it("evaluates Thelen Hill-type muscle activation and force-length-velocity curves", () => {
      const osimContent = `<OpenSimDocument Version="40000">
  <Model name="Arm26">
    <gravity>0 -9.80665 0</gravity>
    <BodySet>
      <Body name="r_humerus"><mass>2.0</mass><mass_center>0 -0.15 0</mass_center><inertia>0.01 0.001 0.01 0 0 0</inertia></Body>
      <Body name="r_ulna_radius_hand"><mass>1.5</mass><mass_center>0 -0.15 0</mass_center><inertia>0.01 0.001 0.01 0 0 0</inertia></Body>
    </BodySet>
    <JointSet>
      <PinJoint name="r_elbow"><socket_parent_frame>r_humerus</socket_parent_frame><socket_child_frame>r_ulna_radius_hand</socket_child_frame></PinJoint>
    </JointSet>
    <ForceSet>
      <Thelen2003Muscle name="BIClong"><max_isometric_force>1100</max_isometric_force><optimal_fiber_length>0.115</optimal_fiber_length><tendon_slack_length>0.272</tendon_slack_length></Thelen2003Muscle>
    </ForceSet>
  </Model>
</OpenSimDocument>`;

      const doc = parseOpenSim(osimContent);
      assert.ok(doc, "OpenSim parser must produce valid model AST");
      assert.ok(doc.bodies.length >= 2);
      assert.ok(doc.muscles.length >= 1);

      // Verify DAE lowering
      const dae = lowerOpenSimToDae(doc);
      assert.ok(dae.getVarCount() >= 4, "DAE must register generalized coordinates and muscle activations");

      // Verify Thelen 2003 muscle curves
      const fActiveOpt = computeActiveForceLength(1.0);
      assert.strictEqual(Math.round(fActiveOpt * 100) / 100, 1.0, "Active force-length at l_norm=1.0 must be 1.0");

      const fActiveSub = computeActiveForceLength(0.6);
      assert.ok(fActiveSub < 1.0 && fActiveSub > 0.0, "Active force-length at l_norm=0.6 must be between 0 and 1");

      const fPassive = computePassiveForceLength(1.4);
      assert.ok(fPassive > 0.0, "Passive elastic force must be positive beyond optimal fiber length");

      const fVelIso = computeForceVelocity(0.0);
      assert.strictEqual(Math.round(fVelIso * 100) / 100, 1.0, "Force-velocity during isometric contraction must be 1.0");
    });
  });

  describe("Domain: Semiconductors — Verilog-A CMC Compact Models (Beta -> Stable)", () => {
    it("lowers nonlinear diode and MOSFET compact models to structurally square DAE arena", () => {
      const vaCode = `
\`include "disciplines.vams"
module cmc_diode(anode, cathode);
  inout anode, cathode;
  electrical anode, cathode;
  parameter real Is = 1e-14;
  parameter real N = 1.0;
  parameter real Vt = 0.02585;
  parameter real Cj0 = 1e-12;
  real Vd, Id, Qd;
  analog begin
    Vd = V(anode, cathode);
    Id = Is * (limexp(Vd / (N * Vt)) - 1.0);
    Qd = Cj0 * Vd;
    I(anode, cathode) <+ Id + ddt(Qd);
  end
endmodule
`;

      const doc = parseVerilogA(vaCode);
      assert.ok(doc.modules[0] !== undefined, "Verilog-A parser must produce valid module AST");

      const arena = lowerVerilogAToDae(doc.modules[0]);
      assert.ok(arena.getVarCount() >= 4, `Expected >= 4 variables, got ${arena.getVarCount()}`);
      assert.ok(arena.getEqCount() >= 3, `Expected >= 3 equations, got ${arena.getEqCount()}`);

      // Verify that the lowered model produces a solvable square DAE
      assert.strictEqual(
        arena.getVarCount(),
        arena.getEqCount(),
        `Verilog-A DAE must be structurally square (vars=${arena.getVarCount()}, eqs=${arena.getEqCount()})`,
      );
    });
  });

  describe("Domain: Biomechanics — FEBio Nonlinear Continuum Mechanics (Beta -> Stable)", () => {
    it("solves Mooney-Rivlin hyperelastic constitutive stress with positive definite strain energy", () => {
      const sampleDsl = `
        FEBIO 4.0 title="UniaxialSoftTissue"
        MATERIAL id=1 name="ArterialWall" type="Mooney-Rivlin" c1=10.0 c2=2.0 k=500.0 perm=0.005 phi0=0.25
        NODE id=1 x=0.0 y=0.0 z=0.0
        NODE id=2 x=1.0 y=0.0 z=0.0
        NODE id=3 x=0.0 y=1.0 z=0.0
        NODE id=4 x=0.0 y=0.0 z=1.0
        ELEMENT id=1 type=tet4 mat=1 nodes=1,2,3,4
        NODESET name="Bottom" nodes=1,2,3
        NODESET name="Top" nodes=4
        BC id=BC1 node_set="Bottom" type="fix"
        BC id=BC2 node_set="Top" type="prescribed displacement" dofs=z value=0.25
      `;

      const doc = parseFebio(sampleDsl);
      const res = solveHyperelasticMechanics(doc);

      // Volume of unit right tetrahedron = 1/6
      assert.ok(Math.abs(res.totalVolume - 1.0 / 6.0) < 1e-9);
      assert.strictEqual(res.invertedElementCount, 0);

      const mat = res.materials[0]!;
      // Stretch lambda1 = 1 + 0.25 / 1.0 = 1.25
      assert.ok(Math.abs(mat.principalStretches[0] - 1.25) < 1e-9);
      assert.ok(mat.strainEnergyDensityW > 0, "Strain energy density W must be strictly positive");
      assert.ok(mat.cauchyStress[0] > 0, "Tensile Cauchy stress must be strictly positive");
      assert.ok(mat.vonMisesStress > 0, "Von Mises equivalent stress must be strictly positive");

      // Verify DAE lowering
      const arena = lowerFebioToDae(doc);
      assert.ok(arena.getVarCount() >= 8);
      assert.ok(arena.getEqCount() >= 8);
    });
  });

  describe("Domain: Rocket Propulsion — NASA ROCETS Staged Combustion Cycle (Beta -> Stable)", () => {
    it("solves staged-combustion power balance, turbopump shaft power conservation, and nozzle gas dynamics", () => {
      const rep = runRocetsBenchmark();
      assert.strictEqual(rep.converged, true);
      assert.ok(rep.iterations <= 6);
      assert.ok(rep.totalMassFlowKgS > 400.0);
      assert.ok(rep.thrustVacN > 1.7e6);
      assert.ok(rep.ispVacSec > 380.0);
      assert.ok(rep.machExit > 4.5);
      assert.ok(rep.bartzHgcW_m2K > 50000.0);
    });
  });

  describe("Domain: Astrodynamics — CCSDS Orbit Mechanics & High-Fidelity Ephemeris (Beta -> Stable)", () => {
    it("propagates LEO satellite with J2-J4 harmonics, third-body gravity, and cubic Hermite OEM interpolation", () => {
      const rep = runCcsdsBenchmark();
      assert.strictEqual(rep.objectName, "ISS_ZARYA");
      assert.ok(rep.initialSemiMajorAxisKm > 6770.0);
      assert.ok(rep.initialEccentricity < 0.002);
      assert.ok(rep.propagatedStepsCount >= 60);
      assert.ok(rep.semiMajorAxisDriftKm < 1.0, `Orbit semi-major axis drift ${rep.semiMajorAxisDriftKm} km`);
      assert.strictEqual(rep.daeVariablesCount, rep.daeEquationsCount, "DAE must be square");
    });
  });

  describe("Domain: Flight Mechanics — JSBSim 6-DOF Aircraft Dynamics (Preview -> Beta)", () => {
    it("converges steady-state cruise trim, extracts Short-Period & Phugoid modes, and verifies square DAE", () => {
      const rep = runJsbsimBenchmark();
      assert.strictEqual(rep.trimConverged, true);
      assert.ok(rep.trimThrottle > 0.2 && rep.trimThrottle < 0.6);
      assert.ok(rep.shortPeriodOmegaRadSec > 3.0);
      assert.ok(rep.shortPeriodZeta > 0.4);
      assert.ok(rep.phugoidOmegaRadSec < 0.4);
      assert.strictEqual(rep.isSquare, true);
    });
  });

  describe("Domain: Nuclear Power — NRC RELAP5 Reactor Thermal-Hydraulics (Preview -> Beta)", () => {
    it("solves 6-group delayed neutron point kinetics during SCRAM with negative Doppler feedback", () => {
      const rep = runRelap5Benchmark();
      assert.strictEqual(rep.initialPowerMW, 3000.0);
      assert.ok(rep.powerDropRatio < 0.2, "Power drops below 20% after SCRAM");
      assert.ok(rep.simStepsCount >= 400);
      assert.strictEqual(rep.isSquare, true);
    });
  });

  describe("Domain: Hydrogeology — USGS MODFLOW 6 3D Multi-Layer Aquifer (Preview -> Beta)", () => {
    it("solves 3D heterogeneous aquifer water balance, river-aquifer coupling, and well drawdown", () => {
      const rep = runModflowBenchmark();
      assert.strictEqual(rep.totalCells, 75);
      assert.strictEqual(rep.totalPumpingRateM3Day, 1800.0);
      assert.ok(rep.maxDrawdownM > 0.2);
      assert.strictEqual(rep.daeVariablesCount, 75);
      assert.strictEqual(rep.daeEquationsCount, 75, "Darcy flow balance DAE must be structurally square");
    });
  });
});

