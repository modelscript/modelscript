// name: MergeComponents2
// keywords:
// status: correct
// teardown_command: rm MergeComponents2_merged_table.json
//

model A
  Real x;
  Real y;
  Real z;
end A;

model MergeComponents2
  A a1(x = 1, y = 2, z = 3);
  A a2(z = 4, y = 5, x = 6);
  A a3(y = 7, x = 8, z = 9);
end MergeComponents2;

// Result:
// class MergeComponents2
//   Real a1.x = 1.0;
//   Real a1.y = 2.0;
//   Real a1.z = 3.0;
//   Real a2.x = 6.0;
//   Real a2.y = 5.0;
//   Real a2.z = 4.0;
//   Real a3.x = 8.0;
//   Real a3.y = 7.0;
//   Real a3.z = 9.0;
// end MergeComponents2;
// endResult
