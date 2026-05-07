// name:     Delay2
// keywords: builtin
// status:   correct
//
// Test flattening of the builtin function delay.
// Expression value is cast into Real.
//

model Delay
  Real x;
  Integer y;
equation
  y = 0;
  x = delay(y+1, 2.5);
end Delay;

// Result:
// Error processing file: Delay2.mo
// Error: Failed to load package Delay2 (default) using MODELICAPATH /home/omar/.openmodelica/libraries/.
// Error: Class Delay2 not found in scope <top>.
// Error: Error occurred while flattening model Delay2
//
// # Error encountered! Exiting...
// # Please check the error message and the flags.
//
// Execution failed!
// endResult
