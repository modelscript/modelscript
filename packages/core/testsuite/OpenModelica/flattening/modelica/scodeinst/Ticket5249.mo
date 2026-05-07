// name:     Ticket5249.mo
// keywords: tests if array binding works fine
// status:   correct
//
//

model M

  record X
    Real a;
	Real b;
  end X;
  constant Integer n = 2;
  X x[n] = {X(1, 2), X(2, 3)};
  
  model H
    X x;
  end H;
  
  H h[n](x = x);
end M;

// Result:
// Error processing file: Ticket5249.mo
// Error: Failed to load package Ticket5249 (default) using MODELICAPATH /home/omar/.openmodelica/libraries/.
// Error: Class Ticket5249.mo not found in scope <top>.
// Error: Error occurred while flattening model Ticket5249.mo
//
// # Error encountered! Exiting...
// # Please check the error message and the flags.
//
// Execution failed!
// endResult
