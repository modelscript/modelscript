// name:     EnumInnerOuterDim
// keywords: enumeration enum inner outer dimension
// status:   correct
//
// Tests that inner outer arrays with enumeration dimensions are handled
// correctly.
//

type E = enumeration (A, B, C);

block Model1
  outer parameter Real[E] p1;
  parameter Real[E] p2 = p1;
end Model1;

block Model2
  inner parameter Real[E] p1;
  Model1 m1;
end Model2;

// Result:
// Error processing file: EnumInnerOuterDim.mo
// [<interactive>:17:3-17:29:writable] Error: Parameter p1 has neither value nor start value, and is fixed during initialization (fixed=true).
// Error: Error occurred while flattening model Model2
//
// # Error encountered! Exiting...
// # Please check the error message and the flags.
//
// Execution failed!
// endResult
