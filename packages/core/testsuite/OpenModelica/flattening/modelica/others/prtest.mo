// name:     prtest
// keywords: types
// status:   incorrect
//
// Checks that subscripts are handled in a correct manner int the component clause.
//
//

class Type10
  Real[3] x[2];
  Real y[3,3];
  Real ok[3];
equation
  x = y;
  ok[1]=3.0;
end Type10;

// Result:
// Error processing file: prtest.mo
// Error: Failed to load package prtest (default) using MODELICAPATH /home/omar/.openmodelica/libraries/.
// Error: Class prtest not found in scope <top>.
// Error: Error occurred while flattening model prtest
//
// # Error encountered! Exiting...
// # Please check the error message and the flags.
//
// Execution failed!
// endResult
