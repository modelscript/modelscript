// name:     Delay3
// keywords: builtin
// status:   correct
//
// Test builtin function delay.
//

model Delay
  Real x;
  Integer y;
equation
  x = 0;
  y = delay(x, 2.5);
end Delay;

// Result:
// Error processing file: Delay3.mo
// Error: Failed to load package Delay3 (default) using MODELICAPATH /home/omar/.openmodelica/libraries/.
// Error: Class Delay3 not found in scope <top>.
// Error: Error occurred while flattening model Delay3
//
// # Error encountered! Exiting...
// # Please check the error message and the flags.
//
// Execution failed!
// endResult
