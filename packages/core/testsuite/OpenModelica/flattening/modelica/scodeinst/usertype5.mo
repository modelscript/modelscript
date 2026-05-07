// name: usertype5.mo
// keywords:
// status: correct
//

type MyReal
  extends Real;
end MyReal;

model M
  MyReal x;
end M;

// Result:
// Error processing file: usertype5.mo
// Error: Failed to load package usertype5 (default) using MODELICAPATH /home/omar/.openmodelica/libraries/.
// Error: Class usertype5.mo not found in scope <top>.
// Error: Error occurred while flattening model usertype5.mo
//
// # Error encountered! Exiting...
// # Please check the error message and the flags.
//
// Execution failed!
// endResult
