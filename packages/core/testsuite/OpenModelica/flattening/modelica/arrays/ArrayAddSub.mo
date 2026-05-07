// name:     ArrayAddSub
// keywords: array
// status:   incorrect
//
// Drmodelica: 7.6 Arithmetic Array Operators (p. 223)
//

class AddSub
  Real Add1 = {1, 2, 3} + 1; // Not allowed!
  Real Add2 = {1, 2, 3} + {1, 2}; // Not allowed, different array sizes!

  Real Add3[2, 2] = {{1, 1}, {2, 2}} + {{1, 2}, {3, 4}};
  // Result {{2, 3}, {5, 6}}

  Real Sub1[3] = {1, 2, 3} - {1, 2, 0};
  // Result {0, 0, 3}
end AddSub;




// Result:
// Error processing file: ArrayAddSub.mo
// Error: Failed to load package ArrayAddSub (default) using MODELICAPATH /home/omar/.openmodelica/libraries/.
// Error: Class ArrayAddSub not found in scope <top>.
// Error: Error occurred while flattening model ArrayAddSub
//
// # Error encountered! Exiting...
// # Please check the error message and the flags.
//
// Execution failed!
// endResult
