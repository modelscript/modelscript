// name:     Transpose2
// keywords: transpose flattening ceval
// status:   correct
//
// Tests fix for bug #1210: http://openmodelica.ida.liu.se:8080/cb/issue/1210
//

class bug1210
  constant Real i[2,2] = transpose({{1.1,2.2},{3.3,4.4}});
  Real r;
equation
  r = i[2,2];
end bug1210;

// Result:
// Error processing file: Transpose2.mo
// Error: Failed to load package Transpose2 (default) using MODELICAPATH /home/omar/.openmodelica/libraries/.
// Error: Class Transpose2 not found in scope <top>.
// Error: Error occurred while flattening model Transpose2
//
// # Error encountered! Exiting...
// # Please check the error message and the flags.
//
// Execution failed!
// endResult
