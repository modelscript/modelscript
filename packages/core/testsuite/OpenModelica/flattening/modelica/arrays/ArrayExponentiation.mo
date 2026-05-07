// name:     ArrayExponentiation
// keywords: array
// status:   correct
//
// Drmodelica: 7.6 Arithmetic Array Operators (p. 223)
//

class Exp
  Real e1[2, 2];
  Real e2[2, 2];
equation

  e1 = {{1, 2}, {1, 2}} ^ 0;
  // Result:
// Error processing file: ArrayExponentiation.mo
// Error: Failed to load package ArrayExponentiation (default) using MODELICAPATH /home/omar/.openmodelica/libraries/.
// Error: Class ArrayExponentiation not found in scope <top>.
// Error: Error occurred while flattening model ArrayExponentiation
//
// # Error encountered! Exiting...
// # Please check the error message and the flags.
//
// Execution failed!
// endResult
