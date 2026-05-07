// name: RedeclareElementComp4
// keywords:
// status: correct
//

model A
  replaceable Real x = 1.0;
end A;

model B
  extends A;
  redeclare replaceable parameter Real x = 2.0;
end B;  

model RedeclareElementComp3
  extends B;
  redeclare Real x = 3.0;
end RedeclareElementComp3;

// Result:
// Error processing file: RedeclareElementComp4.mo
// Error: Failed to load package RedeclareElementComp4 (default) using MODELICAPATH /home/omar/.openmodelica/libraries/.
// Error: Class RedeclareElementComp4 not found in scope <top>.
// Error: Error occurred while flattening model RedeclareElementComp4
//
// # Error encountered! Exiting...
// # Please check the error message and the flags.
//
// Execution failed!
// endResult
