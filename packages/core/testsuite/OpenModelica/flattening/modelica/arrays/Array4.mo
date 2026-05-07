// name:     Array4
// keywords: array
// status:   correct
//
// This is a test of arrays of arrays.  The type T2 is equivalent or
// similar to Real[2,3].
//

model Array4
  type T1 = Real[3];
  type T2 = T1[2];
  parameter T2 x;
end Array4;

// Result:
// Error processing file: Array4.mo
// [OpenModelica/flattening/modelica/arrays/Array4.mo:12:3-12:17:writable] Error: Parameter x has neither value nor start value, and is fixed during initialization (fixed=true).
// Error: Error occurred while flattening model Array4
//
// # Error encountered! Exiting...
// # Please check the error message and the flags.
//
// Execution failed!
// endResult
