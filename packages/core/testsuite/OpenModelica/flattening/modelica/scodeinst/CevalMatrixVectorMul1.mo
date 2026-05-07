// name: CevalVectorMatrixMul1
// keywords:
// status: correct
//
//

model CevalMatrixVectorMul1
  constant Real m1[3, 3] = {{1, 2, 3}, {4, 5, 6}, {7, 8, 9}};
  constant Real v1[3] = {3, 6, 9};
  constant Real m2[:] = m1 * v1;
end CevalMatrixVectorMul1;

// Result:
// Error processing file: CevalMatrixVectorMul1.mo
// Error: Failed to load package CevalVectorMatrixMul1 (default) using MODELICAPATH /home/omar/.openmodelica/libraries/.
// Error: Class CevalVectorMatrixMul1 not found in scope <top>.
// Error: Error occurred while flattening model CevalVectorMatrixMul1
//
// # Error encountered! Exiting...
// # Please check the error message and the flags.
//
// Execution failed!
// endResult
