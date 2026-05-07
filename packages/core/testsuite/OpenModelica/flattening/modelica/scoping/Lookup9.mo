// name:     Lookup9
// keywords: scoping
// status:   correct
//

package A
  package B
    partial model BB
      constant Real k=1;
    public
      parameter Real R0 = 0.5;
    end BB;
  end B;
  model AB
    extends B.BB(R0=R_0);
    parameter Real R_0 = 0.9;
  end AB;
end A;
model C
   A.AB h(R_0=0.7);
end C;

// Result:
// Error processing file: Lookup9.mo
// Error: Failed to load package Lookup9 (default) using MODELICAPATH /home/omar/.openmodelica/libraries/.
// Error: Class Lookup9 not found in scope <top>.
// Error: Error occurred while flattening model Lookup9
//
// # Error encountered! Exiting...
// # Please check the error message and the flags.
//
// Execution failed!
// endResult
