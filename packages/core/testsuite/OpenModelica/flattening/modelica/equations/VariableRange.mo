// name:     VariableRange
// keywords: equation, range, variable
// status:   incorrect
//
// Checks that variable ranges are not allowed in for-equations.
//

model M
  Real x, y;
equation
  for i in 1:x loop
    y = i;
  end for;
end M;

// Result:
// Error processing file: VariableRange.mo
// Error: Failed to load package VariableRange (default) using MODELICAPATH /home/omar/.openmodelica/libraries/.
// Error: Class VariableRange not found in scope <top>.
// Error: Error occurred while flattening model VariableRange
//
// # Error encountered! Exiting...
// # Please check the error message and the flags.
//
// Execution failed!
// endResult
