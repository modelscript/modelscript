model StateSpace
  parameter Integer m = 3;
  parameter Integer n = 3;
  parameter Integer r = 3;
  
  parameter Real A[n, n] = [1, 0, 0; 0, 1, 0; 0, 0, 1];
  parameter Real B[n, m] = [1, 0, 0; 0, 1, 0; 0, 0, 1];
  parameter Real C[r, n] = [1, 0, 0; 0, 1, 0; 0, 0, 1];
  parameter Real D[r, m] = [1, 0, 0; 0, 1, 0; 0, 0, 1];
  parameter Real x0[n] = {0, 0, 0};
  Real u[m] = {1, 2, 3};
  output Real y[r];
  
  Real x[n](start=x0);
equation
  for i in 1:n loop
    der(x[i]) = A[i,1]*x[1] + A[i,2]*x[2] + A[i,3]*x[3] + B[i,1]*u[1] + B[i,2]*u[2] + B[i,3]*u[3];
    y[i] = C[i,1]*x[1] + C[i,2]*x[2] + C[i,3]*x[3] + D[i,1]*u[1] + D[i,2]*u[2] + D[i,3]*u[3];
  end for;
end StateSpace;

// Result:
// class StateSpace
//   parameter Integer m = 3;
//   parameter Integer n = 3;
//   parameter Integer r = 3;
//   parameter Real A[1,1] = 1.0;
//   parameter Real A[1,2] = 0.0;
//   parameter Real A[1,3] = 0.0;
//   parameter Real A[2,1] = 0.0;
//   parameter Real A[2,2] = 1.0;
//   parameter Real A[2,3] = 0.0;
//   parameter Real A[3,1] = 0.0;
//   parameter Real A[3,2] = 0.0;
//   parameter Real A[3,3] = 1.0;
//   parameter Real B[1,1] = 1.0;
//   parameter Real B[1,2] = 0.0;
//   parameter Real B[1,3] = 0.0;
//   parameter Real B[2,1] = 0.0;
//   parameter Real B[2,2] = 1.0;
//   parameter Real B[2,3] = 0.0;
//   parameter Real B[3,1] = 0.0;
//   parameter Real B[3,2] = 0.0;
//   parameter Real B[3,3] = 1.0;
//   parameter Real C[1,1] = 1.0;
//   parameter Real C[1,2] = 0.0;
//   parameter Real C[1,3] = 0.0;
//   parameter Real C[2,1] = 0.0;
//   parameter Real C[2,2] = 1.0;
//   parameter Real C[2,3] = 0.0;
//   parameter Real C[3,1] = 0.0;
//   parameter Real C[3,2] = 0.0;
//   parameter Real C[3,3] = 1.0;
//   parameter Real D[1,1] = 1.0;
//   parameter Real D[1,2] = 0.0;
//   parameter Real D[1,3] = 0.0;
//   parameter Real D[2,1] = 0.0;
//   parameter Real D[2,2] = 1.0;
//   parameter Real D[2,3] = 0.0;
//   parameter Real D[3,1] = 0.0;
//   parameter Real D[3,2] = 0.0;
//   parameter Real D[3,3] = 1.0;
//   parameter Real x0[1] = 0.0;
//   parameter Real x0[2] = 0.0;
//   parameter Real x0[3] = 0.0;
//   input Real u[1];
//   input Real u[2];
//   input Real u[3];
//   output Real y[1];
//   output Real y[2];
//   output Real y[3];
//   Real x[1](start = 0.0);
//   Real x[2](start = 0.0);
//   Real x[3](start = 0.0);
// equation
//   u = {1.0, 2.0, 3.0};
//   der(x[1]) = A[1,1] * x[1] + A[1,2] * x[2] + A[1,3] * x[3] + B[1,1] * u[1] + B[1,2] * u[2] + B[1,3] * u[3];
//   y[1] = C[1,1] * x[1] + C[1,2] * x[2] + C[1,3] * x[3] + D[1,1] * u[1] + D[1,2] * u[2] + D[1,3] * u[3];
//   der(x[2]) = A[2,1] * x[1] + A[2,2] * x[2] + A[2,3] * x[3] + B[2,1] * u[1] + B[2,2] * u[2] + B[2,3] * u[3];
//   y[2] = C[2,1] * x[1] + C[2,2] * x[2] + C[2,3] * x[3] + D[2,1] * u[1] + D[2,2] * u[2] + D[2,3] * u[3];
//   der(x[3]) = A[3,1] * x[1] + A[3,2] * x[2] + A[3,3] * x[3] + B[3,1] * u[1] + B[3,2] * u[2] + B[3,3] * u[3];
//   y[3] = C[3,1] * x[1] + C[3,2] * x[2] + C[3,3] * x[3] + D[3,1] * u[1] + D[3,2] * u[2] + D[3,3] * u[3];
// end StateSpace;
// endResult
