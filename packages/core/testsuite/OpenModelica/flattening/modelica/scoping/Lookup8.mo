// name:     Lookup8
// keywords: scoping
// status:   incorrect
//
// A component is not allowed to have the same name as its type specifier.
//


model Cytosol
  Real V = 1;
end Cytosol;

model Test
  Real Cytosol_V=Cytosol.V;
  Cytosol Cytosol;
end Test;

// Result:
// Error processing file: Lookup8.mo
// Error: Failed to load package Lookup8 (default) using MODELICAPATH /home/omar/.openmodelica/libraries/.
// Error: Class Lookup8 not found in scope <top>.
// Error: Error occurred while flattening model Lookup8
//
// # Error encountered! Exiting...
// # Please check the error message and the flags.
//
// Execution failed!
// endResult
