// name:     Extends13
// keywords: extends
// status:   correct
//
// Testing extension of local class with the same name as the extending class.
//

model A
  Real x;
end A;

model Test
  extends Test;
  model Test
    extends A;
  end Test;
end Test;

// Result:
// Error processing file: Extends13.mo
// Error: Failed to load package Extends13 (default) using MODELICAPATH /home/omar/.openmodelica/libraries/.
// Error: Class Extends13 not found in scope <top>.
// Error: Error occurred while flattening model Extends13
//
// # Error encountered! Exiting...
// # Please check the error message and the flags.
//
// Execution failed!
// endResult
