// name:     Type8
// keywords: types
// status:   incorrect
//
// This checks that Real and RealType are handled differently
//

class Type8
  Real x;
equation
  x = x.start;
  annotation(__OpenModelica_commandLineOptions="-d=-newInst");
end Type8;
// Result:
// Error processing file: Type8.mo
// # Error encountered! Exiting...
// # Please check the error message and the flags.
//
// [OpenModelica/flattening/modelica/types/Type8.mo:11:7-11:14:writable] Error: Variable 'x.start' not found in scope.
// Error: Error occurred while flattening model Type8
//
// Execution failed!
// endResult
