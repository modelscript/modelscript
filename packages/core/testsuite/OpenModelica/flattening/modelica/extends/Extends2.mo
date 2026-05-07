// name:     Extends2
// keywords: extends
// status:   correct
//
// Testing extends clauses, and encapsulated models. MathCore bug #372

package B

   type W=Real;
end B;

model A
  Adapter adapter;

protected
 encapsulated model Adapter
   import B.W;
     W x;
  end Adapter;
end A;

model test2
  extends A;
end test2;

// Result:
// Error processing file: Extends2.mo
// Error: Failed to load package Extends2 (default) using MODELICAPATH /home/omar/.openmodelica/libraries/.
// Error: Class Extends2 not found in scope <top>.
// Error: Error occurred while flattening model Extends2
//
// # Error encountered! Exiting...
// # Please check the error message and the flags.
//
// Execution failed!
// endResult
