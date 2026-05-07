// name: ModifierTypeError
// keywords: abs
// status: incorrect
//
// Tests that type errors are caught.
//

package X
  constant Integer x = 1.0;
end X;

model A
   Integer k = X.x;
end A;

// Result:
// Error processing file: ModifierTypeError.mo
// Error: Failed to load package ModifierTypeError (default) using MODELICAPATH /home/omar/.openmodelica/libraries/.
// Error: Class ModifierTypeError not found in scope <top>.
// Error: Error occurred while flattening model ModifierTypeError
//
// # Error encountered! Exiting...
// # Please check the error message and the flags.
//
// Execution failed!
// endResult
