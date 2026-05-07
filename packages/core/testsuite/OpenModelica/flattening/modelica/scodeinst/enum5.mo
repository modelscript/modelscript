// name: enum5.mo
// keywords:
// status: correct
//

model M
  type E = enumeration(one, two, three);
  E e = E.one;

  type ME = E;
  ME me = ME.two;

  package P
    type PE = E;
  end P;
  P.PE pe = P.PE.three;

  model M2
    replaceable type M2E = E;
    M2E m2e = M2E.one;
    M2E m2e2 = M2E.two;
    E e = m2e;
  end M2;

  M2 m2(redeclare type M2E = E(start = E.two));
end M;

// Result:
// Error processing file: enum5.mo
// Error: Failed to load package enum5 (default) using MODELICAPATH /home/omar/.openmodelica/libraries/.
// Error: Class enum5.mo not found in scope <top>.
// Error: Error occurred while flattening model enum5.mo
//
// # Error encountered! Exiting...
// # Please check the error message and the flags.
//
// Execution failed!
// endResult
