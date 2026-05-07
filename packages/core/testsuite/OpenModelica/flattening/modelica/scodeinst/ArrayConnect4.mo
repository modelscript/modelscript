// name: ArrayConnect4
// keywords:
// status: correct
//

connector Port
  Real v;
  flow Real i;
end Port;

model M
  Port port;
equation
  port.v = 10 * port.i;
end M;

model S
  parameter Integer N = 3;
  M m[N];
equation
  for i in 1:N-1 loop
    connect(m[i].port, m[i+1].port);
  end for;
end S;

// Result:
// Error processing file: ArrayConnect4.mo
// Error: Failed to load package ArrayConnect4 (default) using MODELICAPATH /home/omar/.openmodelica/libraries/.
// Error: Class ArrayConnect4 not found in scope <top>.
// Error: Error occurred while flattening model ArrayConnect4
//
// # Error encountered! Exiting...
// # Please check the error message and the flags.
//
// Execution failed!
// endResult
