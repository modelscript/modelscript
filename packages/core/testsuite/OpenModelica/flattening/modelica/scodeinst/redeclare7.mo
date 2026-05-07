// name: redeclare7.mo
// keywords:
// status: correct
//
//


model C
  replaceable package P = P1;
  Real z = P.x;
end C;

package P1
  constant Real x = 1;
end P1;

package P2
  constant Real x = 2;
end P2;

model D
  C b(redeclare package P = P2);
end D;

// Result:
// Error processing file: redeclare7.mo
// Error: Failed to load package redeclare7 (default) using MODELICAPATH /home/omar/.openmodelica/libraries/.
// Error: Class redeclare7.mo not found in scope <top>.
// Error: Error occurred while flattening model redeclare7.mo
//
// # Error encountered! Exiting...
// # Please check the error message and the flags.
//
// Execution failed!
// endResult
