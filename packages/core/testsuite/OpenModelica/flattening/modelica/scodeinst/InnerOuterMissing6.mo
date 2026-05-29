// name: InnerOuterMissing6
// keywords:
// status: correct
//

model A
  outer Real x;
end A;

model B = A;

model InnerOuterMissing6
  B b;
end InnerOuterMissing6;

// Result:
// class InnerOuterMissing6
//   Real x;
// end InnerOuterMissing6;
// endResult
