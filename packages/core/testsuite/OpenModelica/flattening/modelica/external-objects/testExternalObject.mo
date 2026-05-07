// name:     testExternalObject
// keywords: external object
// status:   correct
// cflags:   -i=ExtObjectTest.Ex
//
// description: External object in extended class

package ExtObjectTest
  model Ex
    package ExtPackage1 = ExtPackage;
    ExtPackage1.ExtObj mapping = ExtPackage1.ExtObj();
  end Ex;

  package ExtPackage
    class ExtObj
      extends ExternalObject;
      function constructor
        output ExtObj mapping;
        external "C" mapping = initMapping();
      end constructor;
      function destructor
        input ExtObj mapping;
        external "C" destroyMapping(mapping);
      end destructor;
    end ExtObj;
  end ExtPackage;
end ExtObjectTest;

// Result:
// Error processing file: testExternalObject.mo
// Error: Failed to load package testExternalObject (default) using MODELICAPATH /home/omar/.openmodelica/libraries/.
// Error: Class testExternalObject not found in scope <top>.
// Error: Error occurred while flattening model testExternalObject
//
// # Error encountered! Exiting...
// # Please check the error message and the flags.
//
// Execution failed!
// endResult
