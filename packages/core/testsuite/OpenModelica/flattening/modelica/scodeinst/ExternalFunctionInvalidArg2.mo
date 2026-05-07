// name: ExternalFunctionInvalidArg2
// keywords:
// status: incorrect
//
//

function f
  input Real x[:];
  input Integer n;
  output Real y;
  external y = f(size(x, n));
end f;

model ExternalFunctionInvalidArg2
  Real x;
  Integer n;
algorithm
  x := f({1, 2, 3}, n);
end ExternalFunctionInvalidArg2;

// Result:
// Error processing file: ExternalFunctionInvalidArg2.mo
// [OpenModelica/flattening/modelica/scodeinst/ExternalFunctionInvalidArg2.mo:7:1-12:6:writable] Error: Invalid external argument 'size(x, n)', the dimension index must be a constant expression.
// Error: Error occurred while flattening model ExternalFunctionInvalidArg2
//
// # Error encountered! Exiting...
// # Please check the error message and the flags.
//
// Execution failed!
// endResult
