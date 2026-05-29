// name: dim2.mo
// keywords:
// status: correct
//
// FAILREASON: Dimensions not subscripted during expansion.
//


model N
  parameter Integer n;
  Real r[n];
end N;

model M
  N[2] n(n = {3,4});
equation
  n[1].r = {1,2,3};
  n[2].r = {4,5,6,7};
end M;

// Result:
// class M
//   final parameter Integer n[1].n = 3;
//   Real n[1].r[1];
//   Real n[1].r[2];
//   Real n[1].r[3];
//   final parameter Integer n[2].n = 4;
//   Real n[2].r[1];
//   Real n[2].r[2];
//   Real n[2].r[3];
//   Real n[2].r[4];
// equation
//   n[1].r = 1.0;
//   n[2].r = 4.0;
// end M;
// endResult
