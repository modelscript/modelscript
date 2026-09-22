// name: const5.mo
// keywords:
// status: correct
// xfail:    true
//


package P
  constant Integer n = 2;
  constant A a;
end P;

model A
  Real x[P.n];
end A;

// Result:
// class A
//   Real x[1];
//   Real x[2];
// end A;
// endResult
