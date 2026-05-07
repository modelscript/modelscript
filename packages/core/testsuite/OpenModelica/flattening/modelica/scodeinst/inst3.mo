// name: inst3.mo
// keywords:
// status: correct
//

package P
  constant Integer i = 2;

  model A
    constant Integer j = i;
  end A;
end P;

model B
  Real a[P.A.j];
end B;

// Result:
// Error processing file: inst3.mo
// Error: Failed to load package inst3 (default) using MODELICAPATH /home/omar/.openmodelica/libraries/.
// Error: Class inst3.mo not found in scope <top>.
// Error: Error occurred while flattening model inst3.mo
//
// # Error encountered! Exiting...
// # Please check the error message and the flags.
//
// Execution failed!
// endResult
