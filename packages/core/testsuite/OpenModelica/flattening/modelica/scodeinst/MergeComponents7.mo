// name: MergeComponents7
// keywords:
// status: correct
// teardown_command: rm MergeComponents7_merged_table.json
//

model A
  parameter Real p = 1;
  input Real u;
  Real y;
  Real x;
equation
  der(x) = -p*x+u;
  y = 2*p*x;
end A;

model B
  parameter Real q = 1;
  input Real u;
  output Real y;
  A aa(p = q*2);
  A ab(p = q*3);
equation
  aa.u = u;
  ab.u = aa.y;
  y = ab.y;
end B;

model MergeComponents7
  B b1(q = 3);
  B b2;
  B b3(q = 4);
  A a1(p = 3);
  A a2;
equation
  a1.u = 1;
  a2.u = a1.y;
  b1.u = a2.u;
  b2.u = b1.y;
  b3.u = b2.y;
end MergeComponents7;

// Result:
// class MergeComponents7
//   parameter Real b1.q = 3.0;
//   Real b1.u;
//   Real b1.y;
//   parameter Real b1.aa.p = b1.q * 2.0;
//   Real b1.aa.u;
//   Real b1.aa.y;
//   Real b1.aa.x;
//   parameter Real b1.ab.p = b1.q * 3.0;
//   Real b1.ab.u;
//   Real b1.ab.y;
//   Real b1.ab.x;
//   parameter Real b2.q = 1.0;
//   Real b2.u;
//   Real b2.y;
//   parameter Real b2.aa.p = b2.q * 2.0;
//   Real b2.aa.u;
//   Real b2.aa.y;
//   Real b2.aa.x;
//   parameter Real b2.ab.p = b2.q * 3.0;
//   Real b2.ab.u;
//   Real b2.ab.y;
//   Real b2.ab.x;
//   parameter Real b3.q = 4.0;
//   Real b3.u;
//   Real b3.y;
//   parameter Real b3.aa.p = b3.q * 2.0;
//   Real b3.aa.u;
//   Real b3.aa.y;
//   Real b3.aa.x;
//   parameter Real b3.ab.p = b3.q * 3.0;
//   Real b3.ab.u;
//   Real b3.ab.y;
//   Real b3.ab.x;
//   parameter Real a1.p = 3.0;
//   Real a1.u;
//   Real a1.y;
//   Real a1.x;
//   parameter Real a2.p = 1.0;
//   Real a2.u;
//   Real a2.y;
//   Real a2.x;
// equation
//   der(b1.aa.x) = b1.aa.u - b1.aa.p * b1.aa.x;
//   b1.aa.y = 2.0 * b1.aa.p * b1.aa.x;
//   der(b1.ab.x) = b1.ab.u - b1.ab.p * b1.ab.x;
//   b1.ab.y = 2.0 * b1.ab.p * b1.ab.x;
//   b1.aa.u = b1.u;
//   b1.ab.u = b1.aa.y;
//   b1.y = b1.ab.y;
//   der(b2.aa.x) = b2.aa.u - b2.aa.p * b2.aa.x;
//   b2.aa.y = 2.0 * b2.aa.p * b2.aa.x;
//   der(b2.ab.x) = b2.ab.u - b2.ab.p * b2.ab.x;
//   b2.ab.y = 2.0 * b2.ab.p * b2.ab.x;
//   b2.aa.u = b2.u;
//   b2.ab.u = b2.aa.y;
//   b2.y = b2.ab.y;
//   der(b3.aa.x) = b3.aa.u - b3.aa.p * b3.aa.x;
//   b3.aa.y = 2.0 * b3.aa.p * b3.aa.x;
//   der(b3.ab.x) = b3.ab.u - b3.ab.p * b3.ab.x;
//   b3.ab.y = 2.0 * b3.ab.p * b3.ab.x;
//   b3.aa.u = b3.u;
//   b3.ab.u = b3.aa.y;
//   b3.y = b3.ab.y;
//   der(a1.x) = a1.u - a1.p * a1.x;
//   a1.y = 2.0 * a1.p * a1.x;
//   der(a2.x) = a2.u - a2.p * a2.x;
//   a2.y = 2.0 * a2.p * a2.x;
//   a1.u = 1.0;
//   a2.u = a1.y;
//   b1.u = a2.u;
//   b2.u = b1.y;
//   b3.u = b2.y;
// end MergeComponents7;
// endResult
