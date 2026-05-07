// name: usertype2.mo
// keywords:
// status: correct
//

type MyReal = Real(start = 1.0);

model M
  MyReal x;
  Real y(start = 1.0);
end M;

// Result:
// Error processing file: usertype2.mo
// Error: Failed to load package usertype2 (default) using MODELICAPATH /home/omar/.openmodelica/libraries/.
// Error: Class usertype2.mo not found in scope <top>.
// Error: Error occurred while flattening model usertype2.mo
//
// # Error encountered! Exiting...
// # Please check the error message and the flags.
//
// Execution failed!
// endResult
