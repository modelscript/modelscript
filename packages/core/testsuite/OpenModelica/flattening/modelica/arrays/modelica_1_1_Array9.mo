// name:     modelica_1_1_Array9
// keywords: array, construction
// status:   correct
//
//

model Array9
  Real x[2]={1,2};
//  Real y[2,3]={{1,2,3},{4,5,6}};
end Array9;

// Result:
// Error processing file: modelica_1_1_Array9.mo
// Error: Failed to load package modelica_1_1_Array9 (default) using MODELICAPATH /home/omar/.openmodelica/libraries/.
// Error: Class modelica_1_1_Array9 not found in scope <top>.
// Error: Error occurred while flattening model modelica_1_1_Array9
//
// # Error encountered! Exiting...
// # Please check the error message and the flags.
//
// Execution failed!
// endResult
