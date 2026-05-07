// name: VectorizeBindings6
// keywords:
// status: correct
//

model VectorizeBindings6
  model A
    Real x;
    Real y;
  equation
    x = 1;
  algorithm
    y := 1;
  end A;

  model B
    A[2] a;
  end B;

  B[2] b;
end VectorizeBindings6;

// Result:
// class VectorizeBindings6
//   Real b[1].a[1].x;
//   Real b[1].a[1].y;
//   Real b[1].a[2].x;
//   Real b[1].a[2].y;
//   Real b[2].a[1].x;
//   Real b[2].a[1].y;
//   Real b[2].a[2].x;
//   Real b[2].a[2].y;
// equation
//   b[1].a[1].x = 1.0;
//   b[1].a[2].x = 1.0;
//   b[2].a[1].x = 1.0;
//   b[2].a[2].x = 1.0;
// algorithm
//   b[1].a[1].y := 1.0;
// algorithm
//   b[1].a[2].y := 1.0;
// algorithm
//   b[2].a[1].y := 1.0;
// algorithm
//   b[2].a[2].y := 1.0;
// end VectorizeBindings6;
// endResult
