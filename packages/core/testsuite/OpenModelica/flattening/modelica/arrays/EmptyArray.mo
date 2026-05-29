// name:     EmptyArray
// keywords: array, constructor, empty
// status:   incorrect
//
// Checks that empty array constructors are not allowed, as per 10.4 in the
// Modelica 3.2 specification.
//

model EmptyArray
  Real r[:] = {};
  annotation(__OpenModelica_commandLineOptions="-d=-newInst");
end EmptyArray;

// Result:
// Error processing file: EmptyArray.mo
// # Error encountered! Exiting...
// # Please check the error message and the flags.
// Failed to parse file: OpenModelica/flattening/modelica/arrays/EmptyArray.mo!
//
// Failed to parse file: OpenModelica/flattening/modelica/arrays/EmptyArray.mo!
//
// [OpenModelica/flattening/modelica/arrays/EmptyArray.mo:10:15-10:16:writable] Error: Parse error: Empty array constructors are not valid in Modelica.
//
// Execution failed!
// endResult
