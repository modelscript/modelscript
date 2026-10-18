// name:     Non-expanded Array - Modification 2
// keywords: array
// status:   incorrect
//
// A test of modification processing in the case of non-expanded arrays.
// Does not work for now since parameter p is not in the same scope as modification x=0.
//

class A
  Real x;
end A;

class B
  A a(x=0);
end B;

model Modif2
  parameter Integer p;
  B[p] b;
  annotation(__OpenModelica_commandLineOptions="+a -d=-newInst");
end Modif2;


// Result:
// Error processing file: NonExpModif2.mo
// # Error encountered! Exiting...
// # Please check the error message and the flags.
//
// Error: Error occurred while flattening model Modif2
//
// Execution failed!
// endResult
