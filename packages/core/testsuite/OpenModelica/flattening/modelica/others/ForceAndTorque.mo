// name:     ForceAndTorque.mo
// keywords: component array addressing
// status:   correct
//
//  Verify component array addressing
//  adrpo: This tests for bug that generated things like:
//            force.y[1] = forceAndTorque.force[1];
//         instead of correct:
//            force[1].y = forceAndTorque.force[1];
//


package Internal

connector RealInput = input Real "'input Real' as connector";
connector RealOutput = output Real "'output Real' as connector";

model ForceAndTorque "Force and torque acting between two frames"
  model BasicForce "Force acting between two frames, defined by 3 input signals"
    RealInput force[3](each final quantity="Force", each final unit = "N") "x-, y-, z-coordinates of force";
  end BasicForce;

  RealInput force[3](each final quantity="Force", each final unit = "N") "x-, y-, z-coordinates of force";

  BasicForce basicForce;
equation
  connect(basicForce.force, force);
end ForceAndTorque;

partial block SO "Single Output continuous control block"
  RealOutput y "Connector of Real output signal";
end SO;

block Constant "Generate constant signal of type Real"
 parameter Real k(start=1) "Constant output value";
 extends SO;
equation
 y = k;
end Constant;
end Internal;

model ForceAndTorque
  Internal.ForceAndTorque forceAndTorque;
  Internal.Constant force[3](k={0,1000,0});
equation
  connect(force.y, forceAndTorque.force);
end ForceAndTorque;

// Result:
// Error processing file: ForceAndTorque.mo
// Error: Class ForceAndTorque.mo not found in scope <top>.
// Error: Error occurred while flattening model ForceAndTorque.mo
//
// # Error encountered! Exiting...
// # Please check the error message and the flags.
//
// Execution failed!
// endResult
