// name: RealSubEw
// keywords: real, subtraction, element-wise
// status: correct
//
// Tests element-wise scalar-array subtraction.
//

function f
  input Real r1;
  input Real r2[:];
  output Real o[size(r2, 1)];
algorithm
  o := r1 .- r2;
end f;

model RealAddEw
  Real x[:] = f(3, {4, 5, 6});
end RealAddEw;

// Result:
// Error processing file: RealSubEw.mo
// Error: Failed to load package RealSubEw (default) using MODELICAPATH /home/omar/.openmodelica/libraries/.
// Error: Class RealSubEw not found in scope <top>.
// Error: Error occurred while flattening model RealSubEw
//
// # Error encountered! Exiting...
// # Please check the error message and the flags.
//
// Execution failed!
// endResult
