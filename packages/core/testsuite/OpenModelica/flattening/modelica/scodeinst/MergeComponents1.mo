// name: MergeComponents1
// keywords:
// status: correct
// teardown_command: rm MergeComponents1_merged_table.json
//

model A
  Real x;
  Real y;
  Real z;
end A;

model MergeComponents1
  A a1(x = 1, y = 2, z = 3);
  A a2(x = 4, y = 5, z = 6);
  A a3(x = 7, y = 8, z = 9);
end MergeComponents1;

// Result:
// class MergeComponents1
//   Real a1.x = 1.0;
//   Real a1.y = 2.0;
//   Real a1.z = 3.0;
//   Real a2.x = 4.0;
//   Real a2.y = 5.0;
//   Real a2.z = 6.0;
//   Real a3.x = 7.0;
//   Real a3.y = 8.0;
//   Real a3.z = 9.0;
// end MergeComponents1;
// endResult
