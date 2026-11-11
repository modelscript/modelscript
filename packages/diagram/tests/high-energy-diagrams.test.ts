// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  lintAcceleratorLattice,
  parseMadxLattice,
  propagateTwiss,
  renderAcceleratorLatticeSvg,
  type AcceleratorElement,
  type AcceleratorLatticeData,
  type BeamParameters,
} from "../src/accelerator-lattice-builder.js";
import {
  computeDalitzKinematics,
  computeInvariantMassDistribution,
  lintParticleEvent,
  parseHepEvent,
  renderDalitzPlotSvg,
  type HepEvent,
  type Particle,
} from "../src/hep-event-builder.js";

describe("High-Energy Particle Physics & Accelerator Diagram Builders (Path E)", () => {
  // -------------------------------------------------------------------------
  // 1. Accelerator Lattice & Optics (MAD-X / Twiss)
  // -------------------------------------------------------------------------
  const SAMPLE_MADX = `
TITLE, "ESRF-EBS Synchrotron FODO Cell";
BEAM, PARTICLE=ELECTRON, ENERGY=6.0, EX=1.34E-10, EY=5.0E-12, SIGE=1.0E-3;

QF: QUADRUPOLE, L=0.4, K1=1.25, APER=0.025;
QD: QUADRUPOLE, L=0.4, K1=-1.10, APER=0.025;
B1: SBEND, L=1.8, ANGLE=0.09817, APER=0.025;
D1: DRIFT, L=1.2, APER=0.030;
D2: DRIFT, L=0.8, APER=0.030;
SF: SEXTUPOLE, L=0.2, K2=15.0, APER=0.025;
RF: RFCAVITY, L=0.5, VOLT=1.5, FREQ=352.2;

CELL: LINE=(QF, D1, B1, D2, QD, D1, B1, D2);
`;

  it("parses MAD-X lattice, beam parameters, and elements sequence", () => {
    const data = parseMadxLattice(SAMPLE_MADX);
    assert.strictEqual(data.title, "ESRF-EBS Synchrotron FODO Cell");
    assert.strictEqual(data.beam.particle, "electron");
    assert.strictEqual(data.beam.energyGev, 6.0);
    assert.strictEqual(data.beam.emittanceX, 1.34e-10);
    assert.strictEqual(data.elements.length, 8);

    assert.strictEqual(data.elements[0]!.name, "QF");
    assert.strictEqual(data.elements[0]!.type, "quadrupole");
    assert.strictEqual(data.elements[0]!.k1, 1.25);

    assert.strictEqual(data.elements[2]!.name, "B1");
    assert.strictEqual(data.elements[2]!.type, "sbend");
    assert.strictEqual(data.elements[2]!.angle, 0.09817);

    assert.ok(
      data.totalLength > 7.0 && data.totalLength < 9.5,
      `Total length should be ~8.4m: got ${data.totalLength}`,
    );
    assert.ok(data.twiss.length >= 20, "Should compute fine-grained Twiss points");
    assert.ok(data.tuneX > 0.0 && data.tuneY > 0.0, "Should compute positive betatron tunes");
  });

  it("propagates Twiss parameters, calculates beam envelopes, and renders lattice SVG", () => {
    const beam: BeamParameters = {
      particle: "electron",
      energyGev: 6.0,
      emittanceX: 1.34e-10,
      emittanceY: 5.0e-12,
      deltaP: 1.0e-3,
    };
    const elements: AcceleratorElement[] = [
      { name: "QF", type: "quadrupole", length: 0.5, k1: 1.2, aperture: 0.025 },
      { name: "D1", type: "drift", length: 1.5, aperture: 0.03 },
      { name: "B1", type: "sbend", length: 1.5, angle: 0.05, aperture: 0.025 },
      { name: "QD", type: "quadrupole", length: 0.5, k1: -1.2, aperture: 0.025 },
      { name: "D2", type: "drift", length: 1.5, aperture: 0.03 },
    ];

    const twiss = propagateTwiss(elements, beam, { betaX: 12.0, betaY: 4.0 });
    assert.ok(twiss.length > elements.length);

    // Initial point verification
    assert.strictEqual(twiss[0]!.s, 0.0);
    assert.strictEqual(twiss[0]!.betaX, 12.0);
    assert.strictEqual(twiss[0]!.betaY, 4.0);

    // Last point verification: positive beta functions and finite envelope
    const last = twiss[twiss.length - 1]!;
    assert.ok(last.betaX > 0, "betaX must be positive");
    assert.ok(last.betaY > 0, "betaY must be positive");
    assert.ok(last.envelopeX > 0, "envelopeX must be positive");
    assert.ok(last.envelopeY > 0, "envelopeY must be positive");

    const data: AcceleratorLatticeData = {
      title: "Test Lattice",
      beam,
      elements,
      totalLength: 5.5,
      twiss,
      tuneX: 0.28,
      tuneY: 0.19,
    };

    const svg = renderAcceleratorLatticeSvg(data, {
      width: 900,
      height: 600,
      showEnvelope: true,
      showDispersion: true,
      showMagnets: true,
    });

    assert.ok(svg.includes("<svg"), "Should output valid SVG root");
    assert.ok(svg.includes("Beamline Distance s (m)"), "Should label beamline distance axis");
    assert.ok(svg.includes("QF"), "Should label focusing quadrupole QF");
    assert.ok(svg.includes("QD"), "Should label defocusing quadrupole QD");
    assert.ok(svg.includes("B1"), "Should label dipole bend B1");
    assert.ok(svg.includes("βx"), "Should include beta_x in legend");
    assert.ok(svg.includes("Beam σ (mm)"), "Should label beam envelope axis");
  });

  it("evaluates accelerator optics linter and detects resonance proximity and aperture breach", () => {
    const validData = parseMadxLattice(SAMPLE_MADX);
    const cleanDiags = lintAcceleratorLattice(validData);
    assert.strictEqual(cleanDiags.filter((d) => d.severity === "error").length, 0);

    // Aperture breach: huge emittance
    const bloatedData: AcceleratorLatticeData = {
      ...validData,
      twiss: validData.twiss.map((pt) => ({
        ...pt,
        envelopeX: 45.0, // 45mm envelope inside 25mm aperture!
      })),
    };
    const aperDiags = lintAcceleratorLattice(bloatedData);
    assert.ok(aperDiags.some((d) => d.code === "HEP1003" && d.severity === "warning"));

    // Integer resonance stopband proximity (Qx = 1.005)
    const resonantData: AcceleratorLatticeData = {
      ...validData,
      tuneX: 1.005,
    };
    const resDiags = lintAcceleratorLattice(resonantData);
    assert.ok(resDiags.some((d) => d.code === "HEP1001" && d.severity === "warning"));

    // Non-positive energy
    const badEData: AcceleratorLatticeData = {
      ...validData,
      beam: { ...validData.beam, energyGev: -10 },
    };
    const eDiags = lintAcceleratorLattice(badEData);
    assert.ok(eDiags.some((d) => d.code === "HEP1004" && d.severity === "error"));
  });

  // -------------------------------------------------------------------------
  // 2. High-Energy Collision Events & Dalitz Plot Kinematics
  // -------------------------------------------------------------------------
  const SAMPLE_HEPMC_EVENT = `
E 101 2 4
PROCESS = D0 -> K- pi+ pi0
ENERGY = 3.77
P 1 D0   421  0.0000  0.0000  0.0000  1.8648  1.8648  initial
P 2 K-  -321 -0.4500  0.2500  0.3500  0.7200  0.4937  final
P 3 pi+  211  0.3500 -0.4000  0.1500  0.5800  0.1396  final
P 4 pi0  111  0.1000  0.1500 -0.5000  0.5648  0.1350  final
`;

  it("parses HepMC particle event records and calculates 4-momenta and invariant masses", () => {
    const event = parseHepEvent(SAMPLE_HEPMC_EVENT);
    assert.strictEqual(event.eventId, 101);
    assert.strictEqual(event.process, "D0 -> K- pi+ pi0");
    assert.strictEqual(event.particles.length, 4);

    const d0 = event.particles.find((p) => p.name === "D0")!;
    assert.strictEqual(d0.mass, 1.8648);
    assert.strictEqual(d0.charge, 0);

    const km = event.particles.find((p) => p.name === "K-")!;
    assert.strictEqual(km.charge, -1);
    assert.strictEqual(km.mass, 0.4937);

    const pip = event.particles.find((p) => p.name === "pi+")!;
    assert.strictEqual(pip.charge, +1);
    assert.strictEqual(pip.mass, 0.1396);
  });

  it("computes relativistic 3-body Dalitz phase space kinematics and renders SVG", () => {
    const mother: Particle = {
      id: 1,
      name: "D0",
      pdgId: 421,
      charge: 0,
      px: 0,
      py: 0,
      pz: 0,
      energy: 1.8648,
      mass: 1.8648,
      status: "initial",
    };
    const daughters: [Particle, Particle, Particle] = [
      {
        id: 2,
        name: "K-",
        pdgId: -321,
        charge: -1,
        px: -0.4,
        py: 0.2,
        pz: 0.2,
        energy: 0.7,
        mass: 0.4937,
        status: "final",
      },
      {
        id: 3,
        name: "pi+",
        pdgId: 211,
        charge: +1,
        px: 0.3,
        py: -0.3,
        pz: 0.1,
        energy: 0.6,
        mass: 0.1396,
        status: "final",
      },
      {
        id: 4,
        name: "pi0",
        pdgId: 111,
        charge: 0,
        px: 0.1,
        py: 0.1,
        pz: -0.3,
        energy: 0.5648,
        mass: 0.135,
        status: "final",
      },
    ];

    const dalitz = computeDalitzKinematics(mother, daughters, 100);
    assert.strictEqual(dalitz.motherParticle.name, "D0");
    assert.strictEqual(dalitz.daughters.length, 3);
    assert.ok(dalitz.kinematicBoundary.length >= 80, "Should generate smooth closed kinematic boundary");
    assert.ok(dalitz.events.length > 50, "Should sample phase-space events");
    assert.ok(dalitz.resonanceBands.length >= 2, "Should include intermediate resonance bands");

    // Compute invariant mass distribution
    const m12Values = dalitz.events.map((e) => Math.sqrt(e.m12Sq));
    const hist = computeInvariantMassDistribution(m12Values, 20);
    assert.strictEqual(hist.bins.length, 20);
    assert.ok(hist.peakMass > 0.6 && hist.peakMass < 1.8);

    const svg = renderDalitzPlotSvg(dalitz, hist, {
      width: 900,
      height: 600,
      showResonances: true,
      showBoundary: true,
      showHistogram: true,
    });

    assert.ok(svg.includes("<svg"), "Should output valid SVG root");
    assert.ok(svg.includes("Dalitz Plot: D0 → K- + pi+ + pi0"), "Should include process title");
    assert.ok(svg.includes("Kinematic Boundary"), "Should render kinematic boundary polygon");
    assert.ok(svg.includes("Invariant Mass Projection"), "Should render 1D invariant mass histogram");
    assert.ok(svg.includes("K*(892)-"), "Should label K*(892) resonance band");
  });

  it("evaluates relativistic conservation linter and detects energy and charge violations", () => {
    const event = parseHepEvent(SAMPLE_HEPMC_EVENT);

    // Clean event: momentum and charge are conserved
    const cleanDiags = lintParticleEvent(event);
    assert.strictEqual(cleanDiags.filter((d) => d.severity === "error").length, 0);

    // Four-momentum non-conservation
    const badPEvent: HepEvent = {
      ...event,
      particles: event.particles.map((p) => (p.name === "pi0" ? { ...p, px: 5.0 } : p)), // artificially adds 5 GeV px
      vertices: [
        {
          id: 1,
          incoming: [event.particles[0]!],
          outgoing: [event.particles[1]!, event.particles[2]!, { ...event.particles[3]!, px: 5.0 }],
        },
      ],
    };
    const pDiags = lintParticleEvent(badPEvent);
    assert.ok(pDiags.some((d) => d.code === "HEP2001" && d.severity === "error"));

    // Charge non-conservation: replace pi+ with pi-
    const badQEvent: HepEvent = {
      ...event,
      vertices: [
        {
          id: 1,
          incoming: [event.particles[0]!], // Q = 0
          outgoing: [
            event.particles[1]!, // K- (-1)
            { ...event.particles[2]!, charge: -1 }, // pi- (-1) -> Total -2 != 0
            event.particles[3]!,
          ],
        },
      ],
    };
    const qDiags = lintParticleEvent(badQEvent);
    assert.ok(qDiags.some((d) => d.code === "HEP2002" && d.severity === "error"));

    // Tachyonic particle: E^2 - p^2 < 0
    const tachyonicEvent: HepEvent = {
      ...event,
      particles: [
        {
          id: 5,
          name: "tachyonic_neutrino",
          pdgId: 12,
          charge: 0,
          px: 10.0,
          py: 0.0,
          pz: 0.0,
          energy: 2.0, // E = 2, p = 10 -> E^2 - p^2 = -96 < 0!
          mass: 0.0,
          status: "final",
        },
      ],
      vertices: [],
    };
    const tachDiags = lintParticleEvent(tachyonicEvent);
    assert.ok(tachDiags.some((d) => d.code === "HEP2003" && d.severity === "error"));
  });
});
