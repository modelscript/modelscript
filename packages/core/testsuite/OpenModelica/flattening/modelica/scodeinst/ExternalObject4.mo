// name: ExternalObject4
// keywords:
// status: correct
//
//

model ExternalObject3
  model ExtObj
    extends ExternalObject;

    function constructor
      input Integer i;
      output ExtObj obj;
      external "C" obj = initObject();
    end constructor;

    function destructor
      input ExtObj obj;
      external "C" destroyObject(obj);
    end destructor;
  end ExtObj;

  ExtObj eo1 = ExtObj(10);
end ExternalObject3;

// Result:
// Error processing file: ExternalObject4.mo
// Error: Failed to load package ExternalObject4 (default) using MODELICAPATH /home/omar/.openmodelica/libraries/.
// Error: Class ExternalObject4 not found in scope <top>.
// Error: Error occurred while flattening model ExternalObject4
//
// # Error encountered! Exiting...
// # Please check the error message and the flags.
//
// Execution failed!
// endResult
