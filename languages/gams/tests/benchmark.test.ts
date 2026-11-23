// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { solveGams } from "../src/index.js";

function assertRelErr(actual: number, expected: number, tolerance: number, label: string): void {
  const denom = Math.max(1e-12, Math.abs(expected));
  const relErr = Math.abs(actual - expected) / denom;
  assert.ok(
    relErr <= tolerance,
    `${label}: expected ${expected}, got ${actual} (relErr=${relErr.toExponential(3)} > tolerance=${tolerance})`,
  );
}

describe("@modelscript/gams — Optimization Benchmarks (trnsport, diet, blend, binary knapsack)", () => {
  it("solves Dantzig's classic trnsport LP to exact optimal = 153.675", () => {
    const trnsport = `
$title A Transportation Problem (TRNSPORT, SEQ=1)
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
`;

    const res = solveGams(trnsport);
    assert.equal(res.status, "optimal");
    const tolerance = 1e-6;
    assertRelErr(res.objectiveValue, 153.675, tolerance, "trnsport optimal objective");
    assertRelErr(res.variableValues["z"]!, 153.675, tolerance, "trnsport z variable");

    // Verify supply and demand feasibility
    const x = res.indexedValues["x"]!;
    const seattleShip = (x["seattle.new-york"] ?? 0) + (x["seattle.chicago"] ?? 0) + (x["seattle.topeka"] ?? 0);
    const sdShip = (x["san-diego.new-york"] ?? 0) + (x["san-diego.chicago"] ?? 0) + (x["san-diego.topeka"] ?? 0);
    assert.ok(seattleShip <= 350 + 1e-6);
    assert.ok(sdShip <= 600 + 1e-6);
    assertRelErr((x["seattle.new-york"] ?? 0) + (x["san-diego.new-york"] ?? 0), 325, 1e-6, "NY demand");
    assertRelErr((x["seattle.chicago"] ?? 0) + (x["san-diego.chicago"] ?? 0), 300, 1e-6, "Chicago demand");
    assertRelErr((x["seattle.topeka"] ?? 0) + (x["san-diego.topeka"] ?? 0), 275, 1e-6, "Topeka demand");
  });

  it("solves classic diet LP to exact minimum cost", () => {
    // 3 foods: bread ($2, 400 kcal, 10g prot), milk ($3, 300 kcal, 20g prot), eggs ($4, 200 kcal, 30g prot)
    // Require >= 2000 kcal, >= 100g protein.
    // Optimal: 5 bread + 2.5 milk? Let's check exact LP optimum:
    // Bread: 2/400 = 0.005 $/kcal, 2/10 = 0.2 $/g
    // Milk:  3/300 = 0.01  $/kcal, 3/20 = 0.15 $/g
    // Eggs:  4/200 = 0.02  $/kcal, 4/30 = 0.1333 $/g
    // Intersection of 400*b + 200*e = 2000 & 10*b + 30*e = 100:
    // b = 4, e = 2 -> cost = 4*2 + 2*4 = 16.0
    const diet = `
Sets
  f foods     / bread, milk, eggs /
  n nutrients / cal, prot / ;

Parameters
  cost(f)  unit cost
    / bread 2
      milk  3
      eggs  4 /
  req(n)   minimum daily requirement
    / cal   2000
      prot  100 / ;

Table nut(n,f)  nutrient content per serving
          bread  milk  eggs
  cal       400   300   200
  prot       10    20    30 ;

Positive Variables x(f) ;
Variable z ;

Equations
  obj     total cost
  bal(n)  nutrient balance ;

obj..     z =e= sum(f, cost(f) * x(f)) ;
bal(n)..  sum(f, nut(n,f) * x(f)) =g= req(n) ;

Model diet / all / ;
Solve diet using lp minimizing z ;
`;

    const res = solveGams(diet);
    assert.equal(res.status, "optimal");
    const tolerance = 1e-6;
    assertRelErr(res.objectiveValue, 16.0, tolerance, "diet optimal cost");
    assertRelErr(res.indexedValues["x"]!["bread"]!, 4.0, tolerance, "diet bread servings");
    assertRelErr(res.indexedValues["x"]!["eggs"]!, 2.0, tolerance, "diet eggs servings");
  });

  it("solves 0-1 binary knapsack MIP via Branch-and-Bound to exact integer optimum", () => {
    // 5 items with values [10, 40, 30, 50, 35] and weights [5, 4, 6, 3, 4], capacity = 10
    // Optimal subset: item2 (v=40, w=4) + item4 (v=50, w=3) -> w=7, v=90
    // Check item2 (w=4,v=40) + item4 (w=3,v=50) + none else fits (min remaining w=4 -> 11>10)
    // Check item3 (w=6,v=30) + item2 (w=4,v=40) = 70
    // Check item4 (w=3,v=50) + item5 (w=4,v=35) = 85
    // Check item4 (w=3,v=50) + item3 (w=6,v=30) = 80
    // Wait: LP relaxation takes item4 (w=3,v=50) + item2 (w=4,v=40) + 0.75*item5 (w=3,v=26.25) = 116.25!
    // Integer optimum is strictly 90.0 (item2 + item4), testing real Branch-and-Bound!
    const knapsack = `
Set i items / i1*i5 / ;
Parameters
  val(i) / i1 10, i2 40, i3 30, i4 50, i5 35 /
  wt(i)  / i1 5,  i2 4,  i3 6,  i4 3,  i5 4 / ;
Scalar cap / 10 / ;

Binary Variables x(i) ;
Variable z ;

Equations
  obj  maximize total value
  lim  weight capacity ;

obj.. z =e= sum(i, val(i) * x(i)) ;
lim.. sum(i, wt(i) * x(i)) =l= cap ;

Model knapsack / all / ;
Solve knapsack using mip maximizing z ;
`;

    const res = solveGams(knapsack);
    assert.equal(res.status, "optimal");
    assert.ok((res.nodesExplored ?? 0) >= 3, "Expected Branch-and-Bound to explore multiple nodes");
    const tolerance = 1e-6;
    assertRelErr(res.objectiveValue, 90.0, tolerance, "knapsack MIP optimal value");
    assert.equal(res.indexedValues["x"]!["i2"], 1);
    assert.equal(res.indexedValues["x"]!["i4"], 1);
    assert.equal(res.indexedValues["x"]!["i1"], 0);
    assert.equal(res.indexedValues["x"]!["i3"], 0);
    assert.equal(res.indexedValues["x"]!["i5"], 0);
  });

  it("evaluates $-conditionals with ord(), card(), and sameas() in equations", () => {
    const src = `
Set i / a, b, c / ;
Parameter p(i) / a 10, b 20, c 30 / ;
Positive Variables x(i) ;
Variable z ;
Equations obj, fixFirst, cap ;
obj.. z =e= sum(i$(ord(i) > 1), p(i) * x(i)) ;
fixFirst.. sum(i$(sameas(i, 'a')), x(i)) =e= card(i) ;
cap.. sum(i$(ord(i) > 1), x(i)) =g= 5 ;
Model m / all / ;
Solve m using lp minimizing z ;
`;
    const res = solveGams(src);
    assert.equal(res.status, "optimal");
    // x('a') = card(i) = 3 (zero cost in obj), x('b') = 5 (cost 20*5 = 100), x('c') = 0
    assertRelErr(res.objectiveValue, 100.0, 1e-6, "$-conditional LP objective");
    assertRelErr(res.indexedValues["x"]!["a"]!, 3.0, 1e-6, "sameas + card");
  });
});
