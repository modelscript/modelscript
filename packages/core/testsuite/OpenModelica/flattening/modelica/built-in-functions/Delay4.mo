// name:     Delay4
// keywords: builtin
// status:   correct
//
// Test flattening of the builtin function delay.
// Use of a parameter variable for the delay.
//

model Delay
  Real x, y;
  parameter Real a=1.0;
equation
  a = 1.0;
  x = sin(time);
  y = delay(x, a);
end Delay;

// Result:
// Error processing file: Delay4.mo
// Error: Failed to load package Delay4 (default) using MODELICAPATH /home/omar/.openmodelica/libraries/.
// Error: Class Delay4 not found in scope <top>.
// Error: Error occurred while flattening model Delay4
//
// # Error encountered! Exiting...
// # Please check the error message and the flags.
//
// Execution failed!
// endResult
