// name: InnerOuterMissing5
// keywords:
// status: correct
//

model A
  Real x = 1.0;
end A;

model B
  outer model M = A;
  M m;
end B;

model InnerOuterMissing5
  B b;
end InnerOuterMissing5;

// Result:
// class InnerOuterMissing5
//   Real b.m.x = 1.0;
// end InnerOuterMissing5;
// endResult
