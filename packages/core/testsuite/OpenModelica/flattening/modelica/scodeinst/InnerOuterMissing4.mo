// name: InnerOuterMissing4
// keywords:
// status: correct
//

model A
  Real x;
  annotation(missingInnerMessage = "Missing outer A");
end A;

model B
  outer A a;
  Real y = a.x;
end B;

model C
  outer A a;
  Real z = a.x;
end C;

model InnerOuterMissing4
  B b;
  C c;
end InnerOuterMissing4;

// Result:
// class InnerOuterMissing4
//   Real b.y = a.x;
//   Real c.z = a.x;
//   Real a.x;
// end InnerOuterMissing4;
// endResult
