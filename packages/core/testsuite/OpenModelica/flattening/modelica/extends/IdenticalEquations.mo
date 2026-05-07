// name:     IdenticalEquations
// keywords: identical equations inheritance
// status:   correct
//
// Checks that identical equations from inheritance are not merged.
//

class Color
  parameter Real red=0.2;
  parameter Real blue=0.6;
  Real green;
equation
  red + blue + green = 1;
end Color;

class Color2
  extends Color;
equation
  red + blue + green = 1;
end Color2;

// Result:
// Error processing file: IdenticalEquations.mo
// Error: Failed to load package IdenticalEquations (default) using MODELICAPATH /home/omar/.openmodelica/libraries/.
// Error: Class IdenticalEquations not found in scope <top>.
// Error: Error occurred while flattening model IdenticalEquations
//
// # Error encountered! Exiting...
// # Please check the error message and the flags.
//
// Execution failed!
// endResult
