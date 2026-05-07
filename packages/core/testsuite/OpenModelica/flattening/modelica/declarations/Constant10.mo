// name:     Constant10
// keywords: constant, package
// status:   correct
//
// Constants in packages can lead to infinite recursion in lookup.
// In example below, the package A would be instantiated over and over again unless this is caught by
// investigating current scope.


package A
  constant Real x=1;
  constant Real y=A.x;
end A;

model test
  Real x=A.y;
end test;

// Result:
// Error processing file: Constant10.mo
// Error: Failed to load package Constant10 (default) using MODELICAPATH /home/omar/.openmodelica/libraries/.
// Error: Class Constant10 not found in scope <top>.
// Error: Error occurred while flattening model Constant10
//
// # Error encountered! Exiting...
// # Please check the error message and the flags.
//
// Execution failed!
// endResult
