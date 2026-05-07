// name:     FunctionReturn
// keywords: function return
// status:   correct
//
// This tests return in function

function f
  input Real x;
  output Real y;
  output Real z;
algorithm
  y := x * 2;
  z := x * 3;
end f;

model FunctionMultiReturn
  Real x = f(3);
  Real y;
equation
  y = f(4);
end FunctionMultiReturn;

// Result:
// Error processing file: FunctionMultiReturn.mo
// Error: Failed to load package FunctionReturn (default) using MODELICAPATH /home/omar/.openmodelica/libraries/.
// Error: Class FunctionReturn not found in scope <top>.
// Error: Error occurred while flattening model FunctionReturn
//
// # Error encountered! Exiting...
// # Please check the error message and the flags.
//
// Execution failed!
// endResult
