// name: ClassExtends1.mo
// keywords:
// status: incorrect
//
// Checks that a proper error message is given when no inherited element is found for a class extends.
//

model ClassExtendsMissing1
  redeclare model extends B
    Real y = 2.0;
  end B;

  B b;
end ClassExtendsMissing1;

// Result:
// Error processing file: ClassExtendsMissing1.mo
// Error: Failed to load package ClassExtends1 (default) using MODELICAPATH /home/omar/.openmodelica/libraries/.
// Error: Class ClassExtends1.mo not found in scope <top>.
// Error: Error occurred while flattening model ClassExtends1.mo
//
// # Error encountered! Exiting...
// # Please check the error message and the flags.
//
// Execution failed!
// endResult
