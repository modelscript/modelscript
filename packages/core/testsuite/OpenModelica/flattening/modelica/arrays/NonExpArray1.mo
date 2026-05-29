// name:     Non-expanded Array1
// keywords: array
// status:   correct
//
// This is a simple test of non-expanded array handling.
//

model Array1
  parameter Integer p;
  Real x[5] = {1,2,3,4,5};
  Real y[p];
  annotation(__OpenModelica_commandLineOptions="+a -d=-newInst");
end Array1;

// Result:
// Error processing file: NonExpArray1.mo
// # Error encountered! Exiting...
// # Please check the error message and the flags.
//
// [OpenModelica/flattening/modelica/arrays/NonExpArray1.mo:10:3-10:26:writable] Error: Type mismatch in modifier of component .x, expected type Real, got modifier ={1, 2, 3, 4, 5} of type Integer[5].
// Error: Error occurred while flattening model Array1
//
// Execution failed!
// endResult
