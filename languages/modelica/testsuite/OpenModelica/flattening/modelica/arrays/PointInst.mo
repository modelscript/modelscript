// name:     PointInst
// keywords: array
// status:   correct
//
// Drmodelica: 7.1 Type Checking (p. 209)
//
type Point = Real[3];


class PointInst
  Point[10]     p1 = fill(8, 10, 3);
  Real[10, 3]     p2 = fill(16, 10, 3);
  Real r[3] = p1[2, :];  // Equivalent to r[3] = p1[2]
  Real rsum = r[1]+r[3];
//equation
  //p2[5, :] = p1[2, :] + p1[4, :];  // Equivalent to p2[5] = p1[2] + p2[4]
  annotation(__OpenModelica_commandLineOptions="-d=-newInst");
end PointInst;

// model PointInst
// Real p1[10, 3] = fill(8, 10, 3);
// Real p2[10, 3] = fill(16, 10, 3);
// Real r[3] = p1[2, :];
// Real rsum = r[1]+r[3];
// end PointInst;

// Result:
// class PointInst
//   Real p1[1,1];
//   Real p1[1,2];
//   Real p1[1,3];
//   Real p1[2,1];
//   Real p1[2,2];
//   Real p1[2,3];
//   Real p1[3,1];
//   Real p1[3,2];
//   Real p1[3,3];
//   Real p1[4,1];
//   Real p1[4,2];
//   Real p1[4,3];
//   Real p1[5,1];
//   Real p1[5,2];
//   Real p1[5,3];
//   Real p1[6,1];
//   Real p1[6,2];
//   Real p1[6,3];
//   Real p1[7,1];
//   Real p1[7,2];
//   Real p1[7,3];
//   Real p1[8,1];
//   Real p1[8,2];
//   Real p1[8,3];
//   Real p1[9,1];
//   Real p1[9,2];
//   Real p1[9,3];
//   Real p1[10,1];
//   Real p1[10,2];
//   Real p1[10,3];
//   Real p2[1,1];
//   Real p2[1,2];
//   Real p2[1,3];
//   Real p2[2,1];
//   Real p2[2,2];
//   Real p2[2,3];
//   Real p2[3,1];
//   Real p2[3,2];
//   Real p2[3,3];
//   Real p2[4,1];
//   Real p2[4,2];
//   Real p2[4,3];
//   Real p2[5,1];
//   Real p2[5,2];
//   Real p2[5,3];
//   Real p2[6,1];
//   Real p2[6,2];
//   Real p2[6,3];
//   Real p2[7,1];
//   Real p2[7,2];
//   Real p2[7,3];
//   Real p2[8,1];
//   Real p2[8,2];
//   Real p2[8,3];
//   Real p2[9,1];
//   Real p2[9,2];
//   Real p2[9,3];
//   Real p2[10,1];
//   Real p2[10,2];
//   Real p2[10,3];
//   Real r[1];
//   Real r[2];
//   Real r[3];
//   Real rsum = r[1] + r[3];
// equation
//   p1 = {{8.0, 8.0, 8.0}, {8.0, 8.0, 8.0}, {8.0, 8.0, 8.0}, {8.0, 8.0, 8.0}, {8.0, 8.0, 8.0}, {8.0, 8.0, 8.0}, {8.0, 8.0, 8.0}, {8.0, 8.0, 8.0}, {8.0, 8.0, 8.0}, {8.0, 8.0, 8.0}};
//   p2 = {{16.0, 16.0, 16.0}, {16.0, 16.0, 16.0}, {16.0, 16.0, 16.0}, {16.0, 16.0, 16.0}, {16.0, 16.0, 16.0}, {16.0, 16.0, 16.0}, {16.0, 16.0, 16.0}, {16.0, 16.0, 16.0}, {16.0, 16.0, 16.0}, {16.0, 16.0, 16.0}};
//   r = {p1[2,1], p1[2,2], p1[2,3]};
// end PointInst;
// endResult
