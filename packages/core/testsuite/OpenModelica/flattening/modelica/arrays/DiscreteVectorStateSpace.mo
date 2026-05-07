// name:     DiscreteVectorStateSpace
// keywords: <insert keywords here>
// status:   correct
//
// <insert description here>
//

model DiscreteVectorStateSpace
  parameter Integer n = 5, m = 4, p = 2;
  parameter Real A[n, n] = fill(1, n, n);
  parameter Real B[n, m] = fill(2, n, m);
  parameter Real C[p, n] = fill(3, p, n);
  parameter Real D[p, m] = fill(4, p, m);
  parameter Real T = 1;
  input Real u[m];
  discrete output Real y[p];
protected
  discrete Real x[n];// = fill(2, n);
equation
  when sample(0, T) then
    x = A * pre(x) + B * u;
    y = C * pre(x) + D * u;
  end when;
end DiscreteVectorStateSpace;

model DVSSTest
  DiscreteVectorStateSpace dvss;
equation
  dvss.u= fill(time,dvss.m);
end DVSSTest;


// Result:
// class DiscreteVectorStateSpace
//   final parameter Integer n = 5;
//   final parameter Integer m = 4;
//   final parameter Integer p = 2;
//   parameter Real A[1,1] = 1.0;
//   parameter Real A[1,2] = 1.0;
//   parameter Real A[1,3] = 1.0;
//   parameter Real A[1,4] = 1.0;
//   parameter Real A[1,5] = 1.0;
//   parameter Real A[2,1] = 1.0;
//   parameter Real A[2,2] = 1.0;
//   parameter Real A[2,3] = 1.0;
//   parameter Real A[2,4] = 1.0;
//   parameter Real A[2,5] = 1.0;
//   parameter Real A[3,1] = 1.0;
//   parameter Real A[3,2] = 1.0;
//   parameter Real A[3,3] = 1.0;
//   parameter Real A[3,4] = 1.0;
//   parameter Real A[3,5] = 1.0;
//   parameter Real A[4,1] = 1.0;
//   parameter Real A[4,2] = 1.0;
//   parameter Real A[4,3] = 1.0;
//   parameter Real A[4,4] = 1.0;
//   parameter Real A[4,5] = 1.0;
//   parameter Real A[5,1] = 1.0;
//   parameter Real A[5,2] = 1.0;
//   parameter Real A[5,3] = 1.0;
//   parameter Real A[5,4] = 1.0;
//   parameter Real A[5,5] = 1.0;
//   parameter Real B[1,1] = 2.0;
//   parameter Real B[1,2] = 2.0;
//   parameter Real B[1,3] = 2.0;
//   parameter Real B[1,4] = 2.0;
//   parameter Real B[2,1] = 2.0;
//   parameter Real B[2,2] = 2.0;
//   parameter Real B[2,3] = 2.0;
//   parameter Real B[2,4] = 2.0;
//   parameter Real B[3,1] = 2.0;
//   parameter Real B[3,2] = 2.0;
//   parameter Real B[3,3] = 2.0;
//   parameter Real B[3,4] = 2.0;
//   parameter Real B[4,1] = 2.0;
//   parameter Real B[4,2] = 2.0;
//   parameter Real B[4,3] = 2.0;
//   parameter Real B[4,4] = 2.0;
//   parameter Real B[5,1] = 2.0;
//   parameter Real B[5,2] = 2.0;
//   parameter Real B[5,3] = 2.0;
//   parameter Real B[5,4] = 2.0;
//   parameter Real C[1,1] = 3.0;
//   parameter Real C[1,2] = 3.0;
//   parameter Real C[1,3] = 3.0;
//   parameter Real C[1,4] = 3.0;
//   parameter Real C[1,5] = 3.0;
//   parameter Real C[2,1] = 3.0;
//   parameter Real C[2,2] = 3.0;
//   parameter Real C[2,3] = 3.0;
//   parameter Real C[2,4] = 3.0;
//   parameter Real C[2,5] = 3.0;
//   parameter Real D[1,1] = 4.0;
//   parameter Real D[1,2] = 4.0;
//   parameter Real D[1,3] = 4.0;
//   parameter Real D[1,4] = 4.0;
//   parameter Real D[2,1] = 4.0;
//   parameter Real D[2,2] = 4.0;
//   parameter Real D[2,3] = 4.0;
//   parameter Real D[2,4] = 4.0;
//   parameter Real T = 1.0;
//   input Real u[1];
//   input Real u[2];
//   input Real u[3];
//   input Real u[4];
//   discrete output Real y[1];
//   discrete output Real y[2];
//   protected discrete Real x[1];
//   protected discrete Real x[2];
//   protected discrete Real x[3];
//   protected discrete Real x[4];
//   protected discrete Real x[5];
// equation
//   when sample(0.0, T) then
//     x[1] = A[1,1] * pre(x[1]) + A[1,2] * pre(x[2]) + A[1,3] * pre(x[3]) + A[1,4] * pre(x[4]) + A[1,5] * pre(x[5]) + B[1,1] * u[1] + B[1,2] * u[2] + B[1,3] * u[3] + B[1,4] * u[4];
//     x[2] = A[2,1] * pre(x[1]) + A[2,2] * pre(x[2]) + A[2,3] * pre(x[3]) + A[2,4] * pre(x[4]) + A[2,5] * pre(x[5]) + B[2,1] * u[1] + B[2,2] * u[2] + B[2,3] * u[3] + B[2,4] * u[4];
//     x[3] = A[3,1] * pre(x[1]) + A[3,2] * pre(x[2]) + A[3,3] * pre(x[3]) + A[3,4] * pre(x[4]) + A[3,5] * pre(x[5]) + B[3,1] * u[1] + B[3,2] * u[2] + B[3,3] * u[3] + B[3,4] * u[4];
//     x[4] = A[4,1] * pre(x[1]) + A[4,2] * pre(x[2]) + A[4,3] * pre(x[3]) + A[4,4] * pre(x[4]) + A[4,5] * pre(x[5]) + B[4,1] * u[1] + B[4,2] * u[2] + B[4,3] * u[3] + B[4,4] * u[4];
//     x[5] = A[5,1] * pre(x[1]) + A[5,2] * pre(x[2]) + A[5,3] * pre(x[3]) + A[5,4] * pre(x[4]) + A[5,5] * pre(x[5]) + B[5,1] * u[1] + B[5,2] * u[2] + B[5,3] * u[3] + B[5,4] * u[4];
//     y[1] = C[1,1] * pre(x[1]) + C[1,2] * pre(x[2]) + C[1,3] * pre(x[3]) + C[1,4] * pre(x[4]) + C[1,5] * pre(x[5]) + D[1,1] * u[1] + D[1,2] * u[2] + D[1,3] * u[3] + D[1,4] * u[4];
//     y[2] = C[2,1] * pre(x[1]) + C[2,2] * pre(x[2]) + C[2,3] * pre(x[3]) + C[2,4] * pre(x[4]) + C[2,5] * pre(x[5]) + D[2,1] * u[1] + D[2,2] * u[2] + D[2,3] * u[3] + D[2,4] * u[4];
//   end when;
// end DiscreteVectorStateSpace;
// endResult
