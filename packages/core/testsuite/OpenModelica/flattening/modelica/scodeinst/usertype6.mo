// name: usertype6.mo
// keywords:
// status: incorrect
//

type MyReal
  extends Real;
  Real y;
end MyReal;

model M
  MyReal x;
end M;

// Result:
// Error processing file: usertype6.mo
// Error: Failed to load package usertype6 (default) using MODELICAPATH /home/omar/.openmodelica/libraries/.
// Error: Class usertype6.mo not found in scope <top>.
// Error: Error occurred while flattening model usertype6.mo
//
// # Error encountered! Exiting...
// # Please check the error message and the flags.
//
// Execution failed!
// endResult
