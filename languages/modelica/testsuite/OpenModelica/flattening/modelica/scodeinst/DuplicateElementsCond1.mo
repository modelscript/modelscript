// name: DuplicateElementsCond1.mo
// keywords:
// status: incorrect
//
//


model A
  Real x if true;
end A;

model B
  Real x;
end B;

model C
  extends A;
  extends B;
  Real x if true;
end C;

// Result:
// class C
//   Real x;
// end C;
// endResult
