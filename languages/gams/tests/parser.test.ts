// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { lexGams, parseGams } from "../src/index.js";

describe("@modelscript/gams — Lexer & Parser", () => {
  it("parses Dantzig's trnsport model with Sets, Parameters, 2D Table, Scalar, Assignments, Equations, Model, Solve, Display", () => {
    const source = `
$title A Transportation Problem (TRNSPORT, SEQ=1)
* Classic Dantzig (1963) transportation problem
$ontext
  Multi-line block comment ignored by the lexer.
$offtext

Sets
  i   canning plants   / seattle, san-diego /
  j   markets          / new-york, chicago, topeka / ;

Parameters
  a(i)  capacity of plant i in cases
    / seattle    350
      san-diego  600 /
  b(j)  demand at market j in cases
    / new-york   325
      chicago    300
      topeka     275 / ;

Table d(i,j)  distance in thousands of miles
                  new-york  chicago  topeka
  seattle            2.5      1.7     1.8
  san-diego          2.5      1.8     1.4 ;

Scalar f  freight in dollars per case per thousand miles / 90 / ;
Parameter c(i,j)  transport cost in thousands of dollars per case ;
c(i,j) = f * d(i,j) / 1000 ;

Variables
  x(i,j)  shipment quantities in cases
  z       total transportation costs in thousands of dollars ;
Positive Variable x ;

Equations
  cost        define objective function
  supply(i)   observe supply limit at plant i
  demand(j)   satisfy demand at market j ;

cost..        z  =e=  sum((i,j), c(i,j)*x(i,j)) ;
supply(i)..   sum(j, x(i,j))  =l=  a(i) ;
demand(j)..   sum(i, x(i,j))  =g=  b(j) ;

Model transport / all / ;
Solve transport using lp minimizing z ;
Display x.l, x.m, z.l ;
`;

    const model = parseGams(source);
    assert.equal(model.syntaxErrors.length, 0);
    assert.equal(model.title, "A Transportation Problem (TRNSPORT, SEQ=1)");
    assert.equal(model.sets.length, 2);
    assert.deepEqual(model.sets[0]!.elements, ["seattle", "san-diego"]);
    assert.deepEqual(model.sets[1]!.elements, ["new-york", "chicago", "topeka"]);

    const dTable = model.parameters.find((p) => p.name === "d");
    assert.ok(dTable);
    assert.equal(dTable.kind, "table");
    assert.equal(dTable.values["seattle.new-york"], 2.5);
    assert.equal(dTable.values["seattle.chicago"], 1.7);
    assert.equal(dTable.values["san-diego.topeka"], 1.4);

    const xVar = model.variables.find((v) => v.name === "x");
    assert.ok(xVar);
    assert.equal(xVar.varKind, "positive");
    assert.deepEqual(xVar.domain, ["i", "j"]);

    assert.equal(model.equationDecls.length, 3);
    assert.equal(model.equationDefs.length, 3);
    assert.equal(model.models.length, 1);
    assert.equal(model.models[0]!.allEquations, true);
    assert.equal(model.solves.length, 1);
    assert.equal(model.solves[0]!.solverType, "lp");
    assert.equal(model.solves[0]!.sense, "minimizing");
    assert.equal(model.solves[0]!.objectiveVar, "z");
    assert.equal(model.displays.length, 1);
    assert.equal(model.displays[0]!.items.length, 3);
  });

  it("expands GAMS range sets (i1*i5), Alias, Binary/Integer variables, and $-conditionals", () => {
    const source = `
Set i / i1*i5 / ;
Alias (i, ip) ;
Parameter w(i) / i1 1, i2 2, i3 3, i4 4, i5 5 / ;
Binary Variables y(i) ;
Integer Variable k ;
Variable obj ;
Equations e1, e2(i) ;
e1.. obj =e= sum(i$(ord(i) > 1), w(i) * y(i)) + k ;
e2(i)$(ord(i) <= 3).. y(i) =l= 1 ;
Model m / e1, e2 / ;
Solve m using mip maximizing obj ;
`;
    const model = parseGams(source);
    assert.equal(model.syntaxErrors.length, 0);
    assert.deepEqual(model.sets[0]!.elements, ["i1", "i2", "i3", "i4", "i5"]);
    assert.equal(model.aliases.length, 1);
    assert.deepEqual(model.aliases[0]!.names, ["i", "ip"]);
    assert.equal(model.variables.find((v) => v.name === "y")?.varKind, "binary");
    assert.equal(model.variables.find((v) => v.name === "k")?.varKind, "integer");
    assert.ok(model.equationDefs[1]!.condition, "Expected $-condition on equation e2(i)");
  });

  it("tokenizes =e=, =l=, =g=, .., and ignores column-1 * comments", () => {
    const { tokens } = lexGams("* comment line\neq.. x =l= 5 ;\n");
    const sig = tokens.filter((t) => t.kind !== "newline" && t.kind !== "eof");
    assert.deepEqual(
      sig.map((t) => t.text),
      ["eq", "..", "x", "=l=", "5", ";"],
    );
  });
});
