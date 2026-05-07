// name: DimInvalidExp3
// keywords:
// status: incorrect
//

model DimInvalidExp3
  Real x[size(y, 1)];
  Real y[:];
end DimInvalidExp3;

// Result:
// Error processing file: DimInvalidExp3.mo
// [OpenModelica/flattening/modelica/scodeinst/DimInvalidExp3.mo:8:3-8:12:writable] Error: Failed to deduce dimension 1 of y due to missing binding equation.
// Error: Error occurred while flattening model DimInvalidExp3
//
// # Error encountered! Exiting...
// # Please check the error message and the flags.
//
// Execution failed!
// endResult
