// name: MergeComponents8
// keywords:
// status: correct
// teardown_command: rm MergeComponents8_merged_table.json
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

model MergeComponents8
  parameter Real n1 = 1.0;
  parameter Real n2 = 2.0;
  A a1(p = n1);
  A a2(p = n2);
end MergeComponents8;

// Result:
// class MergeComponents8
//   parameter Real n1 = 1.0;
//   parameter Real n2 = 2.0;
//   parameter Real a1.p = n1;
//   Real a1.u;
//   Real a1.y;
//   Real a1.x;
//   parameter Real a2.p = n2;
//   Real a2.u;
//   Real a2.y;
//   Real a2.x;
// equation
//   der(a1.x) = a1.u - a1.p * a1.x;
//   a1.y = 2.0 * a1.p * a1.x;
//   der(a2.x) = a2.u - a2.p * a2.x;
//   a2.y = 2.0 * a2.p * a2.x;
// end MergeComponents8;
// endResult
