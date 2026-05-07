// name: ComponentNames2
// keywords: component
// status: correct
//
// Tests whether or not a component can have the same name as the last ident of its type specifier
//

package P
  record R
    Real x;
  end R;
end P;

model ComponentNames
  P.R R;
end ComponentNames;

// Result:
// Error processing file: ComponentNames2.mo
// Error: Failed to load package ComponentNames2 (default) using MODELICAPATH /home/omar/.openmodelica/libraries/.
// Error: Class ComponentNames2 not found in scope <top>.
// Error: Error occurred while flattening model ComponentNames2
//
// # Error encountered! Exiting...
// # Please check the error message and the flags.
//
// Execution failed!
// endResult
