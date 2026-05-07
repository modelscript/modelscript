// name: DimNegative1
// keywords:
// status: correct
//

model DimNegative2
  Real x[-1] if false;
end DimNegative2;

// Result:
// Error processing file: DimNegative2.mo
// Error: Failed to load package DimNegative1 (default) using MODELICAPATH /home/omar/.openmodelica/libraries/.
// Error: Class DimNegative1 not found in scope <top>.
// Error: Error occurred while flattening model DimNegative1
//
// # Error encountered! Exiting...
// # Please check the error message and the flags.
//
// Execution failed!
// endResult
