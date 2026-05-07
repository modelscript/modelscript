// name: CombineSubscripts2
// keywords:
// status: correct
//

record A
  Real[4] a;
end A;

model CombineSubscripts2
  A[3] b;
equation
  for i in 1:4 loop
    b[3].a[i] = 1;
  end for;

  for i in 1:4 loop
    b.a[i] = {1, 2, 3};
  end for;

  for i in 1:3 loop
    b[i].a = {1, 2, 3, 4};
  end for;
end CombineSubscripts2;

// Result:
// class CombineSubscripts2
//   Real b[1].a[1];
//   Real b[1].a[2];
//   Real b[1].a[3];
//   Real b[1].a[4];
//   Real b[2].a[1];
//   Real b[2].a[2];
//   Real b[2].a[3];
//   Real b[2].a[4];
//   Real b[3].a[1];
//   Real b[3].a[2];
//   Real b[3].a[3];
//   Real b[3].a[4];
// equation
//   b[3].a[1] = 1.0;
//   b[3].a[2] = 1.0;
//   b[3].a[3] = 1.0;
//   b[3].a[4] = 1.0;
//   b[1].a[1] = 1.0;
//   b[2].a[1] = 2.0;
//   b[3].a[1] = 3.0;
//   b[1].a[2] = 1.0;
//   b[2].a[2] = 2.0;
//   b[3].a[2] = 3.0;
//   b[1].a[3] = 1.0;
//   b[2].a[3] = 2.0;
//   b[3].a[3] = 3.0;
//   b[1].a[4] = 1.0;
//   b[2].a[4] = 2.0;
//   b[3].a[4] = 3.0;
//   b[1].a[1] = 1.0;
//   b[1].a[2] = 2.0;
//   b[1].a[3] = 3.0;
//   b[1].a[4] = 4.0;
//   b[2].a[1] = 1.0;
//   b[2].a[2] = 2.0;
//   b[2].a[3] = 3.0;
//   b[2].a[4] = 4.0;
//   b[3].a[1] = 1.0;
//   b[3].a[2] = 2.0;
//   b[3].a[3] = 3.0;
//   b[3].a[4] = 4.0;
// end CombineSubscripts2;
// endResult
