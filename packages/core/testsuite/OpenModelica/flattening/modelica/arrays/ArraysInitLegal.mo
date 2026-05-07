// name:     ArraysInitLegal
// keywords: <insert keywords here>
// status:   correct
//
// Test the public and protected access keywords
// Drmodelica: 3.2 Initialized (p. 94)
//
class ArraysInit
  Real A3[2, 2];
   // Array variable
  Real A4[2, 2](start = {{1, 0}, {0, 1}});
   // Array with explicit start value
end ArraysInit;

// Result:
// Error processing file: ArraysInitLegal.mo
// Error: Failed to load package ArraysInitLegal (default) using MODELICAPATH /home/omar/.openmodelica/libraries/.
// Error: Class ArraysInitLegal not found in scope <top>.
// Error: Error occurred while flattening model ArraysInitLegal
//
// # Error encountered! Exiting...
// # Please check the error message and the flags.
//
// Execution failed!
// endResult
