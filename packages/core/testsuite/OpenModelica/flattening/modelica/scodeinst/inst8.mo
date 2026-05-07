// name: inst8.mo
// keywords:
// status: correct
//
//

package DummyPackage
  constant Integer nXi = 2;

  package PartialMedium
    model BaseProperties
      Real[nXi] Xi;
    end BaseProperties;
  end PartialMedium;
end DummyPackage;

model PartialSource
  package Medium = DummyPackage.PartialMedium;
  Medium.BaseProperties medium;
end PartialSource;

model M
  PartialSource ps;
end M;

// Result:
// Error processing file: inst8.mo
// Error: Failed to load package inst8 (default) using MODELICAPATH /home/omar/.openmodelica/libraries/.
// Error: Class inst8.mo not found in scope <top>.
// Error: Error occurred while flattening model inst8.mo
//
// # Error encountered! Exiting...
// # Please check the error message and the flags.
//
// Execution failed!
// endResult
