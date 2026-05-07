// name:     Delay6
// keywords: builtin
// status:   correct
//
// Test flattening of the builtin function delay.
//

model Delay
  Real x, y;
  Real a = 1.0;
  constant Real b=2.0;
equation
  x = sin(time);
  y = delay(x, a, b);
end Delay;

// Result:
// Error processing file: Delay6.mo
// Error: Failed to load package Delay6 (default) using MODELICAPATH /home/omar/.openmodelica/libraries/.
// Error: Class Delay6 not found in scope <top>.
// Error: Error occurred while flattening model Delay6
//
// # Error encountered! Exiting...
// # Please check the error message and the flags.
//
// Execution failed!
// endResult
