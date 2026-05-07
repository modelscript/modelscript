// name:     Extends9
// keywords: extends
// status:   correct
//
// Testing modifiers that are looked up through the same base class
//
type Angle = Real(final quantity="Angle", final unit="rad", displayUnit="deg");
type Torque = Real(final quantity="Torque", final unit="N.m") ;

connector Flange_a "1D rotational flange (filled square icon)"
          Angle phi "Absolute rotation angle of flange";
          flow Torque tau "Cut torque in the flange";
end Flange_a;

connector Flange_b "1D rotational flange (filled square icon)"
          Angle phi "Absolute rotation angle of flange";
          flow Torque tau "Cut torque in the flange";
end Flange_b;

partial model Compliant "Base class for the compliant connection of two rotational 1D flanges"
          Angle phi_rel(start=0) "Relative rotation angle (= flange_b.phi - flange_a.phi)";
          Torque tau "Torque between flanges (= flange_b.tau)";
          Flange_a flange_a "(left) driving flange (flange axis directed INTO cut plane)";
          Flange_b flange_b "(right) driven flange (flange axis directed OUT OF cut plane)";
 equation
          phi_rel=flange_b.phi - flange_a.phi;
          flange_b.tau=tau;
          flange_a.tau=-tau;
end Compliant;

partial model Base
  extends Compliant;
  Real x=0;
end Base;
model Main
  extends Base(x=flange_b.phi);
end Main;


// Result:
// Error processing file: Extends9.mo
// Error: Failed to load package Extends9 (default) using MODELICAPATH /home/omar/.openmodelica/libraries/.
// Error: Class Extends9 not found in scope <top>.
// Error: Error occurred while flattening model Extends9
//
// # Error encountered! Exiting...
// # Please check the error message and the flags.
//
// Execution failed!
// endResult
