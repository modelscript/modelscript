// name: FuncBuiltinPromote
// keywords: sum
// status: correct
//
// Tests the builtin promote operator.
//

model FuncBuiltinPromote
  Real x;
  Real y[2, 2];
  Real r1 = promote(x, 0);
  Real r2[:] = promote(x, 1);
  Real r3[:, :] = promote(x, 2);
  Real r5[:, :] = promote(y, 2);
  Real r6[:, :, :] = promote(y, 3);
end FuncBuiltinPromote;

// Result:
// Error processing file: FuncBuiltinPromote.mo
// [OpenModelica/flattening/modelica/scodeinst/FuncBuiltinPromote.mo:12:3-12:29:writable] Error: promote is an experimental feature and requires the --std=experimental flag.
// Error: Error occurred while flattening model FuncBuiltinPromote
//
// # Error encountered! Exiting...
// # Please check the error message and the flags.
//
// Execution failed!
// endResult
