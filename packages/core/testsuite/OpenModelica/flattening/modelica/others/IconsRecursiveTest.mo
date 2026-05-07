// name:     RecursiveSelfReference
// keywords: Instantiation
// status:   correct
// cflags: -d=-newInst
//
// Testing fixes for bug: 179 (http://openmodelica.ida.liu.se/bugzilla/show_bug.cgi?id=179)
// the previous compiler failed to instantiate this model with Stack Overflow
//

  package BaseClasses
   extends Icons.BaseLibrary;
   package Icons
    extends Icons.BaseLibrary;
     model BaseLibrary "Icon for base library"
       parameter Real p = 1;
     end BaseLibrary;
   end Icons;
  end BaseClasses;

// Result:
// Error processing file: IconsRecursiveTest.mo
// Error: Failed to load package RecursiveSelfReference (default) using MODELICAPATH /home/omar/.openmodelica/libraries/.
// Error: Class RecursiveSelfReference not found in scope <top>.
// Error: Error occurred while flattening model RecursiveSelfReference
//
// # Error encountered! Exiting...
// # Please check the error message and the flags.
//
// Execution failed!
// endResult
