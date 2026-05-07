// name:     modelica_1_1_Type10
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
// Error processing file: modelica_1_1_Type10.mo
// Error: Failed to load package modelica_1_1_Type10 (default) using MODELICAPATH /home/omar/.openmodelica/libraries/.
// Error: Class modelica_1_1_Type10 not found in scope <top>.
// Error: Error occurred while flattening model modelica_1_1_Type10
//
// # Error encountered! Exiting...
// # Please check the error message and the flags.
//
// Execution failed!
// endResult
