// name:     ExtendsDerived.mo
// keywords: extends modifier handling
// status:   correct
//
// check that modifiers on derived classes which are extended are not lost
//


package B
  model X = Y(k=u);
  model Y
    parameter Real k = 2;
    parameter Real z = 10;
  end Y;
  constant Real u = 10;
end B;

model A
 extends B.X(z = 15);
end A;

// Result:
// Error processing file: ExtendsDerived.mo
// Error: Failed to load package ExtendsDerived (default) using MODELICAPATH /home/omar/.openmodelica/libraries/.
// Error: Class ExtendsDerived.mo not found in scope <top>.
// Error: Error occurred while flattening model ExtendsDerived.mo
//
// # Error encountered! Exiting...
// # Please check the error message and the flags.
//
// Execution failed!
// endResult
