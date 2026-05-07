// name: HideResult1
// keywords:
// status: correct
//
//

model A
  Real x;
  Real y annotation(HideResult = false);
end A;

model B
  extends A;
  A a1 annotation(HideResult = true);
  A a2;
  Real z;
end B;

model HideResult1
  B b1 annotation(HideResult = false);
  parameter Boolean hide = true;
  B b2 annotation(HideResult = hide);
end HideResult1;

// Result:
// class HideResult1
//   Real b1.x;
//   Real b1.y;
//   Real b1.a1.x;
//   Real b1.a1.y;
//   Real b1.a2.x;
//   Real b1.a2.y;
//   Real b1.z;
//   parameter Boolean hide = true;
//   Real b2.x;
//   Real b2.y;
//   Real b2.a1.x;
//   Real b2.a1.y;
//   Real b2.a2.x;
//   Real b2.a2.y;
//   Real b2.z;
// end HideResult1;
// endResult
