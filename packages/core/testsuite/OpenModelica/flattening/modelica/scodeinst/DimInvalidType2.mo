// name: DimInvalidType2
// keywords:
// status: incorrect
//

model DimInvalidType2
  Real x[{1, 2, 3}];
end DimInvalidType2;

// Result:
// Error processing file: DimInvalidType2.mo
// [OpenModelica/flattening/modelica/scodeinst/DimInvalidType2.mo:7:3-7:20:writable] Error: Dimension '{1, 2, 3}' of type Integer[3] is not an integer expression or an enumeration or Boolean type name.
// Error: Error occurred while flattening model DimInvalidType2
//
// # Error encountered! Exiting...
// # Please check the error message and the flags.
//
// Execution failed!
// endResult
