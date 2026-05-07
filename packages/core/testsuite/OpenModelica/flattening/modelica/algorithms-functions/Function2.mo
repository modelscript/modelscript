// name:     Function2
// keywords: function
// status:   correct
//
// This tests for illegal parts of a function definition.
// This test should really fail, but since the MSL uses public non-formal
// parameters we can only print a warning.
//

function f
  input Real x;
  output Real r;
  Real toomuch;
algorithm
  r := 2.0 * x;
end f;

model Function2
  Real x, z;
equation
  x = f(z);
end Function2;

// Result:
// Error processing file: Function2.mo
// [OpenModelica/flattening/modelica/algorithms-functions/Function2.mo:13:3-13:15:writable] Error: Invalid public variable toomuch, function variables that are not input/output must be protected.
// Error: Error occurred while flattening model Function2
//
// # Error encountered! Exiting...
// # Please check the error message and the flags.
//
// Execution failed!
// endResult
