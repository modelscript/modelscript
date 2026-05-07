// status: correct

model BooleanEnumDims
  type E = enumeration(False,True);
  Real r[Boolean,E];
equation
  r[false,E.False] = 1.5;
  r[false,E.True] = 1.5;
  r[true,E.False] = 3.5;
  r[true,E.True] = 4.5;
end BooleanEnumDims;
// Result:
// Error processing file: BooleanEnumDims.mo
// Error: Failed to load package E (default) using MODELICAPATH /home/omar/.openmodelica/libraries/.
// Error: Class E not found in scope <top>.
// Error: Error occurred while flattening model E
//
// # Error encountered! Exiting...
// # Please check the error message and the flags.
//
// Execution failed!
// endResult
