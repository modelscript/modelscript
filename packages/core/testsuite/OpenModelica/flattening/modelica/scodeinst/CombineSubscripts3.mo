// name: CombineSubscripts3
// keywords:
// status: correct
//

record A
  Real[4] x;
  Real p;
end A;

model CombineSubscripts3
  A[3] b;
equation
  for i in 1:3 loop
    for j in 2:3 loop
      b[i].x[j] = b[i].x[j - 1] + b[i].p;
    end for;
  end for;
end CombineSubscripts3;

// Result:
// class CombineSubscripts3
//   Real b[1].x[1];
//   Real b[1].x[2];
//   Real b[1].x[3];
//   Real b[1].x[4];
//   Real b[1].p;
//   Real b[2].x[1];
//   Real b[2].x[2];
//   Real b[2].x[3];
//   Real b[2].x[4];
//   Real b[2].p;
//   Real b[3].x[1];
//   Real b[3].x[2];
//   Real b[3].x[3];
//   Real b[3].x[4];
//   Real b[3].p;
// equation
//   b[1].x[2] = b[1].x[1] + b[1].p;
//   b[1].x[3] = b[1].x[2] + b[1].p;
//   b[2].x[2] = b[2].x[1] + b[2].p;
//   b[2].x[3] = b[2].x[2] + b[2].p;
//   b[3].x[2] = b[3].x[1] + b[3].p;
//   b[3].x[3] = b[3].x[2] + b[3].p;
// end CombineSubscripts3;
// endResult
