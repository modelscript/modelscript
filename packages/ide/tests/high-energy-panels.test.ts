// SPDX-License-Identifier: AGPL-3.0-or-later

import {
  lintAcceleratorLattice,
  parseMadxLattice,
  renderAcceleratorLatticeSvg,
} from "@modelscript/diagram/accelerator-lattice";
import {
  computeDalitzKinematics,
  computeInvariantMassDistribution,
  lintParticleEvent,
  parseHepEvent,
  renderDalitzPlotSvg,
  type Particle,
} from "@modelscript/diagram/hep-event";
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { AcceleratorLatticeEditorProvider, AcceleratorLatticePanel } from "../src/accelerator-lattice-panel.js";
import { HepEventViewerEditorProvider, HepEventViewerPanel } from "../src/hep-event-panel.js";

const SAMPLE_MADX_FIXTURE = `
TITLE, "CERN SPS Extraction Transfer Line";
BEAM, PARTICLE=PROTON, ENERGY=400.0, EX=5.0E-9, EY=2.5E-9, SIGE=1.0E-4;

MQF1: QUADRUPOLE, L=1.5, K1=0.28, APER=0.040;
MQD1: QUADRUPOLE, L=1.5, K1=-0.25, APER=0.040;
MB1:  SBEND,      L=4.0, ANGLE=0.045, APER=0.035;
DRIFT1: DRIFT,    L=2.0, APER=0.045;
DRIFT2: DRIFT,    L=1.5, APER=0.045;

LINE1: LINE=(MQF1, DRIFT1, MB1, DRIFT2, MQD1, DRIFT1, MB1, DRIFT2);
`;

const SAMPLE_HEPMC_FIXTURE = `
E 202 1 3
PROCESS = B+ -> K+ pi+ pi-
ENERGY = 5.279
P 1 B+   521  0.0000  0.0000  0.0000  5.2793  5.2793  initial
P 2 K+   321 -0.8500  0.6500  1.1000  1.6700  0.4937  final
P 3 pi+  211  0.6000 -0.9000  0.4000  1.8200  0.1396  final
P 4 pi- -211  0.2500  0.2500 -1.5000  1.7893  0.1396  final
`;

describe("High-Energy Particle Physics & Accelerator Optics IDE Panels (Path E)", () => {
  it("exposes AcceleratorLatticePanel and AcceleratorLatticeEditorProvider viewType identifiers", () => {
    assert.equal(AcceleratorLatticePanel.viewType, "modelscript.acceleratorLatticeViewer");
    assert.equal(AcceleratorLatticeEditorProvider.viewType, "modelscript.acceleratorLatticeEditor");
  });

  it("constructs accelerator lattice from MAD-X and renders Twiss parameters & beam envelopes SVG", () => {
    const lattice = parseMadxLattice(SAMPLE_MADX_FIXTURE);
    assert.equal(lattice.title, "CERN SPS Extraction Transfer Line");
    assert.equal(lattice.beam.particle, "proton");
    assert.equal(lattice.beam.energyGev, 400.0);
    assert.equal(lattice.elements.length, 8);
    assert.ok(lattice.totalLength > 15.0 && lattice.totalLength < 25.0);

    const diags = lintAcceleratorLattice(lattice);
    assert.equal(diags.filter((d) => d.severity === "error").length, 0);

    const svg = renderAcceleratorLatticeSvg(lattice, {
      width: 900,
      height: 480,
      showBeta: true,
      showDispersion: true,
      showEnvelope: true,
      showAperture: true,
      showBadges: true,
    });

    assert.ok(svg.includes("<svg"), "Should output valid SVG root");
    assert.ok(svg.includes("s (m)"), "Should include longitudinal position s axis label");
    assert.ok(svg.includes("βx"), "Should include beta functions label");
    assert.ok(svg.includes("Beam σ (mm)"), "Should include beam envelope label");
    assert.ok(svg.includes("MQF1"), "Should include quadrupole magnet label");
    assert.ok(svg.includes("MB1"), "Should include dipole bend magnet label");
  });

  it("exposes HepEventViewerPanel and HepEventViewerEditorProvider viewType identifiers", () => {
    assert.equal(HepEventViewerPanel.viewType, "modelscript.hepEventViewer");
    assert.equal(HepEventViewerEditorProvider.viewType, "modelscript.hepEventEditor");
  });

  it("parses HepMC particle collision event and renders Dalitz plot kinematics SVG", () => {
    const event = parseHepEvent(SAMPLE_HEPMC_FIXTURE);
    assert.equal(event.eventId, 202);
    assert.equal(event.process, "B+ -> K+ pi+ pi-");
    assert.equal(event.particles.length, 4);

    const bp = event.particles.find((p) => p.name === "B+")!;
    assert.equal(bp.mass, 5.2793);
    assert.equal(bp.charge, +1);

    const kp = event.particles.find((p) => p.name === "K+")!;
    assert.equal(kp.charge, +1);
    assert.equal(kp.mass, 0.4937);

    const diags = lintParticleEvent(event);
    assert.equal(diags.filter((d) => d.severity === "error").length, 0);

    const mother: Particle = bp;
    const daughters: [Particle, Particle, Particle] = [event.particles[1]!, event.particles[2]!, event.particles[3]!];

    const dalitz = computeDalitzKinematics(mother, daughters, 100);
    assert.equal(dalitz.motherParticle.name, "B+");
    assert.ok(dalitz.kinematicBoundary.length >= 80);
    assert.ok(dalitz.events.length > 50);

    const m12Values = dalitz.events.map((e) => Math.sqrt(e.m12Sq));
    const hist = computeInvariantMassDistribution(m12Values, 20);

    const svg = renderDalitzPlotSvg(dalitz, hist, {
      width: 900,
      height: 520,
      showResonances: true,
      showBoundary: true,
      showHistogram: true,
    });

    assert.ok(svg.includes("<svg"), "Should output valid SVG root");
    assert.ok(svg.includes("Dalitz Plot: B+ → K+ + pi+ + pi-"), "Should display decay process");
    assert.ok(svg.includes("Kinematic Boundary"), "Should render kinematic boundary");
    assert.ok(svg.includes("Invariant Mass Projection"), "Should render invariant mass projection");
  });
});
