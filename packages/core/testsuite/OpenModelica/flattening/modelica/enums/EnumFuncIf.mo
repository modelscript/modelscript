// name:     EnumRange
// keywords: enumeration enum range reduction
// status:   correct
//
// Tests that enum dimensions are used properly when an if-expression containing
// a function call is expanded.
//

function f
  input Real x;
  output Boolean out;
algorithm
end f;

type E = enumeration(A, B, C);

model EnumFuncIf
  Real x[E];
  Real y;
equation
  x = if f(y) then zeros(size(E, 1)) else x / y;
end EnumFuncIf;

// Result:
// Error processing file: EnumFuncIf.mo
// Error: Failed to load package EnumRange (default) using MODELICAPATH /home/omar/.openmodelica/libraries/.
// Error: Class EnumRange not found in scope <top>.
// Error: Error occurred while flattening model EnumRange
//
// # Error encountered! Exiting...
// # Please check the error message and the flags.
//
// Execution failed!
// endResult
