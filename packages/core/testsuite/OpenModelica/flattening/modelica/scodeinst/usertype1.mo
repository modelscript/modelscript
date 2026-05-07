// name: usertype1.mo
// keywords:
// status: correct
//

type MyReal = Real;

model M
  MyReal x;
end M;
// Result:
// Error processing file: usertype1.mo
// Error: Failed to load package usertype1 (default) using MODELICAPATH /home/omar/.openmodelica/libraries/.
// Error: Class usertype1.mo not found in scope <top>.
// Error: Error occurred while flattening model usertype1.mo
//
// # Error encountered! Exiting...
// # Please check the error message and the flags.
//
// Execution failed!
// endResult
