// name:     ForLoopHideVariable
// keywords: for statment
// status:   correct
//
// for statment handling
// Drmodelica: 9.1 for-Statement (p.288)
//

model HideVariable
  constant Integer k = 4;
  Real z[k + 1];
algorithm
  for k in 1:k+1 loop // The iteration variable k gets values 1, 2, 3, 4, 5
    z[k] := k;
  end for;
end HideVariable;

// Result:
// Error processing file: ForLoopHideVariable.mo
// Error: Failed to load package ForLoopHideVariable (default) using MODELICAPATH /home/omar/.openmodelica/libraries/.
// Error: Class ForLoopHideVariable not found in scope <top>.
// Error: Error occurred while flattening model ForLoopHideVariable
//
// # Error encountered! Exiting...
// # Please check the error message and the flags.
//
// Execution failed!
// endResult
