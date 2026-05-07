// name: ExtendsShort2
// keywords:
// status: correct
//
//

package P1
  package P2
    model B
      Real x;
    equation
      P3.f(x);
    end B;
  end P2;

  package P3
    function f
      input Real x;
    end f;
  end P3;
end P1;

model ExtendsShort3
  model M = P1.P2.B;
  M a1;
  M a2;
end ExtendsShort3;

// Result:
// Error processing file: ExtendsShort3.mo
// Error: Failed to load package ExtendsShort2 (default) using MODELICAPATH /home/omar/.openmodelica/libraries/.
// Error: Class ExtendsShort2 not found in scope <top>.
// Error: Error occurred while flattening model ExtendsShort2
//
// # Error encountered! Exiting...
// # Please check the error message and the flags.
//
// Execution failed!
// endResult
