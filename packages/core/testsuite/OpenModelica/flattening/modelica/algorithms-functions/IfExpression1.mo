// name:     IfExpression1
// keywords: if expression
// status:   correct
//
// Checks that if-expressions with arrays of different size is handled correctly
// in functions.
//

function f
  input Integer n;
  output Real x[:] = if n == 1 then {1} else {1, 2};
end f;

model M
  Real x[:] = f(2);
end M;

// Result:
// Error processing file: IfExpression1.mo
// Error: Failed to load package IfExpression1 (default) using MODELICAPATH /home/omar/.openmodelica/libraries/.
// Error: Class IfExpression1 not found in scope <top>.
// Error: Error occurred while flattening model IfExpression1
//
// # Error encountered! Exiting...
// # Please check the error message and the flags.
//
// Execution failed!
// endResult
