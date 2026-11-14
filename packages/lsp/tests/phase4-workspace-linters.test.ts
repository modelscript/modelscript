// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert/strict";
import test from "node:test";

import { lintAntimonyWorkspace } from "@modelscript/antimony";
import { lintCellmlWorkspace } from "@modelscript/cellml";
import { lintEclipseWorkspace } from "@modelscript/eclipse";
import { lintEnergyPlusWorkspace } from "@modelscript/energyplus";
import { lintHecRasWorkspace } from "@modelscript/hec-ras";
import { lintModflowWorkspace } from "@modelscript/modflow";
import { lintSbolWorkspace } from "@modelscript/sbol";
import { lintSedmlWorkspace } from "@modelscript/sedml";
import { lintTopasWorkspace } from "@modelscript/topas";

test("MODFLOW workspace linter: resolves .nam package files and detects missing files", () => {
  const ok = lintModflowWorkspace({
    "sim.nam": "BEGIN Packages\n  DIS6 model.dis\nEND Packages\n",
    "model.dis": "# DIS6\nBEGIN DIMENSIONS\n  NLAY 1\n  NROW 2\n  NCOL 2\nEND DIMENSIONS\n",
  });
  assert.equal(ok.filter((d) => d.code === "MF3001").length, 0);

  const missing = lintModflowWorkspace({
    "sim.nam": "BEGIN Packages\n  DIS6 missing.dis\nEND Packages\n",
  });
  assert.equal(missing.filter((d) => d.code === "MF3001").length, 1);
});

test("HEC-RAS workspace linter: resolves .prj Geom/Flow files and detects missing references", () => {
  const ok = lintHecRasWorkspace(
    {
      "river.prj": "Proj Title=River\nGeom File=g01\nFlow File=f01\n",
      "river.g01": "Geom Title=Main\nRiver Reach=R1,1\n",
      "river.f01": "Flow Title=Steady\n",
    },
    "river.prj",
  );
  assert.equal(ok.filter((d) => d.code === "HR3001").length, 0);

  const missing = lintHecRasWorkspace(
    {
      "river.prj": "Proj Title=River\nGeom File=g01\nFlow File=f01\n",
      "river.g01": "Geom Title=Main\n",
    },
    "river.prj",
  );
  assert.equal(missing.filter((d) => d.code === "HR3001").length, 1);
});

test("ECLIPSE workspace linter: resolves INCLUDE directives and detects missing/cyclic includes", () => {
  const ok = lintEclipseWorkspace(
    {
      "CASE.DATA": "RUNSPEC\nDIMENS\n  10 10 1 /\nINCLUDE\n  'grid.inc' /\n",
      "grid.inc": "GRID\nDX\n  100*50 /\n",
    },
    "CASE.DATA",
  );
  assert.equal(ok.filter((d) => d.code === "EC3001" || d.code === "EC3002").length, 0);

  const missing = lintEclipseWorkspace(
    {
      "CASE.DATA": "RUNSPEC\nINCLUDE\n  'missing.inc' /\n",
    },
    "CASE.DATA",
  );
  assert.equal(missing.filter((d) => d.code === "EC3001").length, 1);

  const cyclic = lintEclipseWorkspace(
    {
      "a.data": "INCLUDE\n  'b.inc' /\n",
      "b.inc": "INCLUDE\n  'a.data' /\n",
    },
    "a.data",
  );
  assert.equal(cyclic.filter((d) => d.code === "EC3002").length, 1);
});

test("EnergyPlus workspace linter: resolves external CSV/EPW files and warns on missing", () => {
  const ok = lintEnergyPlusWorkspace({
    "building.idf": "Schedule:File, Sched1, Any Number, schedules/occ.csv, 1;\n",
    "schedules/occ.csv": "0.5\n1.0\n",
  });
  assert.equal(ok.filter((d) => d.code === "EP3001").length, 0);

  const missing = lintEnergyPlusWorkspace({
    "building.idf": "Schedule:File, Sched1, Any Number, missing.csv, 1;\n",
  });
  assert.equal(missing.filter((d) => d.code === "EP3001").length, 1);
});

test("TOPAS workspace linter: resolves includeFile hierarchies and detects missing/cyclic includes", () => {
  const ok = lintTopasWorkspace(
    {
      "main.txt": 'includeFile = "beam.txt"\ni:Ts/NumberOfHistoriesInRun = 100\n',
      "beam.txt": 's:So/Demo/Type = "Beam"\n',
    },
    "main.txt",
  );
  assert.equal(ok.filter((d) => d.code === "TP3001" || d.code === "TP3002").length, 0);

  const missing = lintTopasWorkspace(
    {
      "main.txt": 'includeFile = "missing.txt"\n',
    },
    "main.txt",
  );
  assert.equal(missing.filter((d) => d.code === "TP3001").length, 1);

  const cyclic = lintTopasWorkspace(
    {
      "a.txt": 'includeFile = "b.txt"\n',
      "b.txt": 'includeFile = "a.txt"\n',
    },
    "a.txt",
  );
  assert.equal(cyclic.filter((d) => d.code === "TP3002").length, 1);
});

test("CellML workspace linter: resolves xlink:href imports and detects missing/cyclic imports", () => {
  const ok = lintCellmlWorkspace(
    {
      "main.cellml":
        '<model name="main"><import xlink:href="sub.cellml"><component name="c1" component_ref="c1"/></import></model>',
      "sub.cellml": '<model name="sub"><component name="c1"/></model>',
    },
    "main.cellml",
  );
  assert.equal(ok.filter((d) => d.code === "CM3001" || d.code === "CM3002").length, 0);

  const missing = lintCellmlWorkspace(
    {
      "main.cellml": '<model name="main"><import xlink:href="missing.cellml"/></model>',
    },
    "main.cellml",
  );
  assert.equal(missing.filter((d) => d.code === "CM3001").length, 1);

  const cyclic = lintCellmlWorkspace(
    {
      "a.cellml": '<model name="a"><import xlink:href="b.cellml"/></model>',
      "b.cellml": '<model name="b"><import xlink:href="a.cellml"/></model>',
    },
    "a.cellml",
  );
  assert.equal(cyclic.filter((d) => d.code === "CM3002").length, 1);
});

test("Antimony workspace linter: resolves import directives and detects missing/cyclic imports", () => {
  const ok = lintAntimonyWorkspace(
    {
      "main.ant": 'import "sub.ant"\nmodel main()\n  S1 -> S2; k1*S1\n  S1 = 10; k1 = 0.1\nend\n',
      "sub.ant": "model sub()\n  X -> Y; k*X\n  X = 1; k = 1\nend\n",
    },
    "main.ant",
  );
  assert.equal(ok.filter((d) => d.code === "AN3001" || d.code === "AN3002").length, 0);

  const missing = lintAntimonyWorkspace(
    {
      "main.ant": 'import "missing.ant"\nmodel main()\nend\n',
    },
    "main.ant",
  );
  assert.equal(missing.filter((d) => d.code === "AN3001").length, 1);

  const cyclic = lintAntimonyWorkspace(
    {
      "a.ant": 'import "b.ant"\nmodel a()\nend\n',
      "b.ant": 'import "a.ant"\nmodel b()\nend\n',
    },
    "a.ant",
  );
  assert.equal(cyclic.filter((d) => d.code === "AN3002").length, 1);
});

test('SED-ML workspace linter: resolves <model source="..."/> against workspace files', () => {
  const ok = lintSedmlWorkspace({
    "experiment.sedml":
      '<sedML level="1" version="4"><listOfModels><model id="m1" source="model.xml"/></listOfModels></sedML>',
    "model.xml": "<sbml/>",
  });
  assert.equal(ok.filter((d) => d.code === "SD3001").length, 0);

  const missing = lintSedmlWorkspace({
    "experiment.sedml":
      '<sedML level="1" version="4"><listOfModels><model id="m1" source="missing.xml"/></listOfModels></sedML>',
  });
  assert.equal(missing.filter((d) => d.code === "SD3001").length, 1);
});

test("SBOL workspace linter: resolves cross-file rdf:about / rdf:resource URIs", () => {
  const ok = lintSbolWorkspace({
    "circuit.sbol":
      '<rdf:RDF><sbol:Component rdf:about="https://example.org/comp"><sbol:hasFeature rdf:resource="https://example.org/feat1"/></sbol:Component></rdf:RDF>',
    "parts.sbol": '<rdf:RDF><sbol:Feature rdf:about="https://example.org/feat1"/></rdf:RDF>',
  });
  assert.equal(ok.filter((d) => d.code === "SB3001").length, 0);

  const missing = lintSbolWorkspace({
    "circuit.sbol":
      '<rdf:RDF><sbol:Component rdf:about="https://example.org/comp"><sbol:hasFeature rdf:resource="https://example.org/missing"/></sbol:Component></rdf:RDF>',
  });
  assert.equal(missing.filter((d) => d.code === "SB3001").length, 1);
});
