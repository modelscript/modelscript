// name:     Delay5
// keywords: builtin
// status:   incorrect
//
// Test flattening of the builtin function delay.
// Should issue an error as a is not parameter/constant.
//

model Delay
  Real x, y, z;
  Real a=1.0;
equation
  x = sin(time);
  y = delay(x, a);
  z = delay(x, a, a);
end Delay;

// Result:
// Error processing file: Delay5.mo
// Error: Failed to load package Delay5 (default) using MODELICAPATH /home/omar/.openmodelica/libraries/.
// Error: Class Delay5 not found in scope <top>.
// Error: Error occurred while flattening model Delay5
//
// # Error encountered! Exiting...
// # Please check the error message and the flags.
//
// Execution failed!
// endResult
