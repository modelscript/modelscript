// name: eq6.mo
// keywords:
// status: correct
//

package P
  model A
    Real x;
  equation
    x = i;
  end A;

  constant Integer i = 2;
end P;

model B
  P.A a[3];
end B;

// Result:
// Error processing file: eq6.mo
// Error: Failed to load package eq6 (default) using MODELICAPATH /home/omar/.openmodelica/libraries/.
// Error: Class eq6.mo not found in scope <top>.
// Error: Error occurred while flattening model eq6.mo
//
// # Error encountered! Exiting...
// # Please check the error message and the flags.
//
// Execution failed!
// endResult
