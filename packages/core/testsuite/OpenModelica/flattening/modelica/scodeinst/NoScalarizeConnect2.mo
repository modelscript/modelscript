// name: NoScalarizeConnect2
// keywords:
// status: correct
//

connector C
  Real e;
  flow Real f;
  stream Real s;
end C;

model NoScalarizeConnect2
  C c[3];
  Real x;
equation
  for i in 1:3 loop
    x = actualStream(c[i].s);
  end for;
end NoScalarizeConnect2;

// Result:
// class NoScalarizeConnect2
//   Real c[1].e;
//   Real c[1].f;
//   Real c[1].s;
//   Real c[2].e;
//   Real c[2].f;
//   Real c[2].s;
//   Real c[3].e;
//   Real c[3].f;
//   Real c[3].s;
//   Real x;
// equation
//   c[1].f = 0.0;
//   c[2].f = 0.0;
//   c[3].f = 0.0;
//   x = c[1].s;
//   x = c[2].s;
//   x = c[3].s;
// end NoScalarizeConnect2;
// endResult
