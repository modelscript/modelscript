#!/usr/bin/env npx tsx
// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * FEBio Nonlinear Soft-Tissue Biomechanics & Poroelasticity Benchmark Runner
 *
 * Verifies hyperelastic constitutive models (Mooney-Rivlin), finite element
 * kinematics, biphasic Darcy fluid flow, and DAE lowering against FEBio 4.x standards.
 *
 * Usage:
 *   npx tsx languages/febio/tests/febio-benchmark-runner.ts [options]
 */

import { fileURLToPath } from "node:url";
import path from "node:path";
import { parseFebio } from "../src/parser/index.js";
import { solveHyperelasticMechanics, lowerFebioToDae } from "../src/solver/index.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export async function runFebioBenchmarks(): Promise<void> {
  console.log(`[febio-benchmark-runner] Running FEBio biomechanics & finite deformation benchmarks...`);

  const benchmarks = [
    {
      id: "ArterialMooneyRivlin",
      name: "Nonlinear Mooney-Rivlin Arterial Wall Finite Tensile Extension",
      model: `
        FEBIO 4.0 title="ArterialWallTensile"
        MATERIAL id=1 name="ArterialMedia" type="Mooney-Rivlin" c1=15.0 c2=3.5 k=800.0 perm=0.002 phi0=0.20
        NODE id=1 x=0.0 y=0.0 z=0.0
        NODE id=2 x=1.0 y=0.0 z=0.0
        NODE id=3 x=0.0 y=1.0 z=0.0
        NODE id=4 x=0.0 y=0.0 z=1.0
        ELEMENT id=1 type=tet4 mat=1 nodes=1,2,3,4
        NODESET name="FixedBase" nodes=1,2,3
        NODESET name="TensionApex" nodes=4
        BC id=BC1 node_set="FixedBase" type="fix"
        BC id=BC2 node_set="TensionApex" type="prescribed displacement" dofs=z value=0.30
      `,
    },
    {
      id: "BiphasicCartilageIndentation",
      name: "Biphasic Poroelastic Articular Cartilage Compression & Darcy Flux",
      model: `<?xml version="1.0" encoding="ISO-8859-1"?>
<febio_spec version="4.0">
  <Module type="solid"/>
  <Control>
    <analysis>STATIC</analysis>
    <time_steps>10</time_steps>
    <step_size>0.1</step_size>
  </Control>
  <Material>
    <material id="1" name="ArticularCartilage" type="Mooney-Rivlin">
      <c1>8.5</c1>
      <c2>1.5</c2>
      <k>450.0</k>
      <density>1.12</density>
    </material>
  </Material>
  <Mesh>
    <Nodes name="CartilageNodes">
      <node id="1">0.0, 0.0, 0.0</node>
      <node id="2">1.0, 0.0, 0.0</node>
      <node id="3">0.0, 1.0, 0.0</node>
      <node id="4">0.0, 0.0, 1.0</node>
    </Nodes>
    <Elements type="tet4" name="CartilageLayer">
      <elem id="1">1, 2, 3, 4</elem>
    </Elements>
    <NodeSet name="SubchondralBone">
      <node id="1"/>
      <node id="2"/>
      <node id="3"/>
    </NodeSet>
    <NodeSet name="ContactSurface">
      <node id="4"/>
    </NodeSet>
  </Mesh>
  <MeshDomains>
    <SolidDomain name="CartilageLayer" mat="1"/>
  </MeshDomains>
  <Boundary>
    <bc name="FixSubchondral" type="zero displacement" node_set="SubchondralBone">
      <x_dof>1</x_dof>
      <y_dof>1</y_dof>
      <z_dof>1</z_dof>
    </bc>
    <bc name="CompressIndenter" type="prescribed displacement" node_set="ContactSurface">
      <dof>z</dof>
      <value>-0.15</value>
    </bc>
  </Boundary>
</febio_spec>`,
    },
  ];

  let passed = true;
  for (const b of benchmarks) {
    const doc = parseFebio(b.model);
    const res = solveHyperelasticMechanics(doc);
    const arena = lowerFebioToDae(doc);

    const okVol = res.totalVolume > 0 && res.invertedElementCount === 0;
    const okStress = res.materials.every((m) => m.strainEnergyDensityW > 0 && m.vonMisesStress > 0);
    const okDae = arena.getVarCount() > 0 && arena.getEqCount() > 0;

    console.log(
      `  [${okVol && okStress && okDae ? "PASS" : "FAIL"}] ${b.id}: ${b.name} (W: ${res.materials[0]?.strainEnergyDensityW.toFixed(2)} J/m^3, vmStress: ${res.materials[0]?.vonMisesStress.toFixed(2)} kPa, DAE eq/var: ${arena.getEqCount()})`,
    );

    if (!okVol || !okStress || !okDae) passed = false;
  }

  if (!passed) process.exit(1);
}

if (process.argv[1] === __filename) {
  runFebioBenchmarks();
}
