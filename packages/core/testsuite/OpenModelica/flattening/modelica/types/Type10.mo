// name:     Type10
// keywords: types
// status:   correct
//
// This checks that types can be written using long class definition too.
//

type TypeInteger
  extends Integer(min=0,max=10);
end TypeInteger;

type Integer2
  extends TypeInteger(max=9);
end Integer2;

model test
  Integer2 t;
  Integer2 t2(max=8);
  TypeInteger t3;
end test;

// Result:
// Error processing file: Type10.mo
// Error: Failed to load package Type10 (default) using MODELICAPATH /home/omar/.openmodelica/libraries/.
// Error: Class Type10 not found in scope <top>.
// Error: Error occurred while flattening model Type10
//
// # Error encountered! Exiting...
// # Please check the error message and the flags.
//
// Execution failed!
// endResult
