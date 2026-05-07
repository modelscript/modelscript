// name: Connect13
// keywords:  connector, array components
// status: correct
//
// Test that arrays can be used n connectors.
//
connector dq_0
  Real u_dq0[3];
  flow Real i_dq0[3];
end dq_0;


model test
  dq_0 p,n;
equation
end test;
model test2
  test t1,t2;
equation
connect(t1.n,t2.p);
connect(t2.n,t1.p);
end test2;
// Result:
// Error processing file: Connect13.mo
// Error: Failed to load package Connect13 (default) using MODELICAPATH /home/omar/.openmodelica/libraries/.
// Error: Class Connect13 not found in scope <top>.
// Error: Error occurred while flattening model Connect13
//
// # Error encountered! Exiting...
// # Please check the error message and the flags.
//
// Execution failed!
// endResult
