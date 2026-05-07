// name: FuncBuiltinPromoteInvalid1
// keywords: sum
// status: incorrect
//
// Tests the builtin promote operator.
//

model FuncBuiltinPromoteInvalid1
  Real y[2, 2];
  Real r[:] = promote(y, 1);
end FuncBuiltinPromoteInvalid1;

// Result:
// Error processing file: FuncBuiltinPromoteInvalid1.mo
// [OpenModelica/flattening/modelica/scodeinst/FuncBuiltinPromoteInvalid1.mo:10:3-10:28:writable] Error: promote is an experimental feature and requires the --std=experimental flag.
// Error: Error occurred while flattening model FuncBuiltinPromoteInvalid1
//
// # Error encountered! Exiting...
// # Please check the error message and the flags.
//
// Execution failed!
// endResult
