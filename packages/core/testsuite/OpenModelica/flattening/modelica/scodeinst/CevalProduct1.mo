// name: CevalCross1
// keywords:
// status: correct
//
//

model CevalProduct1
  constant Real r1 = product({{{1.0, 2.0}, {3.0, 4.0}}, {{5.0, 6.0}, {7.0, 8.0}}});
  constant Integer i1 = product({1, 2, 3, 4, 5, 6, 7, 8});
end CevalProduct1;

// Result:
// Error processing file: CevalProduct1.mo
// Error: Failed to load package CevalCross1 (default) using MODELICAPATH /home/omar/.openmodelica/libraries/.
// Error: Class CevalCross1 not found in scope <top>.
// Error: Error occurred while flattening model CevalCross1
//
// # Error encountered! Exiting...
// # Please check the error message and the flags.
//
// Execution failed!
// endResult
