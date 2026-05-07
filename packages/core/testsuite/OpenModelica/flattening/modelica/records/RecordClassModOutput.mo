// name: RecordClassModOutput.mo
// keywords: record, submod
// status: correct
//
// Checks that output records from functions with classmod modification get bindings
//

record R1
  Integer i1 = 10;
  Integer r1 = 10;
end R1;

function out1
  output R1 m(i1=2,r1=2);
end out1;

function out2
  output R1 m(i1=2,r1=2);
protected
  R1 mintern(i1 = 1, r1 = 1);
algorithm
  m := mintern;
end out2;

model test
   R1 m2 = R1(i1 = 9, r1 = 9);
   R1 m3 = m2;
   R1 m4 = out1();
   R1 m5 = out2();
end test;


// Result:
// Error processing file: RecordClassModOutput.mo
// Error: Failed to load package RecordClassModOutput (default) using MODELICAPATH /home/omar/.openmodelica/libraries/.
// Error: Class RecordClassModOutput.mo not found in scope <top>.
// Error: Error occurred while flattening model RecordClassModOutput.mo
//
// # Error encountered! Exiting...
// # Please check the error message and the flags.
//
// Execution failed!
// endResult
