// name: NoScalarize1
// keywords:
// status: correct
//

model NoScalarize1
  Real x[3];
  Real y;
  Real z;
initial equation
  for i in 1:2 loop
    x[i] = 2;
  end for;
  x[3] = 4;
equation
  der(x) = {y, z, y};
  z = 2*y;
  y = 4*x[1];

  for i in 1:2 loop
    x[i] = 3;
  end for;
end NoScalarize1;

// Result:
// class NoScalarize1
//   Real x[1];
//   Real x[2];
//   Real x[3];
//   Real y;
//   Real z;
// initial equation
//   x[1] = 2.0;
//   x[2] = 2.0;
//   x[3] = 4.0;
// equation
//   der(x[1]) = y;
//   der(x[2]) = z;
//   der(x[3]) = y;
//   z = 2.0 * y;
//   y = 4.0 * x[1];
//   x[1] = 3.0;
//   x[2] = 3.0;
// end NoScalarize1;
// endResult
