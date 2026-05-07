// name: NonfixedParamSubscript
// keywords: parameter fixed subscript
// status: correct
//
// Tests non-fixed parameters as subscripts.
//

model M
  parameter Integer p(fixed=false,min=1,max=1);
  Real r[1];
initial equation
  p = 1;
equation
  r[p] = 2.0;
end M;

// Result:
// Error processing file: NonfixedParamSubscript.mo
// Error: Failed to load package NonfixedParamSubscript (default) using MODELICAPATH /home/omar/.openmodelica/libraries/.
// Error: Class NonfixedParamSubscript not found in scope <top>.
// Error: Error occurred while flattening model NonfixedParamSubscript
//
// # Error encountered! Exiting...
// # Please check the error message and the flags.
//
// Execution failed!
// endResult
