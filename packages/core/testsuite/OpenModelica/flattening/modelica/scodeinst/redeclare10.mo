// name: redeclare10
// keywords:
// status: correct
//
//

package B
  constant Integer x = 1;
  constant Integer y = 3;
end B;

model C
  replaceable package A
    constant Integer x = 2;
  end A;
end C;

model D
  extends C(redeclare package A = B);

  Real x[A.y];
end D;

// Result:
// Error processing file: redeclare10.mo
// Error: Failed to load package redeclare10 (default) using MODELICAPATH /home/omar/.openmodelica/libraries/.
// Error: Class redeclare10 not found in scope <top>.
// Error: Error occurred while flattening model redeclare10
//
// # Error encountered! Exiting...
// # Please check the error message and the flags.
//
// Execution failed!
// endResult
