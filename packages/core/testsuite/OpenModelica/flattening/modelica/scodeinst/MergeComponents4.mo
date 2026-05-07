// name: MergeComponents4
// keywords:
// status: correct
// teardown_command: rm MergeComponents4_merged_table.json
//

model A
  Real x;
  Real y;
  Real z;
end A;

model MergeComponents4
  A a1(x = 1, y = 2, z = 3);
  A a2(x = 4, y = 5, z = 6);
  A a3(x = 7, y = 8, z = 9);
equation
  a1.x = a2.y + a3.z;
algorithm
  a2.z := a3.x + a1.y;
end MergeComponents4;

// Result:
// class MergeComponents4
//   Real a1.x = 1.0;
//   Real a1.y = 2.0;
//   Real a1.z = 3.0;
//   Real a2.x = 4.0;
//   Real a2.y = 5.0;
//   Real a2.z = 6.0;
//   Real a3.x = 7.0;
//   Real a3.y = 8.0;
//   Real a3.z = 9.0;
// equation
//   a1.x = a2.y + a3.z;
// algorithm
//   a2.z := a3.x + a1.y;
// end MergeComponents4;
// endResult
