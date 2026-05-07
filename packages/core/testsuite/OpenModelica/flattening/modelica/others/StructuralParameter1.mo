// name:     StructuralParameter1
// keywords: parameter, array
// status:   correct
//
// This is a test of structural parameters. A structural parameter is a
// parameter that affects the structure of the model, i.e. used in array
// dimensions of components.
//

model StructuralParam
  parameter Integer m=n;

  parameter Integer n=1;
   Real x[m],y[m];
equation
x=y;
end StructuralParam;

// Result:
// Error processing file: StructuralParameter1.mo
// Error: Failed to load package StructuralParameter1 (default) using MODELICAPATH /home/omar/.openmodelica/libraries/.
// Error: Class StructuralParameter1 not found in scope <top>.
// Error: Error occurred while flattening model StructuralParameter1
//
// # Error encountered! Exiting...
// # Please check the error message and the flags.
//
// Execution failed!
// endResult
