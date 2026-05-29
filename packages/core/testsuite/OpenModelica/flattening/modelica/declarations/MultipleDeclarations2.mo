// name:     MultipleDeclarations2
// keywords: declaration
// status:   incorrect
//
// Multiple declarations are not allowed.
//


model MultipleDeclarations2
  Real x;
  Real x;
  annotation(__OpenModelica_commandLineOptions="-d=-newInst");
end MultipleDeclarations2;

// Result:
// Error processing file: MultipleDeclarations2.mo
// # Error encountered! Exiting...
// # Please check the error message and the flags.
//
// [OpenModelica/flattening/modelica/declarations/MultipleDeclarations2.mo:10:3-10:9:writable] Error: Duplicate elements:
//  Real x.
// Error: Error occurred while flattening model MultipleDeclarations2
//
// Execution failed!
// endResult
