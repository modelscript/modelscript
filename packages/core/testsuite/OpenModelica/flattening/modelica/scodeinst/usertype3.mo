// name: usertype3.mo
// keywords:
// status: correct
//

type MyReal = Real;

model M
  MyReal x;
  MyReal y(start = 1.0);
  MyReal z(start = 2.0);
end M;

// Result:
// Error processing file: usertype3.mo
// Error: Failed to load package usertype3 (default) using MODELICAPATH /home/omar/.openmodelica/libraries/.
// Error: Class usertype3.mo not found in scope <top>.
// Error: Error occurred while flattening model usertype3.mo
//
// # Error encountered! Exiting...
// # Please check the error message and the flags.
//
// Execution failed!
// endResult
