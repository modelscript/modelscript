// name: DimUnknown2
// keywords:
// status: incorrect
//


model DimUnknown2
  Real x[:];
end DimUnknown2;

// Result:
// Error processing file: DimUnknown2.mo
// [OpenModelica/flattening/modelica/scodeinst/DimUnknown2.mo:8:3-8:12:writable] Error: Failed to deduce dimension 1 of x due to missing binding equation.
// Error: Error occurred while flattening model DimUnknown2
//
// # Error encountered! Exiting...
// # Please check the error message and the flags.
//
// Execution failed!
// endResult
