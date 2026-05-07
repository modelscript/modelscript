// name: VectorizeBindings2
// keywords:
// status: correct
//

model M1
  parameter Real p;
  Real x;
equation
  der(x) = 1;
end M1;

model M2
  M1 m1[10](each p = 2,
            x(each start = 1,
              each fixed = true));
  M1 m11[10,10](each p = 2);
end M2;

model M3
  M2 m2[3];
end M3;

// Result:
// Error processing file: VectorizeBindings2.mo
// Error: Failed to load package VectorizeBindings2 (default) using MODELICAPATH /home/omar/.openmodelica/libraries/.
// Error: Class VectorizeBindings2 not found in scope <top>.
// Error: Error occurred while flattening model VectorizeBindings2
//
// # Error encountered! Exiting...
// # Please check the error message and the flags.
//
// Execution failed!
// endResult
