// name: RealDivEw
// keywords: real, division, element-wise
// status: correct
//
// Tests element-wise array division.
//

function f
  input Real r1[:];
  input Real r2[size(r1, 1)];
  output Real o[size(r1, 1)];
algorithm
  o := r1 ./ r2;
end f;

model RealMulEw
  Real x[:] = f({1, 2, 3}, {4, 5, 6});
end RealMulEw;

// Result:
// Error processing file: RealDivEw.mo
// Error: Failed to load package RealDivEw (default) using MODELICAPATH /home/omar/.openmodelica/libraries/.
// Error: Class RealDivEw not found in scope <top>.
// Error: Error occurred while flattening model RealDivEw
//
// # Error encountered! Exiting...
// # Please check the error message and the flags.
//
// Execution failed!
// endResult
