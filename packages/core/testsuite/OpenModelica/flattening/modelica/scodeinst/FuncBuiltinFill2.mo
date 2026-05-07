// name: FuncBuiltinFill2
// keywords: fill
// status: incorrect
//
// Tests the builtin fill operator.
//

model FuncBuiltinFill2
  Integer n = 3;
  Real x[1, 3] = fill(0, 1, n);
end FuncBuiltinFill2;

// Result:
// Error processing file: FuncBuiltinFill2.mo
// [OpenModelica/flattening/modelica/scodeinst/FuncBuiltinFill2.mo:10:3-10:31:writable] Error: Expression 'n' that determines the size of dimension '2' of 'fill(0, 1, n)' is not an evaluable parameter expression.
// Error: Error occurred while flattening model FuncBuiltinFill2
//
// # Error encountered! Exiting...
// # Please check the error message and the flags.
//
// Execution failed!
// endResult
