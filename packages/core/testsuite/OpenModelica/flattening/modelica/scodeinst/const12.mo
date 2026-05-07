// name: const12
// keywords:
// status: correct
//
//

package A
  model M
    constant Integer i[3] = {1, 2, 3};
  end M;

  constant M m[3];
end A;

model B
  constant Integer j = A.m[1].i[2];
  Real x = j;
end B;

// Result:
// Error processing file: const12.mo
// Error: Failed to load package const12 (default) using MODELICAPATH /home/omar/.openmodelica/libraries/.
// Error: Class const12 not found in scope <top>.
// Error: Error occurred while flattening model const12
//
// # Error encountered! Exiting...
// # Please check the error message and the flags.
//
// Execution failed!
// endResult
