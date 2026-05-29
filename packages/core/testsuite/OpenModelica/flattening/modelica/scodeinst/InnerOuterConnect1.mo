// name: InnerOuterConnect1
// keywords:
// status: correct
//

connector RealOutput = output Real;
connector RealInput = input Real;

model A
  RealOutput x;
  RealOutput y;
equation
  connect(x, y);
end A;

model B
  A a;
end B;

model C
  outer B b;
end C;

model InnerOuterConnect1
  C c;
end InnerOuterConnect1;

// Result:
// class InnerOuterConnect1
//   Real b.a.x;
//   Real b.a.y;
// equation
//   b.a.x = b.a.y;
// end InnerOuterConnect1;
// endResult
