// name: SimpleInheritance
// keywords: class, inheritance
// status: correct
//
// Tests simple inheritance using the extends keyword
//

class C1
  Integer i1;
end C1;

class C2
  extends C1;
  Integer i2;
end C2;

// Result:
// Error processing file: SimpleInheritance.mo
// Error: Failed to load package SimpleInheritance (default) using MODELICAPATH /home/omar/.openmodelica/libraries/.
// Error: Class SimpleInheritance not found in scope <top>.
// Error: Error occurred while flattening model SimpleInheritance
//
// # Error encountered! Exiting...
// # Please check the error message and the flags.
//
// Execution failed!
// endResult
