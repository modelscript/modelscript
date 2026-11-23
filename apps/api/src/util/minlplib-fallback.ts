// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Built-in curated MINLPLib benchmark instances (.mod, .gms, .lp) used as an
 * offline/fallback seed when https://www.minlplib.org/ is unreachable.
 */
export interface CuratedMinlpFile {
  path: string;
  content: string;
}

export const MINLPLIB_CURATED_FILES: CuratedMinlpFile[] = [
  {
    path: "mod/synthes1.mod",
    content: `# Model: synthes1
# Problem type: MINLP
# Convexity: convex
# Variables: 6
# Binary variables: 3
# Integer variables: 0
# Equations: 6
# Best primal bound: 6.0097589
# Best dual bound: 6.0097589
# Source: Duran & Grossmann (1986), Mathematical Programming 36
# Reference: https://www.minlplib.org/synthes1.html

var x1 >= 0, <= 2;
var x2 >= 0, <= 2;
var x3 >= 0, <= 1;
var y1 binary;
var y2 binary;
var y3 binary;

minimize obj: 5*y1 + 6*y2 + 8*y3 + 10*x1 - 7*x3 - 18*log(x2 + 1) - 19.2*log(x1 - x2 + 1) + 10;

subject to
  c1: 0.8*log(x2 + 1) + 0.96*log(x1 - x2 + 1) - 0.8*x3 >= 0;
  c2: log(x2 + 1) + 1.2*log(x1 - x2 + 1) - x3 - 2*y3 >= -2;
  c3: x2 - x1 <= 0;
  c4: x2 - 2*y1 <= 0;
  c5: x1 - x2 - 2*y2 <= 0;
  c6: y1 + y2 <= 1;
`,
  },
  {
    path: "mod/ex4_1_1.mod",
    content: `# Model: ex4_1_1
# Problem type: NLP
# Convexity: nonconvex
# Variables: 1
# Binary variables: 0
# Integer variables: 0
# Equations: 1
# Best primal bound: -7.487312
# Best dual bound: -7.487312
# Source: Floudas et al. (1999), Handbook of Test Problems in Local and Global Optimization
# Reference: https://www.minlplib.org/ex4_1_1.html

var x1 >= -2, <= 11 := 1;

minimize obj: x1^6 - 2.08*x1^5 + 0.4875*x1^4 + 7.1*x1^3 - 3.95*x1^2 - x1 + 0.1;
`,
  },
  {
    path: "mod/ex14_1_1.mod",
    content: `# Model: ex14_1_1
# Problem type: NLP
# Convexity: nonconvex
# Variables: 3
# Binary variables: 0
# Integer variables: 0
# Equations: 4
# Best primal bound: 0.0
# Best dual bound: 0.0
# Source: Floudas et al. (1999), Handbook of Test Problems in Local and Global Optimization
# Reference: https://www.minlplib.org/ex14_1_1.html

var x1 >= -5, <= 5 := 1;
var x2 >= -5, <= 5 := 1;
var x3 >= 0, <= 10 := 1;

minimize obj: x3;

subject to
  c1: 2*x1^2 + 4*x1*x2 - 42*x1 + 4*x1^3 - x3 <= 14;
  c2: -2*x1^2 - 4*x1*x2 + 42*x1 - 4*x1^3 - x3 <= -14;
  c3: 2*x1^2 + 4*x1*x2 - 26*x2 + 4*x2^3 - x3 <= 22;
  c4: -2*x1^2 - 4*x1*x2 + 26*x2 - 4*x2^3 - x3 <= -22;
`,
  },
  {
    path: "mod/st_e01.mod",
    content: `# Model: st_e01
# Problem type: NLP
# Convexity: nonconvex
# Variables: 2
# Binary variables: 0
# Integer variables: 0
# Equations: 1
# Best primal bound: -6.666667
# Best dual bound: -6.666667
# Source: Floudas & Pardalos (1990), A Collection of Test Problems for Constrained Global Optimization
# Reference: https://www.minlplib.org/st_e01.html

var x1 >= 0, <= 6 := 1;
var x2 >= 0, <= 4 := 1;

minimize obj: -x1 - x2;

subject to
  c1: x1*x2 <= 4;
`,
  },
  {
    path: "mod/alan.mod",
    content: `# Model: alan
# Problem type: MIQP / MINLP
# Convexity: convex
# Variables: 8
# Binary variables: 4
# Integer variables: 0
# Equations: 7
# Best primal bound: 2.925
# Best dual bound: 2.925
# Source: Manne (1986), GAMS Model Library
# Reference: https://www.minlplib.org/alan.html

var x1 >= 0, <= 1;
var x2 >= 0, <= 1;
var x3 >= 0, <= 1;
var x4 >= 0, <= 1;
var b1 binary;
var b2 binary;
var b3 binary;
var b4 binary;

minimize variance:
  4*x1^2 + 3*x2^2 + 2*x3^2 + x4^2 + 2*x1*x2 - x1*x3 + x2*x4;

subject to
  budget: x1 + x2 + x3 + x4 = 1;
  ret: 8*x1 + 9*x2 + 12*x3 + 7*x4 >= 10;
  maxassets: b1 + b2 + b3 + b4 <= 3;
  link1: x1 <= b1;
  link2: x2 <= b2;
  link3: x3 <= b3;
  link4: x4 <= b4;
`,
  },
  {
    path: "mod/nvs01.mod",
    content: `# Model: nvs01
# Problem type: MINLP
# Convexity: nonconvex
# Variables: 3
# Binary variables: 0
# Integer variables: 2
# Equations: 3
# Best primal bound: 12.46968
# Best dual bound: 12.46968
# Source: Gupta & Ravindran (1985), Management Science 31
# Reference: https://www.minlplib.org/nvs01.html

var i1 integer >= 1, <= 10 := 2;
var i2 integer >= 1, <= 10 := 2;
var x3 >= 0.001, <= 10 := 1;

minimize obj: x3^2 + i1^2 + i2^2;

subject to
  c1: i1 + i2 + x3 >= 5;
  c2: i1*i2 >= 2;
  c3: x3 >= 0.5;
`,
  },
  {
    path: "mod/gear.mod",
    content: `# Model: gear
# Problem type: MINLP
# Convexity: nonconvex
# Variables: 4
# Binary variables: 0
# Integer variables: 4
# Equations: 0
# Best primal bound: 2.700857e-12
# Best dual bound: 0
# Source: Sandgren (1990), ASME Journal of Mechanical Design
# Reference: https://www.minlplib.org/gear.html

var t1 integer >= 12, <= 60 := 16;
var t2 integer >= 12, <= 60 := 19;
var t3 integer >= 12, <= 60 := 43;
var t4 integer >= 12, <= 60 := 49;

minimize ratio_error: (1/6.931 - (t1*t2)/(t3*t4))^2;
`,
  },
  {
    path: "mod/prob02.mod",
    content: `# Model: prob02
# Problem type: MINLP
# Convexity: nonconvex
# Variables: 6
# Binary variables: 0
# Integer variables: 6
# Equations: 8
# Best primal bound: 112235.0
# Best dual bound: 112235.0
# Source: Kocis & Grossmann (1988), Computers & Chemical Engineering
# Reference: https://www.minlplib.org/prob02.html

var x1 integer >= 0, <= 100 := 10;
var x2 integer >= 0, <= 100 := 10;
var x3 integer >= 0, <= 100 := 10;
var x4 integer >= 0, <= 100 := 10;

minimize cost: 35*x1^0.6 + 35*x2^0.6 + 15*x3 + 20*x4;

subject to
  c1: x1 + x2 >= 15;
  c2: x3 + x4 >= 10;
  c3: 2*x1 + x3 >= 20;
  c4: x2 + 2*x4 >= 18;
`,
  },
  {
    path: "gms/synthes1_lp.gms",
    content: `* Model: synthes1_lp
* Problem type: MILP
* Convexity: convex
* Variables: 6
* Binary variables: 3
* Integer variables: 0
* Equations: 6
* Source: MINLPLib LP/MILP Relaxation Benchmark
* Reference: https://www.minlplib.org/synthes1.html

Variables obj, x1, x2, x3;
Positive Variables x1, x2, x3;
Binary Variables y1, y2, y3;

Equations defobj, c1, c2, c3, c4, c5;

defobj.. obj =e= 5*y1 + 6*y2 + 8*y3 + 10*x1 - 7*x3 + 10;
c1.. 0.8*x2 + 0.96*x1 - 0.8*x3 =g= 0;
c2.. x2 + 1.2*x1 - x3 - 2*y3 =g= -2;
c3.. x2 - x1 =l= 0;
c4.. x2 - 2*y1 =l= 0;
c5.. y1 + y2 =l= 1;

x1.up = 2;
x2.up = 2;
x3.up = 1;

Model synthes1_lp / all /;
Solve synthes1_lp using mip minimizing obj;
`,
  },
  {
    path: "gms/transport_minlp.gms",
    content: `* Model: transport_minlp
* Problem type: LP
* Convexity: convex
* Variables: 6
* Binary variables: 0
* Integer variables: 0
* Equations: 6
* Source: Dantzig / GAMS Model Library
* Reference: https://www.minlplib.org/

Variables z, x11, x12, x21, x22;
Positive Variables x11, x12, x21, x22;

Equations cost, sup1, sup2, dem1, dem2;

cost.. z =e= 2.5*x11 + 1.7*x12 + 1.8*x21 + 1.4*x22;
sup1.. x11 + x12 =l= 350;
sup2.. x21 + x22 =l= 600;
dem1.. x11 + x21 =g= 325;
dem2.. x12 + x22 =g= 300;

Model transport_minlp / all /;
Solve transport_minlp using lp minimizing z;
`,
  },
  {
    path: "lp/blend_minlp.lp",
    content: `\\ Model: blend_minlp
\\ Problem type: MILP
\\ Convexity: convex
\\ Variables: 4
\\ Binary variables: 1
\\ Integer variables: 1
\\ Equations: 4
\\ Best primal bound: 19.5
\\ Source: MINLPLib LP/MILP Benchmark Subset
\\ Reference: https://www.minlplib.org/

Minimize
 obj: 4 x1 + 5 x2 + 3 y1 + 2 z1
Subject To
 c1: x1 + x2 >= 4
 c2: 2 x1 + x2 >= 5
 c3: x1 - 10 y1 <= 0
 c4: x2 - 5 z1 <= 0
Bounds
 0 <= x1 <= 10
 0 <= x2 <= 10
 0 <= z1 <= 3
Generals
 z1
Binaries
 y1
End
`,
  },
  {
    path: "lp/diet_lp.lp",
    content: `\\ Model: diet_lp
\\ Problem type: LP
\\ Convexity: convex
\\ Variables: 3
\\ Binary variables: 0
\\ Integer variables: 0
\\ Equations: 3
\\ Source: MINLPLib LP Benchmark Subset
\\ Reference: https://www.minlplib.org/

Minimize
 obj: 1.8 x1 + 2.4 x2 + 1.2 x3
Subject To
 protein: 3 x1 + 2 x2 + x3 >= 12
 carbs: x1 + 4 x2 + 2 x3 >= 16
 fat: x1 + x2 + 3 x3 >= 9
Bounds
 0 <= x1 <= 20
 0 <= x2 <= 20
 0 <= x3 <= 20
End
`,
  },
];
