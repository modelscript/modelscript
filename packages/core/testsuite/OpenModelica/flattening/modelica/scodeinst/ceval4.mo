// name: ceval4.mo
// status: correct

model A
  function f
    input Integer i;
    output Integer j=i+1;
  end f;

  parameter Integer n = 1;
  parameter Integer m = f(n)+n;
  Real x[m] = {1.0, 1.0, 1.0}; //fill(1.0, m);
end A;

// Result:
// Error processing file: ceval4.mo
// Error: Failed to load package ceval4 (default) using MODELICAPATH /home/omar/.openmodelica/libraries/.
// Error: Class ceval4.mo not found in scope <top>.
// Error: Error occurred while flattening model ceval4.mo
//
// # Error encountered! Exiting...
// # Please check the error message and the flags.
//
// Execution failed!
// endResult
