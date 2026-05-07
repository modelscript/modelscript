// name: MergeComponents5
// keywords:
// status: correct
// teardown_command: rm MergeComponents5_merged_table.json
//

model A
  Real x;
  Real y;
end A;

type A3 = A[3](x = {1, 2, 3});

model MergeComponents5
  A3 a1(y = {1, 2, 3});
  A3 a2(y = {4, 5, 6});
  A3 a3(y = {7, 8, 9});
end MergeComponents5;

// Result:
// class MergeComponents5
//   Real a1[1].x = 1.0;
//   Real a1[1].y = 1.0;
//   Real a1[2].x = 2.0;
//   Real a1[2].y = 2.0;
//   Real a1[3].x = 3.0;
//   Real a1[3].y = 3.0;
//   Real a2[1].x = 1.0;
//   Real a2[1].y = 4.0;
//   Real a2[2].x = 2.0;
//   Real a2[2].y = 5.0;
//   Real a2[3].x = 3.0;
//   Real a2[3].y = 6.0;
//   Real a3[1].x = 1.0;
//   Real a3[1].y = 7.0;
//   Real a3[2].x = 2.0;
//   Real a3[2].y = 8.0;
//   Real a3[3].x = 3.0;
//   Real a3[3].y = 9.0;
// end MergeComponents5;
// endResult
