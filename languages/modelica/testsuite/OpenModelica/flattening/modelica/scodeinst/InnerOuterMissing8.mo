// name: InnerOuterMissing8
// keywords:
// status: correct
//

model A
  model B
    Real x;
  end B;

  outer B b;
end A;

model InnerOuterMissing8
  A a;
end InnerOuterMissing8;

// Result:
// class InnerOuterMissing8
//   Real b.x;
// end InnerOuterMissing8;
// endResult
