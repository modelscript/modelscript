// name: ih3.mo
// keywords:
// status: correct
//
//

package P
  package P
    constant Integer i;
  end P;

  package P1 = P(i = 2);
  package P2 = P(i = 3);

  model A
    Integer i1 = P1.i;
    Integer i2 = P2.i;
  end A;
end P;

model A
  extends P.A;
end A;

// Result:
// Error processing file: ih3.mo
// Error: Failed to load package ih3 (default) using MODELICAPATH /home/omar/.openmodelica/libraries/.
// Error: Class ih3.mo not found in scope <top>.
// Error: Error occurred while flattening model ih3.mo
//
// # Error encountered! Exiting...
// # Please check the error message and the flags.
//
// Execution failed!
// endResult
