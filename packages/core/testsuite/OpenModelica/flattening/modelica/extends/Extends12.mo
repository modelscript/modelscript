// name:     Extends12
// keywords: extends
// status:   correct
//
// Testing extends clauses

package Package1
  model Model2
    Real x;
  end Model2;
end Package1;

model Model1
  package Package2 = Package1;
  extends Package2.Model2;
end Model1;

// Result:
// Error processing file: Extends12.mo
// Error: Failed to load package Extends12 (default) using MODELICAPATH /home/omar/.openmodelica/libraries/.
// Error: Class Extends12 not found in scope <top>.
// Error: Error occurred while flattening model Extends12
//
// # Error encountered! Exiting...
// # Please check the error message and the flags.
//
// Execution failed!
// endResult
