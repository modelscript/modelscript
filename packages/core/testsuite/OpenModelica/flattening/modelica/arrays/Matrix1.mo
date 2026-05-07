// name:     Matrix1
// keywords: array,matrices
// status:   correct
//
// This is a simple test of basic matrix handling.
//

model test
  parameter Real K[2,2]=(Em)*{{1,-1},{-1,1}};
  parameter Real X[2]=Em*{1,2};
  parameter Real Em=1;
  parameter Real A=0.1;
  parameter Real L=4;
end test;
// Result:
// Error processing file: Matrix1.mo
// Error: Failed to load package Matrix1 (default) using MODELICAPATH /home/omar/.openmodelica/libraries/.
// Error: Class Matrix1 not found in scope <top>.
// Error: Error occurred while flattening model Matrix1
//
// # Error encountered! Exiting...
// # Please check the error message and the flags.
//
// Execution failed!
// endResult
