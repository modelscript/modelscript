// name:     ImplicitRangeReductions
// keywords: reductions implicit range
// status:   correct
//
// Tests deduction of implicit iteration ranges in reductions.
//

package P
  constant Real x[2] = {1, 2};
end P;

model ImplicitRangeReductions
  Real a[3] = {1, 2, 3};
  Real[3] b, c, d, f, g;
  Real[2] l, m;
  Real e[3, 3];
  R1 r1[3];
  R2 r2;
  Real h[E] = {1, 2, 3};
  Real i[E];
  Real j[Boolean] = {1, 2};
  Real k[Boolean];

  record R1
    Real x;
  end R1;

  record R2
    Real x[3];
  end R2;

  type E = enumeration(one, two, three);
equation
  b = {a[i] for i};
  c = {a[i]*a[i] for i};
  d = {b[i]+c[i] for i};
  e = {b[i]+c[j] for i, j};
  f = {r1[i].x for i};
  g = {r2.x[i] for i};
  i = {h[i] for i};
  k = {j[i] for i};
  l = {P.x[i] for i};
  m = {.P.x[i] for i};
end ImplicitRangeReductions;

// Result:
// Error processing file: ImplicitRangeReductions.mo
// Error: Internal error Instantiation of ImplicitRangeReductions failed with no error message.
// Error: Error occurred while flattening model ImplicitRangeReductions
//
// # Error encountered! Exiting...
// # Please check the error message and the flags.
//
// Execution failed!
// endResult
