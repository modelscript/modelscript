// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { parseGaussianInput, resolveValueRef } from "../src/index.js";

describe("@modelscript/gaussian — Parser (.gjf / .com)", () => {
  it("parses Link0 commands, Route section, Title, Charge/Multiplicity, and Cartesian coordinates", () => {
    const gjf = `! Water optimization and frequency calculation
%chk=water.chk
%mem=4GB
%nprocshared=8
%rwf=water.rwf
#p B3LYP/6-31G(d) opt=(tight,calcfc) freq scrf=(pcm,solvent=water) pop=full scf=tight

Water B3LYP/6-31G(d) Opt+Freq

0 1
O   0.000000   0.000000   0.117300
H   0.000000   0.757200  -0.469200
H   0.000000  -0.757200  -0.469200
`;

    const doc = parseGaussianInput(gjf);
    assert.equal(doc.parseErrors.length, 0);
    assert.equal(doc.jobs.length, 1);

    const job = doc.jobs[0]!;
    assert.equal(job.link0.length, 4);
    assert.equal(job.link0[0]?.directive, "chk");
    assert.equal(job.link0[0]?.value, "water.chk");
    assert.equal(job.link0[1]?.directive, "mem");
    assert.equal(job.link0[1]?.value, "4GB");
    assert.equal(job.link0[2]?.directive, "nprocshared");
    assert.equal(job.link0[2]?.value, "8");
    assert.equal(job.link0[3]?.directive, "rwf");

    assert.ok(job.route);
    assert.equal(job.route.printLevel, "verbose");
    assert.equal(job.route.method, "B3LYP");
    assert.equal(job.route.basisSet, "6-31G(d)");
    const kwNames = job.route.keywords.map((k) => k.name.toLowerCase());
    assert.deepEqual(kwNames, ["opt", "freq", "scrf", "pop", "scf"]);
    assert.deepEqual(job.route.keywords[0]?.options, ["tight", "calcfc"]);
    assert.deepEqual(job.route.keywords[2]?.options, ["pcm", "solvent=water"]);

    assert.equal(job.title, "Water B3LYP/6-31G(d) Opt+Freq");
    assert.equal(job.charge, 0);
    assert.equal(job.multiplicity, 1);
    assert.equal(job.atoms.length, 3);
    assert.equal(job.atoms[0]?.kind, "cartesian");
    assert.equal(job.atoms[0]?.element, "O");
    assert.equal(job.atoms[0]?.atomicNumber, 8);
    assert.equal(job.atoms[1]?.y?.value, 0.7572);
    assert.equal(job.comments.length, 1);
  });

  it("parses Z-matrix geometry with dummy atoms (X), Variables:, and Constants: blocks", () => {
    const gjf = `%nproc=4
#n MP2/cc-pVDZ opt

Hydrogen Peroxide Z-Matrix with Dummy Atom

0 1
O
O 1 rOO
X 2 1.0 1 90.0
H 1 rOH 2 aHOO 3 90.0
H 2 rOH 1 aHOO 4 dHOOH
Variables:
rOO = 1.452
rOH = 0.965
aHOO = 100.0
Constants:
dHOOH = 111.5
`;

    const doc = parseGaussianInput(gjf);
    assert.equal(doc.parseErrors.length, 0);
    const job = doc.jobs[0]!;
    assert.equal(job.route?.printLevel, "normal");
    assert.equal(job.route?.method, "MP2");
    assert.equal(job.route?.basisSet, "cc-pVDZ");
    assert.equal(job.atoms.length, 5);

    const dummy = job.atoms[2]!;
    assert.equal(dummy.element, "X");
    assert.equal(dummy.isDummy, true);
    assert.equal(dummy.atomicNumber, 0);

    const h5 = job.atoms[4]!;
    assert.equal(h5.kind, "zmatrix");
    assert.equal(h5.bondRef, 2);
    assert.equal(h5.angleRef, 1);
    assert.equal(h5.dihedralRef, 4);
    assert.equal(resolveValueRef(h5.bondLength, job.variables, job.constants), 0.965);
    assert.equal(resolveValueRef(h5.dihedralAngle, job.variables, job.constants), 111.5);
    assert.equal(job.constants.get("dhooh")?.isConstant, true);
  });

  it("parses --Link1-- multi-step jobs and terse (#t) routes", () => {
    const gjf = `%chk=multi.chk
#t HF/STO-3G opt

Step 1: Geometry Optimization

0 1
H
H 1 0.74

--Link1--
%chk=multi.chk
#p CCSD(T)/cc-pVTZ sp td=(nstates=5)

Step 2: Coupled Cluster Single Point

0 1
H 0.0 0.0 0.0
H 0.0 0.0 0.74
`;

    const doc = parseGaussianInput(gjf);
    assert.equal(doc.parseErrors.length, 0);
    assert.equal(doc.jobs.length, 2);

    assert.equal(doc.jobs[0]?.route?.printLevel, "terse");
    assert.equal(doc.jobs[0]?.route?.method, "HF");
    assert.equal(doc.jobs[0]?.route?.basisSet, "STO-3G");
    assert.equal(doc.jobs[0]?.atoms[1]?.kind, "zmatrix");

    assert.equal(doc.jobs[1]?.stepIndex, 1);
    assert.equal(doc.jobs[1]?.route?.method, "CCSD(T)");
    assert.equal(doc.jobs[1]?.route?.basisSet, "cc-pVTZ");
    assert.equal(doc.jobs[1]?.route?.keywords[0]?.name, "sp");
    assert.equal(doc.jobs[1]?.route?.keywords[1]?.name, "td");
    assert.equal(doc.jobs[1]?.atoms[1]?.kind, "cartesian");
  });
});
