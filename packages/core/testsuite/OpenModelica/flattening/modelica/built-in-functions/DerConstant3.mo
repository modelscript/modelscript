// name:     DerConstant3
// keywords: derivative
// status:   incorrect
//
// Operator der cannot be applied to Integer expressions which are not constant or parametric
//

class A
  discrete Integer pa = 1;
  Real a = der(pa);
end A;
// Result:
// Error processing file: DerConstant3.mo
// Error: Failed to load package DerConstant3 (default) using MODELICAPATH /home/omar/.openmodelica/libraries/.
// Error: Class DerConstant3 not found in scope <top>.
// Error: Error occurred while flattening model DerConstant3
//
// # Error encountered! Exiting...
// # Please check the error message and the flags.
//
// Execution failed!
// endResult
