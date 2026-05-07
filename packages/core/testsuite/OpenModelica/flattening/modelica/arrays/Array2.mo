// name:     Array2
// keywords: array
// status:   correct
//
// Multidimensional arrays
//

model Array2
  parameter Integer x[2,3];
end Array2;

// Result:
// Error processing file: Array2.mo
// [OpenModelica/flattening/modelica/arrays/Array2.mo:9:3-9:27:writable] Error: Parameter x has neither value nor start value, and is fixed during initialization (fixed=true).
// Error: Error occurred while flattening model Array2
//
// # Error encountered! Exiting...
// # Please check the error message and the flags.
//
// Execution failed!
// endResult
