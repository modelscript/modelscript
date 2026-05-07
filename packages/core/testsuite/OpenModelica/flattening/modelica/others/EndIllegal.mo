// name: EndIllegal
// status: incorrect

model M
  Real r = end;
end M;

// Result:
// Error processing file: EndIllegal.mo
// Error: Failed to load package EndIllegal (default) using MODELICAPATH /home/omar/.openmodelica/libraries/.
// Error: Class EndIllegal not found in scope <top>.
// Error: Error occurred while flattening model EndIllegal
//
// # Error encountered! Exiting...
// # Please check the error message and the flags.
//
// Execution failed!
// endResult
