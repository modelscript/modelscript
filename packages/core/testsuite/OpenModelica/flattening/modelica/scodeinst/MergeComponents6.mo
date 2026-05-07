// name: MergeComponents6
// keywords:
// status: correct
// teardown_command: rm MergeComponents6_merged_table.json
//

model A
  Real x;
  Real y;
end A;

model MergeComponents6
  A a1(x = 1, y = 2);
  parameter A a2(x = 3, y = 4);
  A a3(x = 5, y = 6);
  parameter A a4(x = 7, y = 8);
end MergeComponents6;

// Result:
// class MergeComponents6
//   Real a1.x = 1.0;
//   Real a1.y = 2.0;
//   parameter Real a2.x = 3.0;
//   parameter Real a2.y = 4.0;
//   Real a3.x = 5.0;
//   Real a3.y = 6.0;
//   parameter Real a4.x = 7.0;
//   parameter Real a4.y = 8.0;
// end MergeComponents6;
// endResult
