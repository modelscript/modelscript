package Transformer  
  model SC2  
    Modelica.Electrical.QuasiStationary.SinglePhase.Sensors.PowerSensor powerSensor2;
    Modelica.Electrical.QuasiStationary.SinglePhase.Sensors.VoltageSensor voltageSensor2;
    Modelica.Electrical.QuasiStationary.SinglePhase.Sensors.CurrentSensor currentSensor1;
    Modelica.Electrical.QuasiStationary.SinglePhase.Basic.Ground ground2;
    Modelica.Electrical.QuasiStationary.SinglePhase.Sensors.VoltageSensor voltageSensor1;
    Transformer.SinglePhaseTransformerQS singlePhaseTransformerQS1(N1 = 500, R1 = 2.5, N2 = 250, R2 = 0.6, Gc = 1 / 1942, Lm = 1.79, L1sigma = 0.0636, L2sigma = 0.0165);
    Modelica.Electrical.QuasiStationary.SinglePhase.Basic.Ground ground1;
    Modelica.Electrical.QuasiStationary.SinglePhase.Sensors.CurrentSensor currentSensor2;
    Modelica.Electrical.QuasiStationary.SinglePhase.Sources.VoltageSource voltageSource1(f = 50, V = 98.5);
    Modelica.Electrical.QuasiStationary.SinglePhase.Sensors.PowerSensor powerSensor1;
  equation
    connect(currentSensor1.pin_p, ground2.pin);
    connect(powerSensor2.voltageN, ground1.pin);
    connect(singlePhaseTransformerQS1.pin_p2, powerSensor1.currentP);
    connect(ground2.pin, powerSensor1.voltageN);
    connect(powerSensor1.currentN, currentSensor1.pin_n);
    connect(powerSensor1.currentP, powerSensor1.voltageP);
    connect(voltageSensor1.pin_n, ground2.pin);
    connect(currentSensor1.pin_p, voltageSensor1.pin_p);
    connect(singlePhaseTransformerQS1.pin_n2, ground2.pin);
    connect(singlePhaseTransformerQS1.pin_n1, ground1.pin);
    connect(voltageSensor2.pin_n, ground1.pin);
    connect(voltageSource1.pin_n, ground1.pin);
    connect(voltageSensor2.pin_p, powerSensor2.currentN);
    connect(singlePhaseTransformerQS1.pin_p1, powerSensor2.currentN);
    connect(currentSensor2.pin_p, powerSensor2.currentP);
    connect(voltageSource1.pin_p, currentSensor2.pin_n);
    connect(powerSensor2.currentP, powerSensor2.voltageP);
  end SC2;

  model SinglePhaseTransformerQS  "Quasi stationary transformer modeled in electric domain including core loss" 
    parameter Real N1 "Number of turns of primary winding";
    parameter Modelica.SIunits.Resistance R1 "Primary resistance per phase at TRef";
    parameter Modelica.Electrical.Machines.Thermal.LinearTemperatureCoefficient20 alpha20_1 = Modelica.Electrical.Machines.Thermal.Constants.alpha20Copper "Temperature coefficient of primary resistance at 20 degC";
    parameter Modelica.SIunits.Inductance L1sigma "Primary stray inductance per phase";
    parameter Real N2 "Number of turns of secondary winding";
    parameter Modelica.SIunits.Resistance R2 "Secondary resistance per phase at TRef";
    parameter Modelica.Electrical.Machines.Thermal.LinearTemperatureCoefficient20 alpha20_2 = Modelica.Electrical.Machines.Thermal.Constants.alpha20Copper "Temperature coefficient of secondary resistance at 20 degC";
    parameter Modelica.SIunits.Inductance L2sigma "Secondary stray inductance per phase";
    parameter Modelica.SIunits.Temperature TRef "Reference temperature of primary resistance";
    parameter Modelica.SIunits.Temperature TOperational = 293.15 "Operational temperature of primary resistance";
    parameter Boolean useHeatPort = false "Enables or disables thermal heat port";
    parameter Modelica.SIunits.Conductance Gc = 0 "Total eddy current core loss conductance (w.r.t. primary side)" annotation(Evaluate = true);
    parameter Modelica.SIunits.Inductance Lm "Magnetizing inductance" annotation(Evaluate = true);
    Modelica.Electrical.QuasiStationary.SinglePhase.Basic.Inductor inductor1(final L = L1sigma);
    Modelica.Electrical.QuasiStationary.SinglePhase.Basic.Inductor inductor2(final L = L2sigma);
    Modelica.Electrical.QuasiStationary.SinglePhase.Basic.Resistor resistor1(final T_ref = TRef, final T = TOperational, final R_ref = R1, final alpha_ref = alpha20_1, final useHeatPort = useHeatPort);
    Modelica.Electrical.QuasiStationary.SinglePhase.Basic.Resistor resistor2(final T_ref = TRef, final T = TOperational, final R_ref = R2, final alpha_ref = alpha20_2, final useHeatPort = useHeatPort);
    Modelica.Electrical.QuasiStationary.SinglePhase.Basic.Inductor inductorh(final L = Lm);
    Transformer.IdealTransformer idealTransformer(final n = N1 / N2);
    Modelica.Electrical.QuasiStationary.SinglePhase.Basic.Conductor conductor(final G_ref = Gc, final useHeatPort = useHeatPort);
    Modelica.Electrical.QuasiStationary.SinglePhase.Interfaces.PositivePin pin_p1;
    Modelica.Electrical.QuasiStationary.SinglePhase.Interfaces.PositivePin pin_p2;
    Modelica.Electrical.QuasiStationary.SinglePhase.Interfaces.NegativePin pin_n1;
    Modelica.Electrical.QuasiStationary.SinglePhase.Interfaces.NegativePin pin_n2;
    Modelica.Thermal.HeatTransfer.Interfaces.HeatPort_a heatPort if useHeatPort;
  equation
    connect(pin_p1, resistor1.pin_p);
    connect(resistor1.pin_n, inductor1.pin_p);
    connect(inductor2.pin_p, resistor2.pin_n);
    connect(inductor1.pin_n, inductorh.pin_p);
    connect(inductorh.pin_n, pin_n1);
    connect(idealTransformer.pin_n1, pin_n1);
    connect(resistor1.heatPort, heatPort);
    connect(resistor2.heatPort, heatPort);
    connect(conductor.heatPort, heatPort);
    connect(conductor.pin_n, inductorh.pin_n);
    connect(conductor.pin_p, inductorh.pin_p);
    connect(inductor1.pin_n, idealTransformer.pin_p1);
    connect(idealTransformer.pin_n2, pin_n2);
    connect(idealTransformer.pin_p2, inductor2.pin_n);
    connect(resistor2.pin_p, pin_p2);
  end SinglePhaseTransformerQS;

  model IdealTransformer  "Ideal quasi stationary transformer" 
    parameter Real n = 1 "Ratio of primary to secondary voltage";
    Modelica.SIunits.ComplexVoltage v1 = pin_p1.v - pin_n1.v "Voltage drop of side 1";
    Modelica.SIunits.ComplexCurrent i1 = pin_p1.i "Current into side 1";
    Modelica.SIunits.ComplexVoltage v2 = pin_p2.v - pin_n2.v "Voltage drop of side 2";
    Modelica.SIunits.ComplexCurrent i2 = pin_p2.i "Current into side 2";
    Modelica.Electrical.QuasiStationary.SinglePhase.Interfaces.PositivePin pin_p1;
    Modelica.Electrical.QuasiStationary.SinglePhase.Interfaces.PositivePin pin_p2;
    Modelica.Electrical.QuasiStationary.SinglePhase.Interfaces.NegativePin pin_n1;
    Modelica.Electrical.QuasiStationary.SinglePhase.Interfaces.NegativePin pin_n2;
  equation
    pin_p1.i + pin_n1.i = Complex(0, 0);
    pin_p2.i + pin_n2.i = Complex(0, 0);
    v1 = Complex(+n, 0) * v2;
    i2 = Complex(-n, 0) * i1;
    Connections.branch(pin_p1.reference, pin_n1.reference);
    pin_p1.reference.gamma = pin_n1.reference.gamma;
    Connections.branch(pin_n1.reference, pin_n2.reference);
    pin_p2.reference.gamma = pin_n2.reference.gamma;
    Connections.branch(pin_p1.reference, pin_p2.reference);
    pin_p1.reference.gamma = pin_p2.reference.gamma;
  end IdealTransformer;
end Transformer;

package ModelicaServices  "ModelicaServices (OpenModelica implementation) - Models and functions used in the Modelica Standard Library requiring a tool specific implementation" 
  extends Modelica.Icons.Package;

  package Machine  
    extends Modelica.Icons.Package;
    final constant Real eps = 1.e-15 "Biggest number such that 1.0 + eps = 1.0";
    final constant Real small = 1.e-60 "Smallest number such that small and -small are representable on the machine";
    final constant Real inf = 1.e+60 "Biggest Real number such that inf and -inf are representable on the machine";
    final constant Integer Integer_inf = OpenModelica.Internal.Architecture.integerMax() "Biggest Integer number such that Integer_inf and -Integer_inf are representable on the machine";
  end Machine;
  annotation(Protection(access = Access.hide), version = "3.2.2", versionBuild = 0, versionDate = "2016-01-15", dateModified = "2016-01-15 08:44:41Z"); 
end ModelicaServices;

operator record Complex  "Complex number with overloaded operators" 
  replaceable Real re "Real part of complex number";
  replaceable Real im "Imaginary part of complex number";

  encapsulated operator 'constructor'  "Constructor" 
    function fromReal  "Construct Complex from Real" 
      import Complex;
      input Real re "Real part of complex number";
      input Real im = 0 "Imaginary part of complex number";
      output Complex result(re = re, im = im) "Complex number";
    algorithm
      annotation(Inline = true); 
    end fromReal;
  end 'constructor';

  encapsulated operator function '0'  "Zero-element of addition (= Complex(0))" 
    import Complex;
    output Complex result "Complex(0)";
  algorithm
    result := Complex(0);
    annotation(Inline = true); 
  end '0';

  encapsulated operator '-'  "Unary and binary minus" 
    function negate  "Unary minus (multiply complex number by -1)" 
      import Complex;
      input Complex c1 "Complex number";
      output Complex c2 "= -c1";
    algorithm
      c2 := Complex(-c1.re, -c1.im);
      annotation(Inline = true); 
    end negate;

    function subtract  "Subtract two complex numbers" 
      import Complex;
      input Complex c1 "Complex number 1";
      input Complex c2 "Complex number 2";
      output Complex c3 "= c1 - c2";
    algorithm
      c3 := Complex(c1.re - c2.re, c1.im - c2.im);
      annotation(Inline = true); 
    end subtract;
  end '-';

  encapsulated operator '*'  "Multiplication" 
    function multiply  "Multiply two complex numbers" 
      import Complex;
      input Complex c1 "Complex number 1";
      input Complex c2 "Complex number 2";
      output Complex c3 "= c1*c2";
    algorithm
      c3 := Complex(c1.re * c2.re - c1.im * c2.im, c1.re * c2.im + c1.im * c2.re);
      annotation(Inline = true); 
    end multiply;

    function scalarProduct  "Scalar product c1*c2 of two complex vectors" 
      import Complex;
      input Complex[:] c1 "Vector of Complex numbers 1";
      input Complex[size(c1, 1)] c2 "Vector of Complex numbers 2";
      output Complex c3 "= c1*c2";
    algorithm
      c3 := Complex(0);
      for i in 1:size(c1, 1) loop
        c3 := c3 + c1[i] * c2[i];
      end for;
      annotation(Inline = true); 
    end scalarProduct;
  end '*';

  encapsulated operator function '+'  "Add two complex numbers" 
    import Complex;
    input Complex c1 "Complex number 1";
    input Complex c2 "Complex number 2";
    output Complex c3 "= c1 + c2";
  algorithm
    c3 := Complex(c1.re + c2.re, c1.im + c2.im);
    annotation(Inline = true); 
  end '+';

  encapsulated operator function '/'  "Divide two complex numbers" 
    import Complex;
    input Complex c1 "Complex number 1";
    input Complex c2 "Complex number 2";
    output Complex c3 "= c1/c2";
  algorithm
    c3 := Complex(((+c1.re * c2.re) + c1.im * c2.im) / (c2.re * c2.re + c2.im * c2.im), ((-c1.re * c2.im) + c1.im * c2.re) / (c2.re * c2.re + c2.im * c2.im));
    annotation(Inline = true); 
  end '/';

  encapsulated operator function '^'  "Complex power of complex number" 
    import Complex;
    input Complex c1 "Complex number";
    input Complex c2 "Complex exponent";
    output Complex c3 "= c1^c2";
  protected
    Real lnz = 0.5 * log(c1.re * c1.re + c1.im * c1.im);
    Real phi = atan2(c1.im, c1.re);
    Real re = lnz * c2.re - phi * c2.im;
    Real im = lnz * c2.im + phi * c2.re;
  algorithm
    c3 := Complex(exp(re) * cos(im), exp(re) * sin(im));
    annotation(Inline = true); 
  end '^';

  encapsulated operator function '=='  "Test whether two complex numbers are identical" 
    import Complex;
    input Complex c1 "Complex number 1";
    input Complex c2 "Complex number 2";
    output Boolean result "c1 == c2";
  algorithm
    result := c1.re == c2.re and c1.im == c2.im;
    annotation(Inline = true); 
  end '==';

  encapsulated operator function '<>'  "Test whether two complex numbers are not identical" 
    import Complex;
    input Complex c1 "Complex number 1";
    input Complex c2 "Complex number 2";
    output Boolean result "c1 <> c2";
  algorithm
    result := c1.re <> c2.re or c1.im <> c2.im;
    annotation(Inline = true); 
  end '<>';

  encapsulated operator function 'String'  "Transform Complex number into a String representation" 
    import Complex;
    input Complex c "Complex number to be transformed in a String representation";
    input String name = "j" "Name of variable representing sqrt(-1) in the string";
    input Integer significantDigits = 6 "Number of significant digits that are shown";
    output String s = "";
  algorithm
    s := String(c.re, significantDigits = significantDigits);
    if c.im <> 0 then
      if c.im > 0 then
        s := s + " + ";
      else
        s := s + " - ";
      end if;
      s := s + String(abs(c.im), significantDigits = significantDigits) + "*" + name;
    else
    end if;
    annotation(Inline = true); 
  end 'String';
  annotation(Protection(access = Access.hide), version = "3.2.2", versionBuild = 0, versionDate = "2016-01-15", dateModified = "2016-01-15 08:44:41Z"); 
end Complex;

package Modelica  "Modelica Standard Library - Version 3.2.2" 
  extends Modelica.Icons.Package;

  package ComplexBlocks  "Library of basic input/output control blocks with Complex signals" 
    extends Modelica.Icons.Package;

    package Interfaces  "Library of connectors and partial models for input/output blocks" 
      extends Modelica.Icons.InterfacesPackage;
      connector ComplexOutput = output Complex "'output Complex' as connector";
    end Interfaces;
  end ComplexBlocks;

  package Electrical  "Library of electrical models (analog, digital, machines, multi-phase)" 
    extends Modelica.Icons.Package;

    package Analog  "Library for analog electrical models" 
      import SI = Modelica.SIunits;
      extends Modelica.Icons.Package;

      package Interfaces  "Connectors and partial models for Analog electrical components" 
        extends Modelica.Icons.InterfacesPackage;

        partial model ConditionalHeatPort  "Partial model to include a conditional HeatPort in order to describe the power loss via a thermal network" 
          parameter Boolean useHeatPort = false "=true, if heatPort is enabled" annotation(Evaluate = true, HideResult = true);
          parameter SI.Temperature T = 293.15 "Fixed device temperature if useHeatPort = false";
          Modelica.Thermal.HeatTransfer.Interfaces.HeatPort_a heatPort(T(start = T) = T_heatPort, Q_flow = -LossPower) if useHeatPort "Conditional heat port";
          SI.Power LossPower "Loss power leaving component via heatPort";
          SI.Temperature T_heatPort "Temperature of heatPort";
        equation
          if not useHeatPort then
            T_heatPort = T;
          end if;
        end ConditionalHeatPort;
      end Interfaces;
    end Analog;

    package Machines  "Library for electric machines" 
      extends Modelica.Icons.Package;

      package Thermal  "Library with models for connecting thermal models" 
        extends Modelica.Icons.Package;
        type LinearTemperatureCoefficient20 = Modelica.SIunits.LinearTemperatureCoefficient "Linear temperature coefficient with choices";

        package Constants  "Material Constants" 
          extends Modelica.Icons.Package;
          constant Modelica.SIunits.LinearTemperatureCoefficient alpha20Copper = 3.920e-3 "Copper";
        end Constants;
      end Thermal;
    end Machines;

    package QuasiStationary  "Library for quasi-stationary electrical singlephase and multiphase AC simulation" 
      extends Modelica.Icons.Package;

      package SinglePhase  "Single phase AC components" 
        extends Modelica.Icons.Package;

        package Basic  "Basic components for AC singlephase models" 
          extends Modelica.Icons.Package;

          model Ground  "Electrical ground" 
            Interfaces.PositivePin pin;
          equation
            Connections.potentialRoot(pin.reference, 256);
            if Connections.isRoot(pin.reference) then
              pin.reference.gamma = 0;
            end if;
            pin.v = Complex(0);
          end Ground;

          model Resistor  "Single phase linear resistor" 
            extends Interfaces.OnePort;
            import Modelica.ComplexMath.real;
            import Modelica.ComplexMath.conj;
            parameter Modelica.SIunits.Resistance R_ref(start = 1) "Reference resistance at T_ref";
            parameter Modelica.SIunits.Temperature T_ref = 293.15 "Reference temperature";
            parameter Modelica.SIunits.LinearTemperatureCoefficient alpha_ref = 0 "Temperature coefficient of resistance (R_actual = R_ref*(1 + alpha_ref*(heatPort.T - T_ref))";
            extends Modelica.Electrical.Analog.Interfaces.ConditionalHeatPort(T = T_ref);
            Modelica.SIunits.Resistance R_actual "Resistance = R_ref*(1 + alpha_ref*(heatPort.T - T_ref))";
          equation
            assert(1 + alpha_ref * (T_heatPort - T_ref) >= Modelica.Constants.eps, "Temperature outside scope of model!");
            R_actual = R_ref * (1 + alpha_ref * (T_heatPort - T_ref));
            v = R_actual * i;
            LossPower = real(v * conj(i));
          end Resistor;

          model Conductor  "Single phase linear conductor" 
            extends Interfaces.OnePort;
            import Modelica.ComplexMath.real;
            import Modelica.ComplexMath.conj;
            parameter Modelica.SIunits.Conductance G_ref(start = 1) "Reference conductance at T_ref";
            parameter Modelica.SIunits.Temperature T_ref = 293.15 "Reference temperature";
            parameter Modelica.SIunits.LinearTemperatureCoefficient alpha_ref = 0 "Temperature coefficient of conductance (G_actual = G_ref/(1 + alpha_ref*(heatPort.T - T_ref))";
            extends Modelica.Electrical.Analog.Interfaces.ConditionalHeatPort(T = T_ref);
            Modelica.SIunits.Conductance G_actual "Conductance = G_ref/(1 + alpha_ref*(heatPort.T - T_ref))";
          equation
            assert(1 + alpha_ref * (T_heatPort - T_ref) >= Modelica.Constants.eps, "Temperature outside scope of model!");
            G_actual = G_ref / (1 + alpha_ref * (T_heatPort - T_ref));
            i = G_actual * v;
            LossPower = real(v * conj(i));
          end Conductor;

          model Inductor  "Single phase linear inductor" 
            extends Interfaces.OnePort;
            import Modelica.ComplexMath.j;
            parameter Modelica.SIunits.Inductance L(start = 1) "Inductance";
          equation
            v = j * omega * L * i;
          end Inductor;
        end Basic;

        package Sensors  "AC singlephase sensors" 
          extends Modelica.Icons.SensorsPackage;

          model VoltageSensor  "Voltage sensor" 
            extends Interfaces.RelativeSensor;
            Modelica.SIunits.Voltage abs_y = Modelica.ComplexMath.'abs'(y) "Magnitude of complex voltage";
            Modelica.SIunits.Angle arg_y = Modelica.ComplexMath.arg(y) "Argument of complex voltage";
          equation
            i = Complex(0);
            y = v;
          end VoltageSensor;

          model CurrentSensor  "Current sensor" 
            extends Interfaces.RelativeSensor;
            Modelica.SIunits.Current abs_y = Modelica.ComplexMath.'abs'(y) "Magnitude of complex current";
            Modelica.SIunits.Angle arg_y = Modelica.ComplexMath.arg(y) "Argument of complex current";
          equation
            v = Complex(0);
            y = i;
          end CurrentSensor;

          model PowerSensor  "Power sensor" 
            import Modelica.ComplexMath.conj;
            extends Modelica.Icons.RotationalSensor;
            Interfaces.PositivePin currentP;
            Interfaces.NegativePin currentN;
            Interfaces.PositivePin voltageP;
            Interfaces.NegativePin voltageN;
            output Modelica.SIunits.ComplexCurrent i;
            output Modelica.SIunits.ComplexVoltage v;
            Modelica.ComplexBlocks.Interfaces.ComplexOutput y;
            Modelica.SIunits.ApparentPower abs_y = Modelica.ComplexMath.'abs'(y) "Magnitude of complex apparent power";
            Modelica.SIunits.Angle arg_y = Modelica.ComplexMath.arg(y) "Argument of complex apparent power";
          equation
            Connections.branch(currentP.reference, currentN.reference);
            currentP.reference.gamma = currentN.reference.gamma;
            Connections.branch(voltageP.reference, voltageN.reference);
            voltageP.reference.gamma = voltageN.reference.gamma;
            Connections.branch(currentP.reference, voltageP.reference);
            currentP.reference.gamma = voltageP.reference.gamma;
            currentP.i + currentN.i = Complex(0);
            currentP.v - currentN.v = Complex(0);
            i = currentP.i;
            voltageP.i + voltageN.i = Complex(0);
            voltageP.i = Complex(0);
            v = voltageP.v - voltageN.v;
            y = v * conj(i);
          end PowerSensor;
        end Sensors;

        package Sources  "AC singlephase sources" 
          extends Modelica.Icons.SourcesPackage;

          model VoltageSource  "Constant AC voltage" 
            extends Interfaces.Source;
            parameter Modelica.SIunits.Frequency f(start = 1) "frequency of the source";
            parameter Modelica.SIunits.Voltage V(start = 1) "RMS voltage of the source";
            parameter Modelica.SIunits.Angle phi(start = 0) "phase shift of the source";
          equation
            omega = 2 * Modelica.Constants.pi * f;
            v = Complex(V * cos(phi), V * sin(phi));
          end VoltageSource;
        end Sources;

        package Interfaces  "Interfaces for AC singlephase models" 
          extends Modelica.Icons.InterfacesPackage;

          connector Pin  "Basic connector" 
            Modelica.SIunits.ComplexVoltage v "Complex potential at the node";
            flow Modelica.SIunits.ComplexCurrent i "Complex current flowing into the pin";
          end Pin;

          connector PositivePin  "Positive connector" 
            extends Pin;
            QuasiStationary.Types.Reference reference "Reference";
          end PositivePin;

          connector NegativePin  "Negative Connector" 
            extends Pin;
            QuasiStationary.Types.Reference reference "Reference";
          end NegativePin;

          partial model TwoPin  "Two pins" 
            import Modelica.Constants.eps;
            Modelica.SIunits.ComplexVoltage v "Complex voltage";
            Modelica.SIunits.Voltage abs_v = Modelica.ComplexMath.'abs'(v) "Magnitude of complex voltage";
            Modelica.SIunits.Angle arg_v = Modelica.ComplexMath.arg(v) "Argument of complex voltage";
            Modelica.SIunits.ComplexCurrent i "Complex current";
            Modelica.SIunits.Current abs_i = Modelica.ComplexMath.'abs'(i) "Magnitude of complex current";
            Modelica.SIunits.Angle arg_i = Modelica.ComplexMath.arg(i) "Argument of complex current";
            Modelica.SIunits.ActivePower P = Modelica.ComplexMath.real(v * Modelica.ComplexMath.conj(i)) "Active power";
            Modelica.SIunits.ReactivePower Q = Modelica.ComplexMath.imag(v * Modelica.ComplexMath.conj(i)) "Reactive power";
            Modelica.SIunits.ApparentPower S = Modelica.ComplexMath.'abs'(v * Modelica.ComplexMath.conj(i)) "Magnitude of complex apparent power";
            Real pf = cos(Modelica.ComplexMath.arg(Complex(P, Q))) "Power factor";
            Modelica.SIunits.AngularVelocity omega "Angular velocity of reference frame";
            PositivePin pin_p "Positive pin";
            NegativePin pin_n "Negative pin";
          equation
            Connections.branch(pin_p.reference, pin_n.reference);
            pin_p.reference.gamma = pin_n.reference.gamma;
            omega = der(pin_p.reference.gamma);
            v = pin_p.v - pin_n.v;
            i = pin_p.i;
          end TwoPin;

          partial model OnePort  "Two pins, current through" 
            extends TwoPin;
          equation
            pin_p.i + pin_n.i = Complex(0);
          end OnePort;

          partial model RelativeSensor  "Partial voltage / current sensor" 
            extends Modelica.Icons.RotationalSensor;
            extends OnePort;
            Modelica.ComplexBlocks.Interfaces.ComplexOutput y;
          end RelativeSensor;

          partial model Source  "Partial voltage / current source" 
            extends OnePort;
            Modelica.SIunits.Angle gamma(start = 0) = pin_p.reference.gamma;
          equation
            Connections.root(pin_p.reference);
          end Source;
        end Interfaces;
      end SinglePhase;

      package Types  "Definition of types for quasistationary AC models" 
        extends Modelica.Icons.TypesPackage;

        record Reference  "Reference angle" 
          Modelica.SIunits.Angle gamma;

          function equalityConstraint  "Equality constraint for reference angle" 
            input Reference reference1;
            input Reference reference2;
            output Real[0] residue;
          algorithm
            assert(abs(reference1.gamma - reference2.gamma) < 1E-6 * 2 * Modelica.Constants.pi, "Reference angles should be equal!");
          end equalityConstraint;
        end Reference;
      end Types;
    end QuasiStationary;
  end Electrical;

  package Thermal  "Library of thermal system components to model heat transfer and simple thermo-fluid pipe flow" 
    extends Modelica.Icons.Package;

    package HeatTransfer  "Library of 1-dimensional heat transfer with lumped elements" 
      extends Modelica.Icons.Package;

      package Interfaces  "Connectors and partial models" 
        extends Modelica.Icons.InterfacesPackage;

        partial connector HeatPort  "Thermal port for 1-dim. heat transfer" 
          Modelica.SIunits.Temperature T "Port temperature";
          flow Modelica.SIunits.HeatFlowRate Q_flow "Heat flow rate (positive if flowing from outside into the component)";
        end HeatPort;

        connector HeatPort_a  "Thermal port for 1-dim. heat transfer (filled rectangular icon)" 
          extends HeatPort;
        end HeatPort_a;
      end Interfaces;
    end HeatTransfer;
  end Thermal;

  package Math  "Library of mathematical functions (e.g., sin, cos) and of functions operating on vectors and matrices" 
    import SI = Modelica.SIunits;
    extends Modelica.Icons.Package;

    package Icons  "Icons for Math" 
      extends Modelica.Icons.IconsPackage;

      partial function AxisCenter  "Basic icon for mathematical function with y-axis in the center" end AxisCenter;
    end Icons;

    function asin  "Inverse sine (-1 <= u <= 1)" 
      extends Modelica.Math.Icons.AxisCenter;
      input Real u;
      output SI.Angle y;
      external "builtin" y = asin(u);
    end asin;

    function atan2  "Four quadrant inverse tangent" 
      extends Modelica.Math.Icons.AxisCenter;
      input Real u1;
      input Real u2;
      output SI.Angle y;
      external "builtin" y = atan2(u1, u2);
    end atan2;

    function atan3  "Four quadrant inverse tangent (select solution that is closest to given angle y0)" 
      import Modelica.Math;
      import Modelica.Constants.pi;
      extends Modelica.Math.Icons.AxisCenter;
      input Real u1;
      input Real u2;
      input Modelica.SIunits.Angle y0 = 0 "y shall be in the range: -pi < y-y0 <= pi";
      output Modelica.SIunits.Angle y;
    protected
      constant Real pi2 = 2 * pi;
      Real w;
    algorithm
      w := Math.atan2(u1, u2);
      if y0 == 0 then
        y := w;
      else
        y := w + pi2 * integer((pi + y0 - w) / pi2);
      end if;
    end atan3;

    function exp  "Exponential, base e" 
      extends Modelica.Math.Icons.AxisCenter;
      input Real u;
      output Real y;
      external "builtin" y = exp(u);
    end exp;
  end Math;

  package ComplexMath  "Library of complex mathematical functions (e.g., sin, cos) and of functions operating on complex vectors and matrices" 
    extends Modelica.Icons.Package;
    final constant Complex j = Complex(0, 1) "Imaginary unit";

    function 'abs'  "Absolute value of complex number" 
      extends Modelica.Icons.Function;
      input Complex c "Complex number";
      output Real result "= abs(c)";
    algorithm
      result := (c.re ^ 2 + c.im ^ 2) ^ 0.5;
      annotation(Inline = true); 
    end 'abs';

    function arg  "Phase angle of complex number" 
      extends Modelica.Icons.Function;
      input Complex c "Complex number";
      input Modelica.SIunits.Angle phi0 = 0 "Phase angle phi shall be in the range: -pi < phi-phi0 < pi";
      output Modelica.SIunits.Angle phi "= phase angle of c";
    algorithm
      phi := Modelica.Math.atan3(c.im, c.re, phi0);
      annotation(Inline = true); 
    end arg;

    function conj  "Conjugate of complex number" 
      extends Modelica.Icons.Function;
      input Complex c1 "Complex number";
      output Complex c2 "= c1.re - j*c1.im";
    algorithm
      c2 := Complex(c1.re, -c1.im);
      annotation(Inline = true); 
    end conj;

    function real  "Real part of complex number" 
      extends Modelica.Icons.Function;
      input Complex c "Complex number";
      output Real r "= c.re";
    algorithm
      r := c.re;
      annotation(Inline = true); 
    end real;

    function imag  "Imaginary part of complex number" 
      extends Modelica.Icons.Function;
      input Complex c "Complex number";
      output Real r "= c.im";
    algorithm
      r := c.im;
      annotation(Inline = true); 
    end imag;
  end ComplexMath;

  package Constants  "Library of mathematical constants and constants of nature (e.g., pi, eps, R, sigma)" 
    import SI = Modelica.SIunits;
    import NonSI = Modelica.SIunits.Conversions.NonSIunits;
    extends Modelica.Icons.Package;
    final constant Real pi = 2 * Modelica.Math.asin(1.0);
    final constant Real eps = ModelicaServices.Machine.eps "Biggest number such that 1.0 + eps = 1.0";
    final constant SI.Velocity c = 299792458 "Speed of light in vacuum";
    final constant Real mue_0(final unit = "N/A2") = 4 * pi * 1.e-7 "Magnetic constant";
  end Constants;

  package Icons  "Library of icons" 
    extends Icons.Package;

    partial package Package  "Icon for standard packages" end Package;

    partial package InterfacesPackage  "Icon for packages containing interfaces" 
      extends Modelica.Icons.Package;
    end InterfacesPackage;

    partial package SourcesPackage  "Icon for packages containing sources" 
      extends Modelica.Icons.Package;
    end SourcesPackage;

    partial package SensorsPackage  "Icon for packages containing sensors" 
      extends Modelica.Icons.Package;
    end SensorsPackage;

    partial package TypesPackage  "Icon for packages containing type definitions" 
      extends Modelica.Icons.Package;
    end TypesPackage;

    partial package IconsPackage  "Icon for packages containing icons" 
      extends Modelica.Icons.Package;
    end IconsPackage;

    partial class RotationalSensor  "Icon representing a round measurement device" end RotationalSensor;

    partial function Function  "Icon for functions" end Function;
  end Icons;

  package SIunits  "Library of type and unit definitions based on SI units according to ISO 31-1992" 
    extends Modelica.Icons.Package;

    package Conversions  "Conversion functions to/from non SI units and type definitions of non SI units" 
      extends Modelica.Icons.Package;

      package NonSIunits  "Type definitions of non SI units" 
        extends Modelica.Icons.Package;
        type Temperature_degC = Real(final quantity = "ThermodynamicTemperature", final unit = "degC") "Absolute temperature in degree Celsius (for relative temperature use SIunits.TemperatureDifference)" annotation(absoluteValue = true);
      end NonSIunits;
    end Conversions;

    type Angle = Real(final quantity = "Angle", final unit = "rad", displayUnit = "deg");
    type AngularVelocity = Real(final quantity = "AngularVelocity", final unit = "rad/s");
    type Velocity = Real(final quantity = "Velocity", final unit = "m/s");
    type Acceleration = Real(final quantity = "Acceleration", final unit = "m/s2");
    type Frequency = Real(final quantity = "Frequency", final unit = "Hz");
    type Power = Real(final quantity = "Power", final unit = "W");
    type ThermodynamicTemperature = Real(final quantity = "ThermodynamicTemperature", final unit = "K", min = 0.0, start = 288.15, nominal = 300, displayUnit = "degC") "Absolute temperature (use type TemperatureDifference for relative temperatures)" annotation(absoluteValue = true);
    type Temperature = ThermodynamicTemperature;
    type LinearTemperatureCoefficient = Real(final quantity = "LinearTemperatureCoefficient", final unit = "1/K");
    type HeatFlowRate = Real(final quantity = "Power", final unit = "W");
    type ElectricCurrent = Real(final quantity = "ElectricCurrent", final unit = "A");
    type Current = ElectricCurrent;
    type ElectricPotential = Real(final quantity = "ElectricPotential", final unit = "V");
    type Voltage = ElectricPotential;
    type Inductance = Real(final quantity = "Inductance", final unit = "H");
    type Resistance = Real(final quantity = "Resistance", final unit = "Ohm");
    type Conductance = Real(final quantity = "Conductance", final unit = "S");
    type ActivePower = Real(final quantity = "Power", final unit = "W");
    type ApparentPower = Real(final quantity = "Power", final unit = "VA");
    type ReactivePower = Real(final quantity = "Power", final unit = "var");
    type FaradayConstant = Real(final quantity = "FaradayConstant", final unit = "C/mol");
    operator record ComplexCurrent = Complex(redeclare Modelica.SIunits.Current re "Real part of complex current", redeclare Modelica.SIunits.Current im "Imaginary part of complex current") "Complex electrical current";
    operator record ComplexVoltage = Complex(redeclare Modelica.SIunits.Voltage re "Imaginary part of complex voltage", redeclare Modelica.SIunits.Voltage im "Real part of complex voltage") "Complex electrical voltage";
  end SIunits;
  annotation(version = "3.2.2", versionBuild = 3, versionDate = "2016-04-03", dateModified = "2016-04-03 08:44:41Z"); 
end Modelica;

model SC2_total
  extends Transformer.SC2;
end SC2_total;

// Result:
// function Complex "Automatically generated record constructor for Complex"
//   input Real re;
//   input Real im;
//   output Complex res;
// end Complex;
//
// function Complex.'*'.multiply "Multiply two complex numbers"
//   input Complex c1 "Complex number 1";
//   input Complex c2 "Complex number 2";
//   output Complex c3 "= c1*c2";
// algorithm
//   c3 := Complex.'constructor'.fromReal(c1.re * c2.re - c1.im * c2.im, c1.re * c2.im + c1.im * c2.re);
// end Complex.'*'.multiply;
//
// function Complex.'constructor'.fromReal "Construct Complex from Real"
//   input Real re "Real part of complex number";
//   input Real im = 0.0 "Imaginary part of complex number";
//   output Complex result "Complex number";
// algorithm
// end Complex.'constructor'.fromReal;
//
// function Modelica.ComplexBlocks.Interfaces.ComplexOutput "Automatically generated record constructor for Modelica.ComplexBlocks.Interfaces.ComplexOutput"
//   input Real re;
//   input Real im;
//   output ComplexOutput res;
// end Modelica.ComplexBlocks.Interfaces.ComplexOutput;
//
// function Modelica.ComplexMath.'abs' "Absolute value of complex number"
//   input Complex c "Complex number";
//   output Real result "= abs(c)";
// algorithm
//   result := (c.re ^ 2.0 + c.im ^ 2.0) ^ 0.5;
// end Modelica.ComplexMath.'abs';
//
// function Modelica.ComplexMath.arg "Phase angle of complex number"
//   input Complex c "Complex number";
//   input Real phi0(quantity = "Angle", unit = "rad", displayUnit = "deg") = 0.0 "Phase angle phi shall be in the range: -pi < phi-phi0 < pi";
//   output Real phi(quantity = "Angle", unit = "rad", displayUnit = "deg") "= phase angle of c";
// algorithm
//   phi := Modelica.Math.atan3(c.im, c.re, phi0);
// end Modelica.ComplexMath.arg;
//
// function Modelica.ComplexMath.conj "Conjugate of complex number"
//   input Complex c1 "Complex number";
//   output Complex c2 "= c1.re - j*c1.im";
// algorithm
//   c2 := Complex.'constructor'.fromReal(c1.re, -c1.im);
// end Modelica.ComplexMath.conj;
//
// function Modelica.ComplexMath.imag "Imaginary part of complex number"
//   input Complex c "Complex number";
//   output Real r "= c.im";
// algorithm
//   r := c.im;
// end Modelica.ComplexMath.imag;
//
// function Modelica.ComplexMath.real "Real part of complex number"
//   input Complex c "Complex number";
//   output Real r "= c.re";
// algorithm
//   r := c.re;
// end Modelica.ComplexMath.real;
//
// function Modelica.Math.atan3 "Four quadrant inverse tangent (select solution that is closest to given angle y0)"
//   input Real u1;
//   input Real u2;
//   input Real y0(quantity = "Angle", unit = "rad", displayUnit = "deg") = 0.0 "y shall be in the range: -pi < y-y0 <= pi";
//   output Real y(quantity = "Angle", unit = "rad", displayUnit = "deg");
//   protected constant Real pi2 = 6.283185307179586;
//   protected Real w;
// algorithm
//   w := atan2(u1, u2);
//   if y0 == 0.0 then
//     y := w;
//   else
//     y := w + pi2 * /*Real*/(integer((3.141592653589793 + y0 - w) / pi2));
//   end if;
// end Modelica.Math.atan3;
//
// function Modelica.SIunits.ComplexCurrent "Automatically generated record constructor for Modelica.SIunits.ComplexCurrent"
//   input Real re;
//   input Real im;
//   output ComplexCurrent res;
// end Modelica.SIunits.ComplexCurrent;
//
// function Modelica.SIunits.ComplexCurrent.'*'.multiply "Multiply two complex numbers"
//   input Complex c1 "Complex number 1";
//   input Complex c2 "Complex number 2";
//   output Complex c3 "= c1*c2";
// algorithm
//   c3 := Complex.'constructor'.fromReal(c1.re * c2.re - c1.im * c2.im, c1.re * c2.im + c1.im * c2.re);
// end Modelica.SIunits.ComplexCurrent.'*'.multiply;
//
// function Modelica.SIunits.ComplexCurrent.'+' "Add two complex numbers"
//   input Complex c1 "Complex number 1";
//   input Complex c2 "Complex number 2";
//   output Complex c3 "= c1 + c2";
// algorithm
//   c3 := Complex.'constructor'.fromReal(c1.re + c2.re, c1.im + c2.im);
// end Modelica.SIunits.ComplexCurrent.'+';
//
// function Modelica.SIunits.ComplexCurrent.'constructor'.fromReal "Construct Complex from Real"
//   input Real re "Real part of complex number";
//   input Real im = 0.0 "Imaginary part of complex number";
//   output Complex result "Complex number";
// algorithm
// end Modelica.SIunits.ComplexCurrent.'constructor'.fromReal;
//
// function Modelica.SIunits.ComplexVoltage "Automatically generated record constructor for Modelica.SIunits.ComplexVoltage"
//   input Real re;
//   input Real im;
//   output ComplexVoltage res;
// end Modelica.SIunits.ComplexVoltage;
//
// function Modelica.SIunits.ComplexVoltage.'*'.multiply "Multiply two complex numbers"
//   input Complex c1 "Complex number 1";
//   input Complex c2 "Complex number 2";
//   output Complex c3 "= c1*c2";
// algorithm
//   c3 := Complex.'constructor'.fromReal(c1.re * c2.re - c1.im * c2.im, c1.re * c2.im + c1.im * c2.re);
// end Modelica.SIunits.ComplexVoltage.'*'.multiply;
//
// function Modelica.SIunits.ComplexVoltage.'-'.subtract "Subtract two complex numbers"
//   input Complex c1 "Complex number 1";
//   input Complex c2 "Complex number 2";
//   output Complex c3 "= c1 - c2";
// algorithm
//   c3 := Complex.'constructor'.fromReal(c1.re - c2.re, c1.im - c2.im);
// end Modelica.SIunits.ComplexVoltage.'-'.subtract;
//
// function Modelica.SIunits.ComplexVoltage.'constructor'.fromReal "Construct Complex from Real"
//   input Real re "Real part of complex number";
//   input Real im = 0.0 "Imaginary part of complex number";
//   output Complex result "Complex number";
// algorithm
// end Modelica.SIunits.ComplexVoltage.'constructor'.fromReal;
//
// class SC2_total
//   Real powerSensor2.currentP.v.re(quantity = "ElectricPotential", unit = "V") "Real part of complex number";
//   Real powerSensor2.currentP.v.im(quantity = "ElectricPotential", unit = "V") "Imaginary part of complex number";
//   Real powerSensor2.currentP.i.re(quantity = "ElectricCurrent", unit = "A") "Real part of complex number";
//   Real powerSensor2.currentP.i.im(quantity = "ElectricCurrent", unit = "A") "Imaginary part of complex number";
//   Real powerSensor2.currentP.reference.gamma(quantity = "Angle", unit = "rad", displayUnit = "deg");
//   Real powerSensor2.currentN.v.re(quantity = "ElectricPotential", unit = "V") "Real part of complex number";
//   Real powerSensor2.currentN.v.im(quantity = "ElectricPotential", unit = "V") "Imaginary part of complex number";
//   Real powerSensor2.currentN.i.re(quantity = "ElectricCurrent", unit = "A") "Real part of complex number";
//   Real powerSensor2.currentN.i.im(quantity = "ElectricCurrent", unit = "A") "Imaginary part of complex number";
//   Real powerSensor2.currentN.reference.gamma(quantity = "Angle", unit = "rad", displayUnit = "deg");
//   Real powerSensor2.voltageP.v.re(quantity = "ElectricPotential", unit = "V") "Real part of complex number";
//   Real powerSensor2.voltageP.v.im(quantity = "ElectricPotential", unit = "V") "Imaginary part of complex number";
//   Real powerSensor2.voltageP.i.re(quantity = "ElectricCurrent", unit = "A") "Real part of complex number";
//   Real powerSensor2.voltageP.i.im(quantity = "ElectricCurrent", unit = "A") "Imaginary part of complex number";
//   Real powerSensor2.voltageP.reference.gamma(quantity = "Angle", unit = "rad", displayUnit = "deg");
//   Real powerSensor2.voltageN.v.re(quantity = "ElectricPotential", unit = "V") "Real part of complex number";
//   Real powerSensor2.voltageN.v.im(quantity = "ElectricPotential", unit = "V") "Imaginary part of complex number";
//   Real powerSensor2.voltageN.i.re(quantity = "ElectricCurrent", unit = "A") "Real part of complex number";
//   Real powerSensor2.voltageN.i.im(quantity = "ElectricCurrent", unit = "A") "Imaginary part of complex number";
//   Real powerSensor2.voltageN.reference.gamma(quantity = "Angle", unit = "rad", displayUnit = "deg");
//   Real powerSensor2.i.re(quantity = "ElectricCurrent", unit = "A") "Real part of complex number";
//   Real powerSensor2.i.im(quantity = "ElectricCurrent", unit = "A") "Imaginary part of complex number";
//   Real powerSensor2.v.re(quantity = "ElectricPotential", unit = "V") "Real part of complex number";
//   Real powerSensor2.v.im(quantity = "ElectricPotential", unit = "V") "Imaginary part of complex number";
//   Real powerSensor2.y.re "Real part of complex number";
//   Real powerSensor2.y.im "Imaginary part of complex number";
//   Real powerSensor2.abs_y(quantity = "Power", unit = "VA") = Modelica.ComplexMath.'abs'(powerSensor2.y) "Magnitude of complex apparent power";
//   Real powerSensor2.arg_y(quantity = "Angle", unit = "rad", displayUnit = "deg") = Modelica.ComplexMath.arg(powerSensor2.y, 0.0) "Argument of complex apparent power";
//   Real voltageSensor2.v.re(quantity = "ElectricPotential", unit = "V") "Real part of complex number";
//   Real voltageSensor2.v.im(quantity = "ElectricPotential", unit = "V") "Imaginary part of complex number";
//   Real voltageSensor2.abs_v(quantity = "ElectricPotential", unit = "V") = Modelica.ComplexMath.'abs'(voltageSensor2.v) "Magnitude of complex voltage";
//   Real voltageSensor2.arg_v(quantity = "Angle", unit = "rad", displayUnit = "deg") = Modelica.ComplexMath.arg(voltageSensor2.v, 0.0) "Argument of complex voltage";
//   Real voltageSensor2.i.re(quantity = "ElectricCurrent", unit = "A") "Real part of complex number";
//   Real voltageSensor2.i.im(quantity = "ElectricCurrent", unit = "A") "Imaginary part of complex number";
//   Real voltageSensor2.abs_i(quantity = "ElectricCurrent", unit = "A") = Modelica.ComplexMath.'abs'(voltageSensor2.i) "Magnitude of complex current";
//   Real voltageSensor2.arg_i(quantity = "Angle", unit = "rad", displayUnit = "deg") = Modelica.ComplexMath.arg(voltageSensor2.i, 0.0) "Argument of complex current";
//   Real voltageSensor2.P(quantity = "Power", unit = "W") = Modelica.ComplexMath.real(Modelica.SIunits.ComplexVoltage.'*'.multiply(voltageSensor2.v, Modelica.ComplexMath.conj(voltageSensor2.i))) "Active power";
//   Real voltageSensor2.Q(quantity = "Power", unit = "var") = Modelica.ComplexMath.imag(Modelica.SIunits.ComplexVoltage.'*'.multiply(voltageSensor2.v, Modelica.ComplexMath.conj(voltageSensor2.i))) "Reactive power";
//   Real voltageSensor2.S(quantity = "Power", unit = "VA") = Modelica.ComplexMath.'abs'(Modelica.SIunits.ComplexVoltage.'*'.multiply(voltageSensor2.v, Modelica.ComplexMath.conj(voltageSensor2.i))) "Magnitude of complex apparent power";
//   Real voltageSensor2.pf = cos(Modelica.ComplexMath.arg(Complex.'constructor'.fromReal(voltageSensor2.P, voltageSensor2.Q), 0.0)) "Power factor";
//   Real voltageSensor2.omega(quantity = "AngularVelocity", unit = "rad/s") "Angular velocity of reference frame";
//   Real voltageSensor2.pin_p.v.re(quantity = "ElectricPotential", unit = "V") "Real part of complex number";
//   Real voltageSensor2.pin_p.v.im(quantity = "ElectricPotential", unit = "V") "Imaginary part of complex number";
//   Real voltageSensor2.pin_p.i.re(quantity = "ElectricCurrent", unit = "A") "Real part of complex number";
//   Real voltageSensor2.pin_p.i.im(quantity = "ElectricCurrent", unit = "A") "Imaginary part of complex number";
//   Real voltageSensor2.pin_p.reference.gamma(quantity = "Angle", unit = "rad", displayUnit = "deg");
//   Real voltageSensor2.pin_n.v.re(quantity = "ElectricPotential", unit = "V") "Real part of complex number";
//   Real voltageSensor2.pin_n.v.im(quantity = "ElectricPotential", unit = "V") "Imaginary part of complex number";
//   Real voltageSensor2.pin_n.i.re(quantity = "ElectricCurrent", unit = "A") "Real part of complex number";
//   Real voltageSensor2.pin_n.i.im(quantity = "ElectricCurrent", unit = "A") "Imaginary part of complex number";
//   Real voltageSensor2.pin_n.reference.gamma(quantity = "Angle", unit = "rad", displayUnit = "deg");
//   Real voltageSensor2.y.re "Real part of complex number";
//   Real voltageSensor2.y.im "Imaginary part of complex number";
//   Real voltageSensor2.abs_y(quantity = "ElectricPotential", unit = "V") = Modelica.ComplexMath.'abs'(voltageSensor2.y) "Magnitude of complex voltage";
//   Real voltageSensor2.arg_y(quantity = "Angle", unit = "rad", displayUnit = "deg") = Modelica.ComplexMath.arg(voltageSensor2.y, 0.0) "Argument of complex voltage";
//   Real currentSensor1.v.re(quantity = "ElectricPotential", unit = "V") "Real part of complex number";
//   Real currentSensor1.v.im(quantity = "ElectricPotential", unit = "V") "Imaginary part of complex number";
//   Real currentSensor1.abs_v(quantity = "ElectricPotential", unit = "V") = Modelica.ComplexMath.'abs'(currentSensor1.v) "Magnitude of complex voltage";
//   Real currentSensor1.arg_v(quantity = "Angle", unit = "rad", displayUnit = "deg") = Modelica.ComplexMath.arg(currentSensor1.v, 0.0) "Argument of complex voltage";
//   Real currentSensor1.i.re(quantity = "ElectricCurrent", unit = "A") "Real part of complex number";
//   Real currentSensor1.i.im(quantity = "ElectricCurrent", unit = "A") "Imaginary part of complex number";
//   Real currentSensor1.abs_i(quantity = "ElectricCurrent", unit = "A") = Modelica.ComplexMath.'abs'(currentSensor1.i) "Magnitude of complex current";
//   Real currentSensor1.arg_i(quantity = "Angle", unit = "rad", displayUnit = "deg") = Modelica.ComplexMath.arg(currentSensor1.i, 0.0) "Argument of complex current";
//   Real currentSensor1.P(quantity = "Power", unit = "W") = Modelica.ComplexMath.real(Modelica.SIunits.ComplexVoltage.'*'.multiply(currentSensor1.v, Modelica.ComplexMath.conj(currentSensor1.i))) "Active power";
//   Real currentSensor1.Q(quantity = "Power", unit = "var") = Modelica.ComplexMath.imag(Modelica.SIunits.ComplexVoltage.'*'.multiply(currentSensor1.v, Modelica.ComplexMath.conj(currentSensor1.i))) "Reactive power";
//   Real currentSensor1.S(quantity = "Power", unit = "VA") = Modelica.ComplexMath.'abs'(Modelica.SIunits.ComplexVoltage.'*'.multiply(currentSensor1.v, Modelica.ComplexMath.conj(currentSensor1.i))) "Magnitude of complex apparent power";
//   Real currentSensor1.pf = cos(Modelica.ComplexMath.arg(Complex.'constructor'.fromReal(currentSensor1.P, currentSensor1.Q), 0.0)) "Power factor";
//   Real currentSensor1.omega(quantity = "AngularVelocity", unit = "rad/s") "Angular velocity of reference frame";
//   Real currentSensor1.pin_p.v.re(quantity = "ElectricPotential", unit = "V") "Real part of complex number";
//   Real currentSensor1.pin_p.v.im(quantity = "ElectricPotential", unit = "V") "Imaginary part of complex number";
//   Real currentSensor1.pin_p.i.re(quantity = "ElectricCurrent", unit = "A") "Real part of complex number";
//   Real currentSensor1.pin_p.i.im(quantity = "ElectricCurrent", unit = "A") "Imaginary part of complex number";
//   Real currentSensor1.pin_p.reference.gamma(quantity = "Angle", unit = "rad", displayUnit = "deg");
//   Real currentSensor1.pin_n.v.re(quantity = "ElectricPotential", unit = "V") "Real part of complex number";
//   Real currentSensor1.pin_n.v.im(quantity = "ElectricPotential", unit = "V") "Imaginary part of complex number";
//   Real currentSensor1.pin_n.i.re(quantity = "ElectricCurrent", unit = "A") "Real part of complex number";
//   Real currentSensor1.pin_n.i.im(quantity = "ElectricCurrent", unit = "A") "Imaginary part of complex number";
//   Real currentSensor1.pin_n.reference.gamma(quantity = "Angle", unit = "rad", displayUnit = "deg");
//   Real currentSensor1.y.re "Real part of complex number";
//   Real currentSensor1.y.im "Imaginary part of complex number";
//   Real currentSensor1.abs_y(quantity = "ElectricCurrent", unit = "A") = Modelica.ComplexMath.'abs'(currentSensor1.y) "Magnitude of complex current";
//   Real currentSensor1.arg_y(quantity = "Angle", unit = "rad", displayUnit = "deg") = Modelica.ComplexMath.arg(currentSensor1.y, 0.0) "Argument of complex current";
//   Real ground2.pin.v.re(quantity = "ElectricPotential", unit = "V") "Real part of complex number";
//   Real ground2.pin.v.im(quantity = "ElectricPotential", unit = "V") "Imaginary part of complex number";
//   Real ground2.pin.i.re(quantity = "ElectricCurrent", unit = "A") "Real part of complex number";
//   Real ground2.pin.i.im(quantity = "ElectricCurrent", unit = "A") "Imaginary part of complex number";
//   Real ground2.pin.reference.gamma(quantity = "Angle", unit = "rad", displayUnit = "deg");
//   Real voltageSensor1.v.re(quantity = "ElectricPotential", unit = "V") "Real part of complex number";
//   Real voltageSensor1.v.im(quantity = "ElectricPotential", unit = "V") "Imaginary part of complex number";
//   Real voltageSensor1.abs_v(quantity = "ElectricPotential", unit = "V") = Modelica.ComplexMath.'abs'(voltageSensor1.v) "Magnitude of complex voltage";
//   Real voltageSensor1.arg_v(quantity = "Angle", unit = "rad", displayUnit = "deg") = Modelica.ComplexMath.arg(voltageSensor1.v, 0.0) "Argument of complex voltage";
//   Real voltageSensor1.i.re(quantity = "ElectricCurrent", unit = "A") "Real part of complex number";
//   Real voltageSensor1.i.im(quantity = "ElectricCurrent", unit = "A") "Imaginary part of complex number";
//   Real voltageSensor1.abs_i(quantity = "ElectricCurrent", unit = "A") = Modelica.ComplexMath.'abs'(voltageSensor1.i) "Magnitude of complex current";
//   Real voltageSensor1.arg_i(quantity = "Angle", unit = "rad", displayUnit = "deg") = Modelica.ComplexMath.arg(voltageSensor1.i, 0.0) "Argument of complex current";
//   Real voltageSensor1.P(quantity = "Power", unit = "W") = Modelica.ComplexMath.real(Modelica.SIunits.ComplexVoltage.'*'.multiply(voltageSensor1.v, Modelica.ComplexMath.conj(voltageSensor1.i))) "Active power";
//   Real voltageSensor1.Q(quantity = "Power", unit = "var") = Modelica.ComplexMath.imag(Modelica.SIunits.ComplexVoltage.'*'.multiply(voltageSensor1.v, Modelica.ComplexMath.conj(voltageSensor1.i))) "Reactive power";
//   Real voltageSensor1.S(quantity = "Power", unit = "VA") = Modelica.ComplexMath.'abs'(Modelica.SIunits.ComplexVoltage.'*'.multiply(voltageSensor1.v, Modelica.ComplexMath.conj(voltageSensor1.i))) "Magnitude of complex apparent power";
//   Real voltageSensor1.pf = cos(Modelica.ComplexMath.arg(Complex.'constructor'.fromReal(voltageSensor1.P, voltageSensor1.Q), 0.0)) "Power factor";
//   Real voltageSensor1.omega(quantity = "AngularVelocity", unit = "rad/s") "Angular velocity of reference frame";
//   Real voltageSensor1.pin_p.v.re(quantity = "ElectricPotential", unit = "V") "Real part of complex number";
//   Real voltageSensor1.pin_p.v.im(quantity = "ElectricPotential", unit = "V") "Imaginary part of complex number";
//   Real voltageSensor1.pin_p.i.re(quantity = "ElectricCurrent", unit = "A") "Real part of complex number";
//   Real voltageSensor1.pin_p.i.im(quantity = "ElectricCurrent", unit = "A") "Imaginary part of complex number";
//   Real voltageSensor1.pin_p.reference.gamma(quantity = "Angle", unit = "rad", displayUnit = "deg");
//   Real voltageSensor1.pin_n.v.re(quantity = "ElectricPotential", unit = "V") "Real part of complex number";
//   Real voltageSensor1.pin_n.v.im(quantity = "ElectricPotential", unit = "V") "Imaginary part of complex number";
//   Real voltageSensor1.pin_n.i.re(quantity = "ElectricCurrent", unit = "A") "Real part of complex number";
//   Real voltageSensor1.pin_n.i.im(quantity = "ElectricCurrent", unit = "A") "Imaginary part of complex number";
//   Real voltageSensor1.pin_n.reference.gamma(quantity = "Angle", unit = "rad", displayUnit = "deg");
//   Real voltageSensor1.y.re "Real part of complex number";
//   Real voltageSensor1.y.im "Imaginary part of complex number";
//   Real voltageSensor1.abs_y(quantity = "ElectricPotential", unit = "V") = Modelica.ComplexMath.'abs'(voltageSensor1.y) "Magnitude of complex voltage";
//   Real voltageSensor1.arg_y(quantity = "Angle", unit = "rad", displayUnit = "deg") = Modelica.ComplexMath.arg(voltageSensor1.y, 0.0) "Argument of complex voltage";
//   parameter Real singlePhaseTransformerQS1.N1 = 500.0 "Number of turns of primary winding";
//   parameter Real singlePhaseTransformerQS1.R1(quantity = "Resistance", unit = "Ohm") = 2.5 "Primary resistance per phase at TRef";
//   parameter Real singlePhaseTransformerQS1.alpha20_1(quantity = "LinearTemperatureCoefficient", unit = "1/K") = 0.00392 "Temperature coefficient of primary resistance at 20 degC";
//   parameter Real singlePhaseTransformerQS1.L1sigma(quantity = "Inductance", unit = "H") = 0.0636 "Primary stray inductance per phase";
//   parameter Real singlePhaseTransformerQS1.N2 = 250.0 "Number of turns of secondary winding";
//   parameter Real singlePhaseTransformerQS1.R2(quantity = "Resistance", unit = "Ohm") = 0.6 "Secondary resistance per phase at TRef";
//   parameter Real singlePhaseTransformerQS1.alpha20_2(quantity = "LinearTemperatureCoefficient", unit = "1/K") = 0.00392 "Temperature coefficient of secondary resistance at 20 degC";
//   parameter Real singlePhaseTransformerQS1.L2sigma(quantity = "Inductance", unit = "H") = 0.0165 "Secondary stray inductance per phase";
//   parameter Real singlePhaseTransformerQS1.TRef(quantity = "ThermodynamicTemperature", unit = "K", displayUnit = "degC", min = 0.0, start = 288.15, nominal = 300.0) "Reference temperature of primary resistance";
//   parameter Real singlePhaseTransformerQS1.TOperational(quantity = "ThermodynamicTemperature", unit = "K", displayUnit = "degC", min = 0.0, start = 288.15, nominal = 300.0) = 293.15 "Operational temperature of primary resistance";
//   final parameter Boolean singlePhaseTransformerQS1.useHeatPort = false "Enables or disables thermal heat port";
//   final parameter Real singlePhaseTransformerQS1.Gc(quantity = "Conductance", unit = "S") = 5.149330587023687e-4 "Total eddy current core loss conductance (w.r.t. primary side)";
//   final parameter Real singlePhaseTransformerQS1.Lm(quantity = "Inductance", unit = "H") = 1.79 "Magnetizing inductance";
//   Real singlePhaseTransformerQS1.inductor1.v.re(quantity = "ElectricPotential", unit = "V") "Real part of complex number";
//   Real singlePhaseTransformerQS1.inductor1.v.im(quantity = "ElectricPotential", unit = "V") "Imaginary part of complex number";
//   Real singlePhaseTransformerQS1.inductor1.abs_v(quantity = "ElectricPotential", unit = "V") = Modelica.ComplexMath.'abs'(singlePhaseTransformerQS1.inductor1.v) "Magnitude of complex voltage";
//   Real singlePhaseTransformerQS1.inductor1.arg_v(quantity = "Angle", unit = "rad", displayUnit = "deg") = Modelica.ComplexMath.arg(singlePhaseTransformerQS1.inductor1.v, 0.0) "Argument of complex voltage";
//   Real singlePhaseTransformerQS1.inductor1.i.re(quantity = "ElectricCurrent", unit = "A") "Real part of complex number";
//   Real singlePhaseTransformerQS1.inductor1.i.im(quantity = "ElectricCurrent", unit = "A") "Imaginary part of complex number";
//   Real singlePhaseTransformerQS1.inductor1.abs_i(quantity = "ElectricCurrent", unit = "A") = Modelica.ComplexMath.'abs'(singlePhaseTransformerQS1.inductor1.i) "Magnitude of complex current";
//   Real singlePhaseTransformerQS1.inductor1.arg_i(quantity = "Angle", unit = "rad", displayUnit = "deg") = Modelica.ComplexMath.arg(singlePhaseTransformerQS1.inductor1.i, 0.0) "Argument of complex current";
//   Real singlePhaseTransformerQS1.inductor1.P(quantity = "Power", unit = "W") = Modelica.ComplexMath.real(Modelica.SIunits.ComplexVoltage.'*'.multiply(singlePhaseTransformerQS1.inductor1.v, Modelica.ComplexMath.conj(singlePhaseTransformerQS1.inductor1.i))) "Active power";
//   Real singlePhaseTransformerQS1.inductor1.Q(quantity = "Power", unit = "var") = Modelica.ComplexMath.imag(Modelica.SIunits.ComplexVoltage.'*'.multiply(singlePhaseTransformerQS1.inductor1.v, Modelica.ComplexMath.conj(singlePhaseTransformerQS1.inductor1.i))) "Reactive power";
//   Real singlePhaseTransformerQS1.inductor1.S(quantity = "Power", unit = "VA") = Modelica.ComplexMath.'abs'(Modelica.SIunits.ComplexVoltage.'*'.multiply(singlePhaseTransformerQS1.inductor1.v, Modelica.ComplexMath.conj(singlePhaseTransformerQS1.inductor1.i))) "Magnitude of complex apparent power";
//   Real singlePhaseTransformerQS1.inductor1.pf = cos(Modelica.ComplexMath.arg(Complex.'constructor'.fromReal(singlePhaseTransformerQS1.inductor1.P, singlePhaseTransformerQS1.inductor1.Q), 0.0)) "Power factor";
//   Real singlePhaseTransformerQS1.inductor1.omega(quantity = "AngularVelocity", unit = "rad/s") "Angular velocity of reference frame";
//   Real singlePhaseTransformerQS1.inductor1.pin_p.v.re(quantity = "ElectricPotential", unit = "V") "Real part of complex number";
//   Real singlePhaseTransformerQS1.inductor1.pin_p.v.im(quantity = "ElectricPotential", unit = "V") "Imaginary part of complex number";
//   Real singlePhaseTransformerQS1.inductor1.pin_p.i.re(quantity = "ElectricCurrent", unit = "A") "Real part of complex number";
//   Real singlePhaseTransformerQS1.inductor1.pin_p.i.im(quantity = "ElectricCurrent", unit = "A") "Imaginary part of complex number";
//   Real singlePhaseTransformerQS1.inductor1.pin_p.reference.gamma(quantity = "Angle", unit = "rad", displayUnit = "deg");
//   Real singlePhaseTransformerQS1.inductor1.pin_n.v.re(quantity = "ElectricPotential", unit = "V") "Real part of complex number";
//   Real singlePhaseTransformerQS1.inductor1.pin_n.v.im(quantity = "ElectricPotential", unit = "V") "Imaginary part of complex number";
//   Real singlePhaseTransformerQS1.inductor1.pin_n.i.re(quantity = "ElectricCurrent", unit = "A") "Real part of complex number";
//   Real singlePhaseTransformerQS1.inductor1.pin_n.i.im(quantity = "ElectricCurrent", unit = "A") "Imaginary part of complex number";
//   Real singlePhaseTransformerQS1.inductor1.pin_n.reference.gamma(quantity = "Angle", unit = "rad", displayUnit = "deg");
//   final parameter Real singlePhaseTransformerQS1.inductor1.L(quantity = "Inductance", unit = "H", start = 1.0) = singlePhaseTransformerQS1.L1sigma "Inductance";
//   Real singlePhaseTransformerQS1.inductor2.v.re(quantity = "ElectricPotential", unit = "V") "Real part of complex number";
//   Real singlePhaseTransformerQS1.inductor2.v.im(quantity = "ElectricPotential", unit = "V") "Imaginary part of complex number";
//   Real singlePhaseTransformerQS1.inductor2.abs_v(quantity = "ElectricPotential", unit = "V") = Modelica.ComplexMath.'abs'(singlePhaseTransformerQS1.inductor2.v) "Magnitude of complex voltage";
//   Real singlePhaseTransformerQS1.inductor2.arg_v(quantity = "Angle", unit = "rad", displayUnit = "deg") = Modelica.ComplexMath.arg(singlePhaseTransformerQS1.inductor2.v, 0.0) "Argument of complex voltage";
//   Real singlePhaseTransformerQS1.inductor2.i.re(quantity = "ElectricCurrent", unit = "A") "Real part of complex number";
//   Real singlePhaseTransformerQS1.inductor2.i.im(quantity = "ElectricCurrent", unit = "A") "Imaginary part of complex number";
//   Real singlePhaseTransformerQS1.inductor2.abs_i(quantity = "ElectricCurrent", unit = "A") = Modelica.ComplexMath.'abs'(singlePhaseTransformerQS1.inductor2.i) "Magnitude of complex current";
//   Real singlePhaseTransformerQS1.inductor2.arg_i(quantity = "Angle", unit = "rad", displayUnit = "deg") = Modelica.ComplexMath.arg(singlePhaseTransformerQS1.inductor2.i, 0.0) "Argument of complex current";
//   Real singlePhaseTransformerQS1.inductor2.P(quantity = "Power", unit = "W") = Modelica.ComplexMath.real(Modelica.SIunits.ComplexVoltage.'*'.multiply(singlePhaseTransformerQS1.inductor2.v, Modelica.ComplexMath.conj(singlePhaseTransformerQS1.inductor2.i))) "Active power";
//   Real singlePhaseTransformerQS1.inductor2.Q(quantity = "Power", unit = "var") = Modelica.ComplexMath.imag(Modelica.SIunits.ComplexVoltage.'*'.multiply(singlePhaseTransformerQS1.inductor2.v, Modelica.ComplexMath.conj(singlePhaseTransformerQS1.inductor2.i))) "Reactive power";
//   Real singlePhaseTransformerQS1.inductor2.S(quantity = "Power", unit = "VA") = Modelica.ComplexMath.'abs'(Modelica.SIunits.ComplexVoltage.'*'.multiply(singlePhaseTransformerQS1.inductor2.v, Modelica.ComplexMath.conj(singlePhaseTransformerQS1.inductor2.i))) "Magnitude of complex apparent power";
//   Real singlePhaseTransformerQS1.inductor2.pf = cos(Modelica.ComplexMath.arg(Complex.'constructor'.fromReal(singlePhaseTransformerQS1.inductor2.P, singlePhaseTransformerQS1.inductor2.Q), 0.0)) "Power factor";
//   Real singlePhaseTransformerQS1.inductor2.omega(quantity = "AngularVelocity", unit = "rad/s") "Angular velocity of reference frame";
//   Real singlePhaseTransformerQS1.inductor2.pin_p.v.re(quantity = "ElectricPotential", unit = "V") "Real part of complex number";
//   Real singlePhaseTransformerQS1.inductor2.pin_p.v.im(quantity = "ElectricPotential", unit = "V") "Imaginary part of complex number";
//   Real singlePhaseTransformerQS1.inductor2.pin_p.i.re(quantity = "ElectricCurrent", unit = "A") "Real part of complex number";
//   Real singlePhaseTransformerQS1.inductor2.pin_p.i.im(quantity = "ElectricCurrent", unit = "A") "Imaginary part of complex number";
//   Real singlePhaseTransformerQS1.inductor2.pin_p.reference.gamma(quantity = "Angle", unit = "rad", displayUnit = "deg");
//   Real singlePhaseTransformerQS1.inductor2.pin_n.v.re(quantity = "ElectricPotential", unit = "V") "Real part of complex number";
//   Real singlePhaseTransformerQS1.inductor2.pin_n.v.im(quantity = "ElectricPotential", unit = "V") "Imaginary part of complex number";
//   Real singlePhaseTransformerQS1.inductor2.pin_n.i.re(quantity = "ElectricCurrent", unit = "A") "Real part of complex number";
//   Real singlePhaseTransformerQS1.inductor2.pin_n.i.im(quantity = "ElectricCurrent", unit = "A") "Imaginary part of complex number";
//   Real singlePhaseTransformerQS1.inductor2.pin_n.reference.gamma(quantity = "Angle", unit = "rad", displayUnit = "deg");
//   final parameter Real singlePhaseTransformerQS1.inductor2.L(quantity = "Inductance", unit = "H", start = 1.0) = singlePhaseTransformerQS1.L2sigma "Inductance";
//   Real singlePhaseTransformerQS1.resistor1.v.re(quantity = "ElectricPotential", unit = "V") "Real part of complex number";
//   Real singlePhaseTransformerQS1.resistor1.v.im(quantity = "ElectricPotential", unit = "V") "Imaginary part of complex number";
//   Real singlePhaseTransformerQS1.resistor1.abs_v(quantity = "ElectricPotential", unit = "V") = Modelica.ComplexMath.'abs'(singlePhaseTransformerQS1.resistor1.v) "Magnitude of complex voltage";
//   Real singlePhaseTransformerQS1.resistor1.arg_v(quantity = "Angle", unit = "rad", displayUnit = "deg") = Modelica.ComplexMath.arg(singlePhaseTransformerQS1.resistor1.v, 0.0) "Argument of complex voltage";
//   Real singlePhaseTransformerQS1.resistor1.i.re(quantity = "ElectricCurrent", unit = "A") "Real part of complex number";
//   Real singlePhaseTransformerQS1.resistor1.i.im(quantity = "ElectricCurrent", unit = "A") "Imaginary part of complex number";
//   Real singlePhaseTransformerQS1.resistor1.abs_i(quantity = "ElectricCurrent", unit = "A") = Modelica.ComplexMath.'abs'(singlePhaseTransformerQS1.resistor1.i) "Magnitude of complex current";
//   Real singlePhaseTransformerQS1.resistor1.arg_i(quantity = "Angle", unit = "rad", displayUnit = "deg") = Modelica.ComplexMath.arg(singlePhaseTransformerQS1.resistor1.i, 0.0) "Argument of complex current";
//   Real singlePhaseTransformerQS1.resistor1.P(quantity = "Power", unit = "W") = Modelica.ComplexMath.real(Modelica.SIunits.ComplexVoltage.'*'.multiply(singlePhaseTransformerQS1.resistor1.v, Modelica.ComplexMath.conj(singlePhaseTransformerQS1.resistor1.i))) "Active power";
//   Real singlePhaseTransformerQS1.resistor1.Q(quantity = "Power", unit = "var") = Modelica.ComplexMath.imag(Modelica.SIunits.ComplexVoltage.'*'.multiply(singlePhaseTransformerQS1.resistor1.v, Modelica.ComplexMath.conj(singlePhaseTransformerQS1.resistor1.i))) "Reactive power";
//   Real singlePhaseTransformerQS1.resistor1.S(quantity = "Power", unit = "VA") = Modelica.ComplexMath.'abs'(Modelica.SIunits.ComplexVoltage.'*'.multiply(singlePhaseTransformerQS1.resistor1.v, Modelica.ComplexMath.conj(singlePhaseTransformerQS1.resistor1.i))) "Magnitude of complex apparent power";
//   Real singlePhaseTransformerQS1.resistor1.pf = cos(Modelica.ComplexMath.arg(Complex.'constructor'.fromReal(singlePhaseTransformerQS1.resistor1.P, singlePhaseTransformerQS1.resistor1.Q), 0.0)) "Power factor";
//   Real singlePhaseTransformerQS1.resistor1.omega(quantity = "AngularVelocity", unit = "rad/s") "Angular velocity of reference frame";
//   Real singlePhaseTransformerQS1.resistor1.pin_p.v.re(quantity = "ElectricPotential", unit = "V") "Real part of complex number";
//   Real singlePhaseTransformerQS1.resistor1.pin_p.v.im(quantity = "ElectricPotential", unit = "V") "Imaginary part of complex number";
//   Real singlePhaseTransformerQS1.resistor1.pin_p.i.re(quantity = "ElectricCurrent", unit = "A") "Real part of complex number";
//   Real singlePhaseTransformerQS1.resistor1.pin_p.i.im(quantity = "ElectricCurrent", unit = "A") "Imaginary part of complex number";
//   Real singlePhaseTransformerQS1.resistor1.pin_p.reference.gamma(quantity = "Angle", unit = "rad", displayUnit = "deg");
//   Real singlePhaseTransformerQS1.resistor1.pin_n.v.re(quantity = "ElectricPotential", unit = "V") "Real part of complex number";
//   Real singlePhaseTransformerQS1.resistor1.pin_n.v.im(quantity = "ElectricPotential", unit = "V") "Imaginary part of complex number";
//   Real singlePhaseTransformerQS1.resistor1.pin_n.i.re(quantity = "ElectricCurrent", unit = "A") "Real part of complex number";
//   Real singlePhaseTransformerQS1.resistor1.pin_n.i.im(quantity = "ElectricCurrent", unit = "A") "Imaginary part of complex number";
//   Real singlePhaseTransformerQS1.resistor1.pin_n.reference.gamma(quantity = "Angle", unit = "rad", displayUnit = "deg");
//   final parameter Real singlePhaseTransformerQS1.resistor1.R_ref(quantity = "Resistance", unit = "Ohm", start = 1.0) = singlePhaseTransformerQS1.R1 "Reference resistance at T_ref";
//   final parameter Real singlePhaseTransformerQS1.resistor1.T_ref(quantity = "ThermodynamicTemperature", unit = "K", displayUnit = "degC", min = 0.0, start = 288.15, nominal = 300.0) = singlePhaseTransformerQS1.TRef "Reference temperature";
//   final parameter Real singlePhaseTransformerQS1.resistor1.alpha_ref(quantity = "LinearTemperatureCoefficient", unit = "1/K") = singlePhaseTransformerQS1.alpha20_1 "Temperature coefficient of resistance (R_actual = R_ref*(1 + alpha_ref*(heatPort.T - T_ref))";
//   final parameter Boolean singlePhaseTransformerQS1.resistor1.useHeatPort = false "=true, if heatPort is enabled";
//   final parameter Real singlePhaseTransformerQS1.resistor1.T(quantity = "ThermodynamicTemperature", unit = "K", displayUnit = "degC", min = 0.0, start = 288.15, nominal = 300.0) = singlePhaseTransformerQS1.TOperational "Fixed device temperature if useHeatPort = false";
//   Real singlePhaseTransformerQS1.resistor1.LossPower(quantity = "Power", unit = "W") "Loss power leaving component via heatPort";
//   Real singlePhaseTransformerQS1.resistor1.T_heatPort(quantity = "ThermodynamicTemperature", unit = "K", displayUnit = "degC", min = 0.0, start = 288.15, nominal = 300.0) "Temperature of heatPort";
//   Real singlePhaseTransformerQS1.resistor1.R_actual(quantity = "Resistance", unit = "Ohm") "Resistance = R_ref*(1 + alpha_ref*(heatPort.T - T_ref))";
//   Real singlePhaseTransformerQS1.resistor2.v.re(quantity = "ElectricPotential", unit = "V") "Real part of complex number";
//   Real singlePhaseTransformerQS1.resistor2.v.im(quantity = "ElectricPotential", unit = "V") "Imaginary part of complex number";
//   Real singlePhaseTransformerQS1.resistor2.abs_v(quantity = "ElectricPotential", unit = "V") = Modelica.ComplexMath.'abs'(singlePhaseTransformerQS1.resistor2.v) "Magnitude of complex voltage";
//   Real singlePhaseTransformerQS1.resistor2.arg_v(quantity = "Angle", unit = "rad", displayUnit = "deg") = Modelica.ComplexMath.arg(singlePhaseTransformerQS1.resistor2.v, 0.0) "Argument of complex voltage";
//   Real singlePhaseTransformerQS1.resistor2.i.re(quantity = "ElectricCurrent", unit = "A") "Real part of complex number";
//   Real singlePhaseTransformerQS1.resistor2.i.im(quantity = "ElectricCurrent", unit = "A") "Imaginary part of complex number";
//   Real singlePhaseTransformerQS1.resistor2.abs_i(quantity = "ElectricCurrent", unit = "A") = Modelica.ComplexMath.'abs'(singlePhaseTransformerQS1.resistor2.i) "Magnitude of complex current";
//   Real singlePhaseTransformerQS1.resistor2.arg_i(quantity = "Angle", unit = "rad", displayUnit = "deg") = Modelica.ComplexMath.arg(singlePhaseTransformerQS1.resistor2.i, 0.0) "Argument of complex current";
//   Real singlePhaseTransformerQS1.resistor2.P(quantity = "Power", unit = "W") = Modelica.ComplexMath.real(Modelica.SIunits.ComplexVoltage.'*'.multiply(singlePhaseTransformerQS1.resistor2.v, Modelica.ComplexMath.conj(singlePhaseTransformerQS1.resistor2.i))) "Active power";
//   Real singlePhaseTransformerQS1.resistor2.Q(quantity = "Power", unit = "var") = Modelica.ComplexMath.imag(Modelica.SIunits.ComplexVoltage.'*'.multiply(singlePhaseTransformerQS1.resistor2.v, Modelica.ComplexMath.conj(singlePhaseTransformerQS1.resistor2.i))) "Reactive power";
//   Real singlePhaseTransformerQS1.resistor2.S(quantity = "Power", unit = "VA") = Modelica.ComplexMath.'abs'(Modelica.SIunits.ComplexVoltage.'*'.multiply(singlePhaseTransformerQS1.resistor2.v, Modelica.ComplexMath.conj(singlePhaseTransformerQS1.resistor2.i))) "Magnitude of complex apparent power";
//   Real singlePhaseTransformerQS1.resistor2.pf = cos(Modelica.ComplexMath.arg(Complex.'constructor'.fromReal(singlePhaseTransformerQS1.resistor2.P, singlePhaseTransformerQS1.resistor2.Q), 0.0)) "Power factor";
//   Real singlePhaseTransformerQS1.resistor2.omega(quantity = "AngularVelocity", unit = "rad/s") "Angular velocity of reference frame";
//   Real singlePhaseTransformerQS1.resistor2.pin_p.v.re(quantity = "ElectricPotential", unit = "V") "Real part of complex number";
//   Real singlePhaseTransformerQS1.resistor2.pin_p.v.im(quantity = "ElectricPotential", unit = "V") "Imaginary part of complex number";
//   Real singlePhaseTransformerQS1.resistor2.pin_p.i.re(quantity = "ElectricCurrent", unit = "A") "Real part of complex number";
//   Real singlePhaseTransformerQS1.resistor2.pin_p.i.im(quantity = "ElectricCurrent", unit = "A") "Imaginary part of complex number";
//   Real singlePhaseTransformerQS1.resistor2.pin_p.reference.gamma(quantity = "Angle", unit = "rad", displayUnit = "deg");
//   Real singlePhaseTransformerQS1.resistor2.pin_n.v.re(quantity = "ElectricPotential", unit = "V") "Real part of complex number";
//   Real singlePhaseTransformerQS1.resistor2.pin_n.v.im(quantity = "ElectricPotential", unit = "V") "Imaginary part of complex number";
//   Real singlePhaseTransformerQS1.resistor2.pin_n.i.re(quantity = "ElectricCurrent", unit = "A") "Real part of complex number";
//   Real singlePhaseTransformerQS1.resistor2.pin_n.i.im(quantity = "ElectricCurrent", unit = "A") "Imaginary part of complex number";
//   Real singlePhaseTransformerQS1.resistor2.pin_n.reference.gamma(quantity = "Angle", unit = "rad", displayUnit = "deg");
//   final parameter Real singlePhaseTransformerQS1.resistor2.R_ref(quantity = "Resistance", unit = "Ohm", start = 1.0) = singlePhaseTransformerQS1.R2 "Reference resistance at T_ref";
//   final parameter Real singlePhaseTransformerQS1.resistor2.T_ref(quantity = "ThermodynamicTemperature", unit = "K", displayUnit = "degC", min = 0.0, start = 288.15, nominal = 300.0) = singlePhaseTransformerQS1.TRef "Reference temperature";
//   final parameter Real singlePhaseTransformerQS1.resistor2.alpha_ref(quantity = "LinearTemperatureCoefficient", unit = "1/K") = singlePhaseTransformerQS1.alpha20_2 "Temperature coefficient of resistance (R_actual = R_ref*(1 + alpha_ref*(heatPort.T - T_ref))";
//   final parameter Boolean singlePhaseTransformerQS1.resistor2.useHeatPort = false "=true, if heatPort is enabled";
//   final parameter Real singlePhaseTransformerQS1.resistor2.T(quantity = "ThermodynamicTemperature", unit = "K", displayUnit = "degC", min = 0.0, start = 288.15, nominal = 300.0) = singlePhaseTransformerQS1.TOperational "Fixed device temperature if useHeatPort = false";
//   Real singlePhaseTransformerQS1.resistor2.LossPower(quantity = "Power", unit = "W") "Loss power leaving component via heatPort";
//   Real singlePhaseTransformerQS1.resistor2.T_heatPort(quantity = "ThermodynamicTemperature", unit = "K", displayUnit = "degC", min = 0.0, start = 288.15, nominal = 300.0) "Temperature of heatPort";
//   Real singlePhaseTransformerQS1.resistor2.R_actual(quantity = "Resistance", unit = "Ohm") "Resistance = R_ref*(1 + alpha_ref*(heatPort.T - T_ref))";
//   Real singlePhaseTransformerQS1.inductorh.v.re(quantity = "ElectricPotential", unit = "V") "Real part of complex number";
//   Real singlePhaseTransformerQS1.inductorh.v.im(quantity = "ElectricPotential", unit = "V") "Imaginary part of complex number";
//   Real singlePhaseTransformerQS1.inductorh.abs_v(quantity = "ElectricPotential", unit = "V") = Modelica.ComplexMath.'abs'(singlePhaseTransformerQS1.inductorh.v) "Magnitude of complex voltage";
//   Real singlePhaseTransformerQS1.inductorh.arg_v(quantity = "Angle", unit = "rad", displayUnit = "deg") = Modelica.ComplexMath.arg(singlePhaseTransformerQS1.inductorh.v, 0.0) "Argument of complex voltage";
//   Real singlePhaseTransformerQS1.inductorh.i.re(quantity = "ElectricCurrent", unit = "A") "Real part of complex number";
//   Real singlePhaseTransformerQS1.inductorh.i.im(quantity = "ElectricCurrent", unit = "A") "Imaginary part of complex number";
//   Real singlePhaseTransformerQS1.inductorh.abs_i(quantity = "ElectricCurrent", unit = "A") = Modelica.ComplexMath.'abs'(singlePhaseTransformerQS1.inductorh.i) "Magnitude of complex current";
//   Real singlePhaseTransformerQS1.inductorh.arg_i(quantity = "Angle", unit = "rad", displayUnit = "deg") = Modelica.ComplexMath.arg(singlePhaseTransformerQS1.inductorh.i, 0.0) "Argument of complex current";
//   Real singlePhaseTransformerQS1.inductorh.P(quantity = "Power", unit = "W") = Modelica.ComplexMath.real(Modelica.SIunits.ComplexVoltage.'*'.multiply(singlePhaseTransformerQS1.inductorh.v, Modelica.ComplexMath.conj(singlePhaseTransformerQS1.inductorh.i))) "Active power";
//   Real singlePhaseTransformerQS1.inductorh.Q(quantity = "Power", unit = "var") = Modelica.ComplexMath.imag(Modelica.SIunits.ComplexVoltage.'*'.multiply(singlePhaseTransformerQS1.inductorh.v, Modelica.ComplexMath.conj(singlePhaseTransformerQS1.inductorh.i))) "Reactive power";
//   Real singlePhaseTransformerQS1.inductorh.S(quantity = "Power", unit = "VA") = Modelica.ComplexMath.'abs'(Modelica.SIunits.ComplexVoltage.'*'.multiply(singlePhaseTransformerQS1.inductorh.v, Modelica.ComplexMath.conj(singlePhaseTransformerQS1.inductorh.i))) "Magnitude of complex apparent power";
//   Real singlePhaseTransformerQS1.inductorh.pf = cos(Modelica.ComplexMath.arg(Complex.'constructor'.fromReal(singlePhaseTransformerQS1.inductorh.P, singlePhaseTransformerQS1.inductorh.Q), 0.0)) "Power factor";
//   Real singlePhaseTransformerQS1.inductorh.omega(quantity = "AngularVelocity", unit = "rad/s") "Angular velocity of reference frame";
//   Real singlePhaseTransformerQS1.inductorh.pin_p.v.re(quantity = "ElectricPotential", unit = "V") "Real part of complex number";
//   Real singlePhaseTransformerQS1.inductorh.pin_p.v.im(quantity = "ElectricPotential", unit = "V") "Imaginary part of complex number";
//   Real singlePhaseTransformerQS1.inductorh.pin_p.i.re(quantity = "ElectricCurrent", unit = "A") "Real part of complex number";
//   Real singlePhaseTransformerQS1.inductorh.pin_p.i.im(quantity = "ElectricCurrent", unit = "A") "Imaginary part of complex number";
//   Real singlePhaseTransformerQS1.inductorh.pin_p.reference.gamma(quantity = "Angle", unit = "rad", displayUnit = "deg");
//   Real singlePhaseTransformerQS1.inductorh.pin_n.v.re(quantity = "ElectricPotential", unit = "V") "Real part of complex number";
//   Real singlePhaseTransformerQS1.inductorh.pin_n.v.im(quantity = "ElectricPotential", unit = "V") "Imaginary part of complex number";
//   Real singlePhaseTransformerQS1.inductorh.pin_n.i.re(quantity = "ElectricCurrent", unit = "A") "Real part of complex number";
//   Real singlePhaseTransformerQS1.inductorh.pin_n.i.im(quantity = "ElectricCurrent", unit = "A") "Imaginary part of complex number";
//   Real singlePhaseTransformerQS1.inductorh.pin_n.reference.gamma(quantity = "Angle", unit = "rad", displayUnit = "deg");
//   final parameter Real singlePhaseTransformerQS1.inductorh.L(quantity = "Inductance", unit = "H", start = 1.0) = 1.79 "Inductance";
//   final parameter Real singlePhaseTransformerQS1.idealTransformer.n = singlePhaseTransformerQS1.N1 / singlePhaseTransformerQS1.N2 "Ratio of primary to secondary voltage";
//   Real singlePhaseTransformerQS1.idealTransformer.v1.re(quantity = "ElectricPotential", unit = "V") "Real part of complex number";
//   Real singlePhaseTransformerQS1.idealTransformer.v1.im(quantity = "ElectricPotential", unit = "V") "Imaginary part of complex number";
//   Real singlePhaseTransformerQS1.idealTransformer.i1.re(quantity = "ElectricCurrent", unit = "A") = singlePhaseTransformerQS1.idealTransformer.pin_p1.i.re "Real part of complex number";
//   Real singlePhaseTransformerQS1.idealTransformer.i1.im(quantity = "ElectricCurrent", unit = "A") = singlePhaseTransformerQS1.idealTransformer.pin_p1.i.im "Imaginary part of complex number";
//   Real singlePhaseTransformerQS1.idealTransformer.v2.re(quantity = "ElectricPotential", unit = "V") "Real part of complex number";
//   Real singlePhaseTransformerQS1.idealTransformer.v2.im(quantity = "ElectricPotential", unit = "V") "Imaginary part of complex number";
//   Real singlePhaseTransformerQS1.idealTransformer.i2.re(quantity = "ElectricCurrent", unit = "A") = singlePhaseTransformerQS1.idealTransformer.pin_p2.i.re "Real part of complex number";
//   Real singlePhaseTransformerQS1.idealTransformer.i2.im(quantity = "ElectricCurrent", unit = "A") = singlePhaseTransformerQS1.idealTransformer.pin_p2.i.im "Imaginary part of complex number";
//   Real singlePhaseTransformerQS1.idealTransformer.pin_p1.v.re(quantity = "ElectricPotential", unit = "V") "Real part of complex number";
//   Real singlePhaseTransformerQS1.idealTransformer.pin_p1.v.im(quantity = "ElectricPotential", unit = "V") "Imaginary part of complex number";
//   Real singlePhaseTransformerQS1.idealTransformer.pin_p1.i.re(quantity = "ElectricCurrent", unit = "A") "Real part of complex number";
//   Real singlePhaseTransformerQS1.idealTransformer.pin_p1.i.im(quantity = "ElectricCurrent", unit = "A") "Imaginary part of complex number";
//   Real singlePhaseTransformerQS1.idealTransformer.pin_p1.reference.gamma(quantity = "Angle", unit = "rad", displayUnit = "deg");
//   Real singlePhaseTransformerQS1.idealTransformer.pin_p2.v.re(quantity = "ElectricPotential", unit = "V") "Real part of complex number";
//   Real singlePhaseTransformerQS1.idealTransformer.pin_p2.v.im(quantity = "ElectricPotential", unit = "V") "Imaginary part of complex number";
//   Real singlePhaseTransformerQS1.idealTransformer.pin_p2.i.re(quantity = "ElectricCurrent", unit = "A") "Real part of complex number";
//   Real singlePhaseTransformerQS1.idealTransformer.pin_p2.i.im(quantity = "ElectricCurrent", unit = "A") "Imaginary part of complex number";
//   Real singlePhaseTransformerQS1.idealTransformer.pin_p2.reference.gamma(quantity = "Angle", unit = "rad", displayUnit = "deg");
//   Real singlePhaseTransformerQS1.idealTransformer.pin_n1.v.re(quantity = "ElectricPotential", unit = "V") "Real part of complex number";
//   Real singlePhaseTransformerQS1.idealTransformer.pin_n1.v.im(quantity = "ElectricPotential", unit = "V") "Imaginary part of complex number";
//   Real singlePhaseTransformerQS1.idealTransformer.pin_n1.i.re(quantity = "ElectricCurrent", unit = "A") "Real part of complex number";
//   Real singlePhaseTransformerQS1.idealTransformer.pin_n1.i.im(quantity = "ElectricCurrent", unit = "A") "Imaginary part of complex number";
//   Real singlePhaseTransformerQS1.idealTransformer.pin_n1.reference.gamma(quantity = "Angle", unit = "rad", displayUnit = "deg");
//   Real singlePhaseTransformerQS1.idealTransformer.pin_n2.v.re(quantity = "ElectricPotential", unit = "V") "Real part of complex number";
//   Real singlePhaseTransformerQS1.idealTransformer.pin_n2.v.im(quantity = "ElectricPotential", unit = "V") "Imaginary part of complex number";
//   Real singlePhaseTransformerQS1.idealTransformer.pin_n2.i.re(quantity = "ElectricCurrent", unit = "A") "Real part of complex number";
//   Real singlePhaseTransformerQS1.idealTransformer.pin_n2.i.im(quantity = "ElectricCurrent", unit = "A") "Imaginary part of complex number";
//   Real singlePhaseTransformerQS1.idealTransformer.pin_n2.reference.gamma(quantity = "Angle", unit = "rad", displayUnit = "deg");
//   Real singlePhaseTransformerQS1.conductor.v.re(quantity = "ElectricPotential", unit = "V") "Real part of complex number";
//   Real singlePhaseTransformerQS1.conductor.v.im(quantity = "ElectricPotential", unit = "V") "Imaginary part of complex number";
//   Real singlePhaseTransformerQS1.conductor.abs_v(quantity = "ElectricPotential", unit = "V") = Modelica.ComplexMath.'abs'(singlePhaseTransformerQS1.conductor.v) "Magnitude of complex voltage";
//   Real singlePhaseTransformerQS1.conductor.arg_v(quantity = "Angle", unit = "rad", displayUnit = "deg") = Modelica.ComplexMath.arg(singlePhaseTransformerQS1.conductor.v, 0.0) "Argument of complex voltage";
//   Real singlePhaseTransformerQS1.conductor.i.re(quantity = "ElectricCurrent", unit = "A") "Real part of complex number";
//   Real singlePhaseTransformerQS1.conductor.i.im(quantity = "ElectricCurrent", unit = "A") "Imaginary part of complex number";
//   Real singlePhaseTransformerQS1.conductor.abs_i(quantity = "ElectricCurrent", unit = "A") = Modelica.ComplexMath.'abs'(singlePhaseTransformerQS1.conductor.i) "Magnitude of complex current";
//   Real singlePhaseTransformerQS1.conductor.arg_i(quantity = "Angle", unit = "rad", displayUnit = "deg") = Modelica.ComplexMath.arg(singlePhaseTransformerQS1.conductor.i, 0.0) "Argument of complex current";
//   Real singlePhaseTransformerQS1.conductor.P(quantity = "Power", unit = "W") = Modelica.ComplexMath.real(Modelica.SIunits.ComplexVoltage.'*'.multiply(singlePhaseTransformerQS1.conductor.v, Modelica.ComplexMath.conj(singlePhaseTransformerQS1.conductor.i))) "Active power";
//   Real singlePhaseTransformerQS1.conductor.Q(quantity = "Power", unit = "var") = Modelica.ComplexMath.imag(Modelica.SIunits.ComplexVoltage.'*'.multiply(singlePhaseTransformerQS1.conductor.v, Modelica.ComplexMath.conj(singlePhaseTransformerQS1.conductor.i))) "Reactive power";
//   Real singlePhaseTransformerQS1.conductor.S(quantity = "Power", unit = "VA") = Modelica.ComplexMath.'abs'(Modelica.SIunits.ComplexVoltage.'*'.multiply(singlePhaseTransformerQS1.conductor.v, Modelica.ComplexMath.conj(singlePhaseTransformerQS1.conductor.i))) "Magnitude of complex apparent power";
//   Real singlePhaseTransformerQS1.conductor.pf = cos(Modelica.ComplexMath.arg(Complex.'constructor'.fromReal(singlePhaseTransformerQS1.conductor.P, singlePhaseTransformerQS1.conductor.Q), 0.0)) "Power factor";
//   Real singlePhaseTransformerQS1.conductor.omega(quantity = "AngularVelocity", unit = "rad/s") "Angular velocity of reference frame";
//   Real singlePhaseTransformerQS1.conductor.pin_p.v.re(quantity = "ElectricPotential", unit = "V") "Real part of complex number";
//   Real singlePhaseTransformerQS1.conductor.pin_p.v.im(quantity = "ElectricPotential", unit = "V") "Imaginary part of complex number";
//   Real singlePhaseTransformerQS1.conductor.pin_p.i.re(quantity = "ElectricCurrent", unit = "A") "Real part of complex number";
//   Real singlePhaseTransformerQS1.conductor.pin_p.i.im(quantity = "ElectricCurrent", unit = "A") "Imaginary part of complex number";
//   Real singlePhaseTransformerQS1.conductor.pin_p.reference.gamma(quantity = "Angle", unit = "rad", displayUnit = "deg");
//   Real singlePhaseTransformerQS1.conductor.pin_n.v.re(quantity = "ElectricPotential", unit = "V") "Real part of complex number";
//   Real singlePhaseTransformerQS1.conductor.pin_n.v.im(quantity = "ElectricPotential", unit = "V") "Imaginary part of complex number";
//   Real singlePhaseTransformerQS1.conductor.pin_n.i.re(quantity = "ElectricCurrent", unit = "A") "Real part of complex number";
//   Real singlePhaseTransformerQS1.conductor.pin_n.i.im(quantity = "ElectricCurrent", unit = "A") "Imaginary part of complex number";
//   Real singlePhaseTransformerQS1.conductor.pin_n.reference.gamma(quantity = "Angle", unit = "rad", displayUnit = "deg");
//   final parameter Real singlePhaseTransformerQS1.conductor.G_ref(quantity = "Conductance", unit = "S", start = 1.0) = 5.149330587023687e-4 "Reference conductance at T_ref";
//   parameter Real singlePhaseTransformerQS1.conductor.T_ref(quantity = "ThermodynamicTemperature", unit = "K", displayUnit = "degC", min = 0.0, start = 288.15, nominal = 300.0) = 293.15 "Reference temperature";
//   parameter Real singlePhaseTransformerQS1.conductor.alpha_ref(quantity = "LinearTemperatureCoefficient", unit = "1/K") = 0.0 "Temperature coefficient of conductance (G_actual = G_ref/(1 + alpha_ref*(heatPort.T - T_ref))";
//   final parameter Boolean singlePhaseTransformerQS1.conductor.useHeatPort = false "=true, if heatPort is enabled";
//   parameter Real singlePhaseTransformerQS1.conductor.T(quantity = "ThermodynamicTemperature", unit = "K", displayUnit = "degC", min = 0.0, start = 288.15, nominal = 300.0) = singlePhaseTransformerQS1.conductor.T_ref "Fixed device temperature if useHeatPort = false";
//   Real singlePhaseTransformerQS1.conductor.LossPower(quantity = "Power", unit = "W") "Loss power leaving component via heatPort";
//   Real singlePhaseTransformerQS1.conductor.T_heatPort(quantity = "ThermodynamicTemperature", unit = "K", displayUnit = "degC", min = 0.0, start = 288.15, nominal = 300.0) "Temperature of heatPort";
//   Real singlePhaseTransformerQS1.conductor.G_actual(quantity = "Conductance", unit = "S") "Conductance = G_ref/(1 + alpha_ref*(heatPort.T - T_ref))";
//   Real singlePhaseTransformerQS1.pin_p1.v.re(quantity = "ElectricPotential", unit = "V") "Real part of complex number";
//   Real singlePhaseTransformerQS1.pin_p1.v.im(quantity = "ElectricPotential", unit = "V") "Imaginary part of complex number";
//   Real singlePhaseTransformerQS1.pin_p1.i.re(quantity = "ElectricCurrent", unit = "A") "Real part of complex number";
//   Real singlePhaseTransformerQS1.pin_p1.i.im(quantity = "ElectricCurrent", unit = "A") "Imaginary part of complex number";
//   Real singlePhaseTransformerQS1.pin_p1.reference.gamma(quantity = "Angle", unit = "rad", displayUnit = "deg");
//   Real singlePhaseTransformerQS1.pin_p2.v.re(quantity = "ElectricPotential", unit = "V") "Real part of complex number";
//   Real singlePhaseTransformerQS1.pin_p2.v.im(quantity = "ElectricPotential", unit = "V") "Imaginary part of complex number";
//   Real singlePhaseTransformerQS1.pin_p2.i.re(quantity = "ElectricCurrent", unit = "A") "Real part of complex number";
//   Real singlePhaseTransformerQS1.pin_p2.i.im(quantity = "ElectricCurrent", unit = "A") "Imaginary part of complex number";
//   Real singlePhaseTransformerQS1.pin_p2.reference.gamma(quantity = "Angle", unit = "rad", displayUnit = "deg");
//   Real singlePhaseTransformerQS1.pin_n1.v.re(quantity = "ElectricPotential", unit = "V") "Real part of complex number";
//   Real singlePhaseTransformerQS1.pin_n1.v.im(quantity = "ElectricPotential", unit = "V") "Imaginary part of complex number";
//   Real singlePhaseTransformerQS1.pin_n1.i.re(quantity = "ElectricCurrent", unit = "A") "Real part of complex number";
//   Real singlePhaseTransformerQS1.pin_n1.i.im(quantity = "ElectricCurrent", unit = "A") "Imaginary part of complex number";
//   Real singlePhaseTransformerQS1.pin_n1.reference.gamma(quantity = "Angle", unit = "rad", displayUnit = "deg");
//   Real singlePhaseTransformerQS1.pin_n2.v.re(quantity = "ElectricPotential", unit = "V") "Real part of complex number";
//   Real singlePhaseTransformerQS1.pin_n2.v.im(quantity = "ElectricPotential", unit = "V") "Imaginary part of complex number";
//   Real singlePhaseTransformerQS1.pin_n2.i.re(quantity = "ElectricCurrent", unit = "A") "Real part of complex number";
//   Real singlePhaseTransformerQS1.pin_n2.i.im(quantity = "ElectricCurrent", unit = "A") "Imaginary part of complex number";
//   Real singlePhaseTransformerQS1.pin_n2.reference.gamma(quantity = "Angle", unit = "rad", displayUnit = "deg");
//   Real ground1.pin.v.re(quantity = "ElectricPotential", unit = "V") "Real part of complex number";
//   Real ground1.pin.v.im(quantity = "ElectricPotential", unit = "V") "Imaginary part of complex number";
//   Real ground1.pin.i.re(quantity = "ElectricCurrent", unit = "A") "Real part of complex number";
//   Real ground1.pin.i.im(quantity = "ElectricCurrent", unit = "A") "Imaginary part of complex number";
//   Real ground1.pin.reference.gamma(quantity = "Angle", unit = "rad", displayUnit = "deg");
//   Real currentSensor2.v.re(quantity = "ElectricPotential", unit = "V") "Real part of complex number";
//   Real currentSensor2.v.im(quantity = "ElectricPotential", unit = "V") "Imaginary part of complex number";
//   Real currentSensor2.abs_v(quantity = "ElectricPotential", unit = "V") = Modelica.ComplexMath.'abs'(currentSensor2.v) "Magnitude of complex voltage";
//   Real currentSensor2.arg_v(quantity = "Angle", unit = "rad", displayUnit = "deg") = Modelica.ComplexMath.arg(currentSensor2.v, 0.0) "Argument of complex voltage";
//   Real currentSensor2.i.re(quantity = "ElectricCurrent", unit = "A") "Real part of complex number";
//   Real currentSensor2.i.im(quantity = "ElectricCurrent", unit = "A") "Imaginary part of complex number";
//   Real currentSensor2.abs_i(quantity = "ElectricCurrent", unit = "A") = Modelica.ComplexMath.'abs'(currentSensor2.i) "Magnitude of complex current";
//   Real currentSensor2.arg_i(quantity = "Angle", unit = "rad", displayUnit = "deg") = Modelica.ComplexMath.arg(currentSensor2.i, 0.0) "Argument of complex current";
//   Real currentSensor2.P(quantity = "Power", unit = "W") = Modelica.ComplexMath.real(Modelica.SIunits.ComplexVoltage.'*'.multiply(currentSensor2.v, Modelica.ComplexMath.conj(currentSensor2.i))) "Active power";
//   Real currentSensor2.Q(quantity = "Power", unit = "var") = Modelica.ComplexMath.imag(Modelica.SIunits.ComplexVoltage.'*'.multiply(currentSensor2.v, Modelica.ComplexMath.conj(currentSensor2.i))) "Reactive power";
//   Real currentSensor2.S(quantity = "Power", unit = "VA") = Modelica.ComplexMath.'abs'(Modelica.SIunits.ComplexVoltage.'*'.multiply(currentSensor2.v, Modelica.ComplexMath.conj(currentSensor2.i))) "Magnitude of complex apparent power";
//   Real currentSensor2.pf = cos(Modelica.ComplexMath.arg(Complex.'constructor'.fromReal(currentSensor2.P, currentSensor2.Q), 0.0)) "Power factor";
//   Real currentSensor2.omega(quantity = "AngularVelocity", unit = "rad/s") "Angular velocity of reference frame";
//   Real currentSensor2.pin_p.v.re(quantity = "ElectricPotential", unit = "V") "Real part of complex number";
//   Real currentSensor2.pin_p.v.im(quantity = "ElectricPotential", unit = "V") "Imaginary part of complex number";
//   Real currentSensor2.pin_p.i.re(quantity = "ElectricCurrent", unit = "A") "Real part of complex number";
//   Real currentSensor2.pin_p.i.im(quantity = "ElectricCurrent", unit = "A") "Imaginary part of complex number";
//   Real currentSensor2.pin_p.reference.gamma(quantity = "Angle", unit = "rad", displayUnit = "deg");
//   Real currentSensor2.pin_n.v.re(quantity = "ElectricPotential", unit = "V") "Real part of complex number";
//   Real currentSensor2.pin_n.v.im(quantity = "ElectricPotential", unit = "V") "Imaginary part of complex number";
//   Real currentSensor2.pin_n.i.re(quantity = "ElectricCurrent", unit = "A") "Real part of complex number";
//   Real currentSensor2.pin_n.i.im(quantity = "ElectricCurrent", unit = "A") "Imaginary part of complex number";
//   Real currentSensor2.pin_n.reference.gamma(quantity = "Angle", unit = "rad", displayUnit = "deg");
//   Real currentSensor2.y.re "Real part of complex number";
//   Real currentSensor2.y.im "Imaginary part of complex number";
//   Real currentSensor2.abs_y(quantity = "ElectricCurrent", unit = "A") = Modelica.ComplexMath.'abs'(currentSensor2.y) "Magnitude of complex current";
//   Real currentSensor2.arg_y(quantity = "Angle", unit = "rad", displayUnit = "deg") = Modelica.ComplexMath.arg(currentSensor2.y, 0.0) "Argument of complex current";
//   Real voltageSource1.v.re(quantity = "ElectricPotential", unit = "V") "Real part of complex number";
//   Real voltageSource1.v.im(quantity = "ElectricPotential", unit = "V") "Imaginary part of complex number";
//   Real voltageSource1.abs_v(quantity = "ElectricPotential", unit = "V") = Modelica.ComplexMath.'abs'(voltageSource1.v) "Magnitude of complex voltage";
//   Real voltageSource1.arg_v(quantity = "Angle", unit = "rad", displayUnit = "deg") = Modelica.ComplexMath.arg(voltageSource1.v, 0.0) "Argument of complex voltage";
//   Real voltageSource1.i.re(quantity = "ElectricCurrent", unit = "A") "Real part of complex number";
//   Real voltageSource1.i.im(quantity = "ElectricCurrent", unit = "A") "Imaginary part of complex number";
//   Real voltageSource1.abs_i(quantity = "ElectricCurrent", unit = "A") = Modelica.ComplexMath.'abs'(voltageSource1.i) "Magnitude of complex current";
//   Real voltageSource1.arg_i(quantity = "Angle", unit = "rad", displayUnit = "deg") = Modelica.ComplexMath.arg(voltageSource1.i, 0.0) "Argument of complex current";
//   Real voltageSource1.P(quantity = "Power", unit = "W") = Modelica.ComplexMath.real(Modelica.SIunits.ComplexVoltage.'*'.multiply(voltageSource1.v, Modelica.ComplexMath.conj(voltageSource1.i))) "Active power";
//   Real voltageSource1.Q(quantity = "Power", unit = "var") = Modelica.ComplexMath.imag(Modelica.SIunits.ComplexVoltage.'*'.multiply(voltageSource1.v, Modelica.ComplexMath.conj(voltageSource1.i))) "Reactive power";
//   Real voltageSource1.S(quantity = "Power", unit = "VA") = Modelica.ComplexMath.'abs'(Modelica.SIunits.ComplexVoltage.'*'.multiply(voltageSource1.v, Modelica.ComplexMath.conj(voltageSource1.i))) "Magnitude of complex apparent power";
//   Real voltageSource1.pf = cos(Modelica.ComplexMath.arg(Complex.'constructor'.fromReal(voltageSource1.P, voltageSource1.Q), 0.0)) "Power factor";
//   Real voltageSource1.omega(quantity = "AngularVelocity", unit = "rad/s") "Angular velocity of reference frame";
//   Real voltageSource1.pin_p.v.re(quantity = "ElectricPotential", unit = "V") "Real part of complex number";
//   Real voltageSource1.pin_p.v.im(quantity = "ElectricPotential", unit = "V") "Imaginary part of complex number";
//   Real voltageSource1.pin_p.i.re(quantity = "ElectricCurrent", unit = "A") "Real part of complex number";
//   Real voltageSource1.pin_p.i.im(quantity = "ElectricCurrent", unit = "A") "Imaginary part of complex number";
//   Real voltageSource1.pin_p.reference.gamma(quantity = "Angle", unit = "rad", displayUnit = "deg");
//   Real voltageSource1.pin_n.v.re(quantity = "ElectricPotential", unit = "V") "Real part of complex number";
//   Real voltageSource1.pin_n.v.im(quantity = "ElectricPotential", unit = "V") "Imaginary part of complex number";
//   Real voltageSource1.pin_n.i.re(quantity = "ElectricCurrent", unit = "A") "Real part of complex number";
//   Real voltageSource1.pin_n.i.im(quantity = "ElectricCurrent", unit = "A") "Imaginary part of complex number";
//   Real voltageSource1.pin_n.reference.gamma(quantity = "Angle", unit = "rad", displayUnit = "deg");
//   Real voltageSource1.gamma(quantity = "Angle", unit = "rad", displayUnit = "deg", start = 0.0) = voltageSource1.pin_p.reference.gamma;
//   parameter Real voltageSource1.f(quantity = "Frequency", unit = "Hz", start = 1.0) = 50.0 "frequency of the source";
//   parameter Real voltageSource1.V(quantity = "ElectricPotential", unit = "V", start = 1.0) = 98.5 "RMS voltage of the source";
//   parameter Real voltageSource1.phi(quantity = "Angle", unit = "rad", displayUnit = "deg", start = 0.0) = 0.0 "phase shift of the source";
//   Real powerSensor1.currentP.v.re(quantity = "ElectricPotential", unit = "V") "Real part of complex number";
//   Real powerSensor1.currentP.v.im(quantity = "ElectricPotential", unit = "V") "Imaginary part of complex number";
//   Real powerSensor1.currentP.i.re(quantity = "ElectricCurrent", unit = "A") "Real part of complex number";
//   Real powerSensor1.currentP.i.im(quantity = "ElectricCurrent", unit = "A") "Imaginary part of complex number";
//   Real powerSensor1.currentP.reference.gamma(quantity = "Angle", unit = "rad", displayUnit = "deg");
//   Real powerSensor1.currentN.v.re(quantity = "ElectricPotential", unit = "V") "Real part of complex number";
//   Real powerSensor1.currentN.v.im(quantity = "ElectricPotential", unit = "V") "Imaginary part of complex number";
//   Real powerSensor1.currentN.i.re(quantity = "ElectricCurrent", unit = "A") "Real part of complex number";
//   Real powerSensor1.currentN.i.im(quantity = "ElectricCurrent", unit = "A") "Imaginary part of complex number";
//   Real powerSensor1.currentN.reference.gamma(quantity = "Angle", unit = "rad", displayUnit = "deg");
//   Real powerSensor1.voltageP.v.re(quantity = "ElectricPotential", unit = "V") "Real part of complex number";
//   Real powerSensor1.voltageP.v.im(quantity = "ElectricPotential", unit = "V") "Imaginary part of complex number";
//   Real powerSensor1.voltageP.i.re(quantity = "ElectricCurrent", unit = "A") "Real part of complex number";
//   Real powerSensor1.voltageP.i.im(quantity = "ElectricCurrent", unit = "A") "Imaginary part of complex number";
//   Real powerSensor1.voltageP.reference.gamma(quantity = "Angle", unit = "rad", displayUnit = "deg");
//   Real powerSensor1.voltageN.v.re(quantity = "ElectricPotential", unit = "V") "Real part of complex number";
//   Real powerSensor1.voltageN.v.im(quantity = "ElectricPotential", unit = "V") "Imaginary part of complex number";
//   Real powerSensor1.voltageN.i.re(quantity = "ElectricCurrent", unit = "A") "Real part of complex number";
//   Real powerSensor1.voltageN.i.im(quantity = "ElectricCurrent", unit = "A") "Imaginary part of complex number";
//   Real powerSensor1.voltageN.reference.gamma(quantity = "Angle", unit = "rad", displayUnit = "deg");
//   Real powerSensor1.i.re(quantity = "ElectricCurrent", unit = "A") "Real part of complex number";
//   Real powerSensor1.i.im(quantity = "ElectricCurrent", unit = "A") "Imaginary part of complex number";
//   Real powerSensor1.v.re(quantity = "ElectricPotential", unit = "V") "Real part of complex number";
//   Real powerSensor1.v.im(quantity = "ElectricPotential", unit = "V") "Imaginary part of complex number";
//   Real powerSensor1.y.re "Real part of complex number";
//   Real powerSensor1.y.im "Imaginary part of complex number";
//   Real powerSensor1.abs_y(quantity = "Power", unit = "VA") = Modelica.ComplexMath.'abs'(powerSensor1.y) "Magnitude of complex apparent power";
//   Real powerSensor1.arg_y(quantity = "Angle", unit = "rad", displayUnit = "deg") = Modelica.ComplexMath.arg(powerSensor1.y, 0.0) "Argument of complex apparent power";
// equation
//   singlePhaseTransformerQS1.pin_p1.v.re = singlePhaseTransformerQS1.resistor1.pin_p.v.re;
//   singlePhaseTransformerQS1.pin_p1.v.im = singlePhaseTransformerQS1.resistor1.pin_p.v.im;
//   singlePhaseTransformerQS1.resistor1.pin_p.i.re - singlePhaseTransformerQS1.pin_p1.i.re = 0.0;
//   singlePhaseTransformerQS1.resistor1.pin_p.i.im - singlePhaseTransformerQS1.pin_p1.i.im = 0.0;
//   singlePhaseTransformerQS1.resistor1.pin_n.reference.gamma = singlePhaseTransformerQS1.inductor1.pin_p.reference.gamma;
//   singlePhaseTransformerQS1.resistor1.pin_n.v.re = singlePhaseTransformerQS1.inductor1.pin_p.v.re;
//   singlePhaseTransformerQS1.resistor1.pin_n.v.im = singlePhaseTransformerQS1.inductor1.pin_p.v.im;
//   singlePhaseTransformerQS1.inductor2.pin_p.v.re = singlePhaseTransformerQS1.resistor2.pin_n.v.re;
//   singlePhaseTransformerQS1.inductor2.pin_p.v.im = singlePhaseTransformerQS1.resistor2.pin_n.v.im;
//   singlePhaseTransformerQS1.idealTransformer.pin_n1.reference.gamma = singlePhaseTransformerQS1.pin_n1.reference.gamma;
//   singlePhaseTransformerQS1.idealTransformer.pin_n1.reference.gamma = singlePhaseTransformerQS1.inductorh.pin_n.reference.gamma;
//   singlePhaseTransformerQS1.conductor.pin_n.v.re = singlePhaseTransformerQS1.inductorh.pin_n.v.re;
//   singlePhaseTransformerQS1.conductor.pin_n.v.re = singlePhaseTransformerQS1.idealTransformer.pin_n1.v.re;
//   singlePhaseTransformerQS1.conductor.pin_n.v.re = singlePhaseTransformerQS1.pin_n1.v.re;
//   singlePhaseTransformerQS1.conductor.pin_n.v.im = singlePhaseTransformerQS1.inductorh.pin_n.v.im;
//   singlePhaseTransformerQS1.conductor.pin_n.v.im = singlePhaseTransformerQS1.idealTransformer.pin_n1.v.im;
//   singlePhaseTransformerQS1.conductor.pin_n.v.im = singlePhaseTransformerQS1.pin_n1.v.im;
//   singlePhaseTransformerQS1.conductor.pin_p.reference.gamma = singlePhaseTransformerQS1.inductorh.pin_p.reference.gamma;
//   singlePhaseTransformerQS1.inductor1.pin_n.reference.gamma = singlePhaseTransformerQS1.idealTransformer.pin_p1.reference.gamma;
//   singlePhaseTransformerQS1.inductor1.pin_n.v.re = singlePhaseTransformerQS1.idealTransformer.pin_p1.v.re;
//   singlePhaseTransformerQS1.inductor1.pin_n.v.re = singlePhaseTransformerQS1.conductor.pin_p.v.re;
//   singlePhaseTransformerQS1.inductor1.pin_n.v.re = singlePhaseTransformerQS1.inductorh.pin_p.v.re;
//   singlePhaseTransformerQS1.inductor1.pin_n.v.im = singlePhaseTransformerQS1.idealTransformer.pin_p1.v.im;
//   singlePhaseTransformerQS1.inductor1.pin_n.v.im = singlePhaseTransformerQS1.conductor.pin_p.v.im;
//   singlePhaseTransformerQS1.inductor1.pin_n.v.im = singlePhaseTransformerQS1.inductorh.pin_p.v.im;
//   singlePhaseTransformerQS1.idealTransformer.pin_n2.reference.gamma = singlePhaseTransformerQS1.pin_n2.reference.gamma;
//   singlePhaseTransformerQS1.idealTransformer.pin_n2.v.re = singlePhaseTransformerQS1.pin_n2.v.re;
//   singlePhaseTransformerQS1.idealTransformer.pin_n2.v.im = singlePhaseTransformerQS1.pin_n2.v.im;
//   singlePhaseTransformerQS1.idealTransformer.pin_p2.reference.gamma = singlePhaseTransformerQS1.inductor2.pin_n.reference.gamma;
//   singlePhaseTransformerQS1.idealTransformer.pin_p2.v.re = singlePhaseTransformerQS1.inductor2.pin_n.v.re;
//   singlePhaseTransformerQS1.idealTransformer.pin_p2.v.im = singlePhaseTransformerQS1.inductor2.pin_n.v.im;
//   singlePhaseTransformerQS1.resistor2.pin_p.reference.gamma = singlePhaseTransformerQS1.pin_p2.reference.gamma;
//   singlePhaseTransformerQS1.resistor2.pin_p.v.re = singlePhaseTransformerQS1.pin_p2.v.re;
//   singlePhaseTransformerQS1.resistor2.pin_p.v.im = singlePhaseTransformerQS1.pin_p2.v.im;
//   voltageSource1.pin_n.v.re = ground1.pin.v.re;
//   voltageSource1.pin_n.v.re = voltageSensor2.pin_n.v.re;
//   voltageSource1.pin_n.v.re = singlePhaseTransformerQS1.pin_n1.v.re;
//   voltageSource1.pin_n.v.re = powerSensor2.voltageN.v.re;
//   voltageSource1.pin_n.v.im = ground1.pin.v.im;
//   voltageSource1.pin_n.v.im = voltageSensor2.pin_n.v.im;
//   voltageSource1.pin_n.v.im = singlePhaseTransformerQS1.pin_n1.v.im;
//   voltageSource1.pin_n.v.im = powerSensor2.voltageN.v.im;
//   singlePhaseTransformerQS1.pin_p2.reference.gamma = powerSensor1.currentP.reference.gamma;
//   powerSensor1.currentP.v.re = powerSensor1.voltageP.v.re;
//   powerSensor1.currentP.v.re = singlePhaseTransformerQS1.pin_p2.v.re;
//   powerSensor1.currentP.v.im = powerSensor1.voltageP.v.im;
//   powerSensor1.currentP.v.im = singlePhaseTransformerQS1.pin_p2.v.im;
//   powerSensor1.currentN.reference.gamma = currentSensor1.pin_n.reference.gamma;
//   powerSensor1.currentN.v.re = currentSensor1.pin_n.v.re;
//   powerSensor1.currentN.v.im = currentSensor1.pin_n.v.im;
//   singlePhaseTransformerQS1.pin_n2.reference.gamma = ground2.pin.reference.gamma;
//   singlePhaseTransformerQS1.pin_n2.reference.gamma = voltageSensor1.pin_n.reference.gamma;
//   currentSensor1.pin_p.reference.gamma = voltageSensor1.pin_p.reference.gamma;
//   singlePhaseTransformerQS1.pin_n2.v.re = ground2.pin.v.re;
//   singlePhaseTransformerQS1.pin_n2.v.re = currentSensor1.pin_p.v.re;
//   singlePhaseTransformerQS1.pin_n2.v.re = voltageSensor1.pin_p.v.re;
//   singlePhaseTransformerQS1.pin_n2.v.re = voltageSensor1.pin_n.v.re;
//   singlePhaseTransformerQS1.pin_n2.v.re = powerSensor1.voltageN.v.re;
//   singlePhaseTransformerQS1.pin_n2.v.im = ground2.pin.v.im;
//   singlePhaseTransformerQS1.pin_n2.v.im = currentSensor1.pin_p.v.im;
//   singlePhaseTransformerQS1.pin_n2.v.im = voltageSensor1.pin_p.v.im;
//   singlePhaseTransformerQS1.pin_n2.v.im = voltageSensor1.pin_n.v.im;
//   singlePhaseTransformerQS1.pin_n2.v.im = powerSensor1.voltageN.v.im;
//   voltageSource1.pin_n.reference.gamma = ground1.pin.reference.gamma;
//   voltageSource1.pin_n.reference.gamma = singlePhaseTransformerQS1.pin_n1.reference.gamma;
//   singlePhaseTransformerQS1.pin_p1.reference.gamma = powerSensor2.currentN.reference.gamma;
//   singlePhaseTransformerQS1.pin_p1.reference.gamma = voltageSensor2.pin_p.reference.gamma;
//   singlePhaseTransformerQS1.pin_p1.v.re = powerSensor2.currentN.v.re;
//   singlePhaseTransformerQS1.pin_p1.v.re = voltageSensor2.pin_p.v.re;
//   singlePhaseTransformerQS1.pin_p1.v.im = powerSensor2.currentN.v.im;
//   singlePhaseTransformerQS1.pin_p1.v.im = voltageSensor2.pin_p.v.im;
//   currentSensor2.pin_p.reference.gamma = powerSensor2.currentP.reference.gamma;
//   powerSensor2.currentP.v.re = powerSensor2.voltageP.v.re;
//   powerSensor2.currentP.v.re = currentSensor2.pin_p.v.re;
//   powerSensor2.currentP.v.im = powerSensor2.voltageP.v.im;
//   powerSensor2.currentP.v.im = currentSensor2.pin_p.v.im;
//   voltageSource1.pin_p.reference.gamma = currentSensor2.pin_n.reference.gamma;
//   voltageSource1.pin_p.v.re = currentSensor2.pin_n.v.re;
//   voltageSource1.pin_p.v.im = currentSensor2.pin_n.v.im;
//   voltageSource1.pin_n.i.re + ground1.pin.i.re + singlePhaseTransformerQS1.pin_n1.i.re + voltageSensor2.pin_n.i.re + powerSensor2.voltageN.i.re = 0.0;
//   voltageSource1.pin_n.i.im + ground1.pin.i.im + singlePhaseTransformerQS1.pin_n1.i.im + voltageSensor2.pin_n.i.im + powerSensor2.voltageN.i.im = 0.0;
//   singlePhaseTransformerQS1.pin_p1.i.re + voltageSensor2.pin_p.i.re + powerSensor2.currentN.i.re = 0.0;
//   singlePhaseTransformerQS1.pin_p1.i.im + voltageSensor2.pin_p.i.im + powerSensor2.currentN.i.im = 0.0;
//   powerSensor1.voltageN.i.re + singlePhaseTransformerQS1.pin_n2.i.re + voltageSensor1.pin_n.i.re + voltageSensor1.pin_p.i.re + ground2.pin.i.re + currentSensor1.pin_p.i.re = 0.0;
//   powerSensor1.voltageN.i.im + singlePhaseTransformerQS1.pin_n2.i.im + voltageSensor1.pin_n.i.im + voltageSensor1.pin_p.i.im + ground2.pin.i.im + currentSensor1.pin_p.i.im = 0.0;
//   singlePhaseTransformerQS1.conductor.pin_p.i.re + singlePhaseTransformerQS1.idealTransformer.pin_p1.i.re + singlePhaseTransformerQS1.inductorh.pin_p.i.re + singlePhaseTransformerQS1.inductor1.pin_n.i.re = 0.0;
//   singlePhaseTransformerQS1.conductor.pin_p.i.im + singlePhaseTransformerQS1.idealTransformer.pin_p1.i.im + singlePhaseTransformerQS1.inductorh.pin_p.i.im + singlePhaseTransformerQS1.inductor1.pin_n.i.im = 0.0;
//   singlePhaseTransformerQS1.resistor2.pin_n.i.re + singlePhaseTransformerQS1.inductor2.pin_p.i.re = 0.0;
//   singlePhaseTransformerQS1.resistor2.pin_n.i.im + singlePhaseTransformerQS1.inductor2.pin_p.i.im = 0.0;
//   singlePhaseTransformerQS1.resistor1.pin_n.i.re + singlePhaseTransformerQS1.inductor1.pin_p.i.re = 0.0;
//   singlePhaseTransformerQS1.resistor1.pin_n.i.im + singlePhaseTransformerQS1.inductor1.pin_p.i.im = 0.0;
//   singlePhaseTransformerQS1.resistor2.pin_p.i.re - singlePhaseTransformerQS1.pin_p2.i.re = 0.0;
//   singlePhaseTransformerQS1.resistor2.pin_p.i.im - singlePhaseTransformerQS1.pin_p2.i.im = 0.0;
//   singlePhaseTransformerQS1.idealTransformer.pin_p2.i.re + singlePhaseTransformerQS1.inductor2.pin_n.i.re = 0.0;
//   singlePhaseTransformerQS1.idealTransformer.pin_p2.i.im + singlePhaseTransformerQS1.inductor2.pin_n.i.im = 0.0;
//   singlePhaseTransformerQS1.idealTransformer.pin_n2.i.re - singlePhaseTransformerQS1.pin_n2.i.re = 0.0;
//   singlePhaseTransformerQS1.idealTransformer.pin_n2.i.im - singlePhaseTransformerQS1.pin_n2.i.im = 0.0;
//   singlePhaseTransformerQS1.conductor.pin_n.i.re + singlePhaseTransformerQS1.idealTransformer.pin_n1.i.re + singlePhaseTransformerQS1.inductorh.pin_n.i.re - singlePhaseTransformerQS1.pin_n1.i.re = 0.0;
//   singlePhaseTransformerQS1.conductor.pin_n.i.im + singlePhaseTransformerQS1.idealTransformer.pin_n1.i.im + singlePhaseTransformerQS1.inductorh.pin_n.i.im - singlePhaseTransformerQS1.pin_n1.i.im = 0.0;
//   powerSensor1.voltageP.i.re + powerSensor1.currentP.i.re + singlePhaseTransformerQS1.pin_p2.i.re = 0.0;
//   powerSensor1.voltageP.i.im + powerSensor1.currentP.i.im + singlePhaseTransformerQS1.pin_p2.i.im = 0.0;
//   currentSensor2.pin_p.i.re + powerSensor2.voltageP.i.re + powerSensor2.currentP.i.re = 0.0;
//   currentSensor2.pin_p.i.im + powerSensor2.voltageP.i.im + powerSensor2.currentP.i.im = 0.0;
//   voltageSource1.pin_p.i.re + currentSensor2.pin_n.i.re = 0.0;
//   voltageSource1.pin_p.i.im + currentSensor2.pin_n.i.im = 0.0;
//   powerSensor1.currentN.i.re + currentSensor1.pin_n.i.re = 0.0;
//   powerSensor1.currentN.i.im + currentSensor1.pin_n.i.im = 0.0;
//   powerSensor2.currentP.reference.gamma = powerSensor2.currentN.reference.gamma;
//   powerSensor2.voltageP.reference.gamma = powerSensor2.voltageN.reference.gamma;
//   powerSensor2.currentP.reference.gamma = powerSensor2.voltageP.reference.gamma;
//   Modelica.SIunits.ComplexCurrent.'+'(powerSensor2.currentP.i, powerSensor2.currentN.i) = Complex(0.0, 0.0);
//   Modelica.SIunits.ComplexVoltage.'-'.subtract(powerSensor2.currentP.v, powerSensor2.currentN.v) = Complex(0.0, 0.0);
//   powerSensor2.i = powerSensor2.currentP.i;
//   Modelica.SIunits.ComplexCurrent.'+'(powerSensor2.voltageP.i, powerSensor2.voltageN.i) = Complex(0.0, 0.0);
//   powerSensor2.voltageP.i = Complex(0.0, 0.0);
//   powerSensor2.v = Modelica.SIunits.ComplexVoltage.'-'.subtract(powerSensor2.voltageP.v, powerSensor2.voltageN.v);
//   powerSensor2.y = Modelica.SIunits.ComplexVoltage.'*'.multiply(powerSensor2.v, Modelica.ComplexMath.conj(powerSensor2.i));
//   voltageSensor2.i = Complex(0.0, 0.0);
//   voltageSensor2.y = voltageSensor2.v;
//   Modelica.SIunits.ComplexCurrent.'+'(voltageSensor2.pin_p.i, voltageSensor2.pin_n.i) = Complex(0.0, 0.0);
//   voltageSensor2.pin_p.reference.gamma = voltageSensor2.pin_n.reference.gamma;
//   voltageSensor2.omega = der(voltageSensor2.pin_p.reference.gamma);
//   voltageSensor2.v = Modelica.SIunits.ComplexVoltage.'-'.subtract(voltageSensor2.pin_p.v, voltageSensor2.pin_n.v);
//   voltageSensor2.i = voltageSensor2.pin_p.i;
//   currentSensor1.v = Complex(0.0, 0.0);
//   currentSensor1.y = currentSensor1.i;
//   Modelica.SIunits.ComplexCurrent.'+'(currentSensor1.pin_p.i, currentSensor1.pin_n.i) = Complex(0.0, 0.0);
//   currentSensor1.pin_p.reference.gamma = currentSensor1.pin_n.reference.gamma;
//   currentSensor1.omega = der(currentSensor1.pin_p.reference.gamma);
//   currentSensor1.v = Modelica.SIunits.ComplexVoltage.'-'.subtract(currentSensor1.pin_p.v, currentSensor1.pin_n.v);
//   currentSensor1.i = currentSensor1.pin_p.i;
//   ground2.pin.v = Complex(0.0, 0.0);
//   voltageSensor1.i = Complex(0.0, 0.0);
//   voltageSensor1.y = voltageSensor1.v;
//   Modelica.SIunits.ComplexCurrent.'+'(voltageSensor1.pin_p.i, voltageSensor1.pin_n.i) = Complex(0.0, 0.0);
//   voltageSensor1.pin_p.reference.gamma = voltageSensor1.pin_n.reference.gamma;
//   voltageSensor1.omega = der(voltageSensor1.pin_p.reference.gamma);
//   voltageSensor1.v = Modelica.SIunits.ComplexVoltage.'-'.subtract(voltageSensor1.pin_p.v, voltageSensor1.pin_n.v);
//   voltageSensor1.i = voltageSensor1.pin_p.i;
//   singlePhaseTransformerQS1.inductor1.v = Complex.'*'.multiply(Complex.'*'.multiply(Complex.'*'.multiply(Complex(0.0, 1.0), Complex.'constructor'.fromReal(singlePhaseTransformerQS1.inductor1.omega, 0.0)), Complex.'constructor'.fromReal(singlePhaseTransformerQS1.inductor1.L, 0.0)), singlePhaseTransformerQS1.inductor1.i);
//   Modelica.SIunits.ComplexCurrent.'+'(singlePhaseTransformerQS1.inductor1.pin_p.i, singlePhaseTransformerQS1.inductor1.pin_n.i) = Complex(0.0, 0.0);
//   singlePhaseTransformerQS1.inductor1.pin_p.reference.gamma = singlePhaseTransformerQS1.inductor1.pin_n.reference.gamma;
//   singlePhaseTransformerQS1.inductor1.omega = der(singlePhaseTransformerQS1.inductor1.pin_p.reference.gamma);
//   singlePhaseTransformerQS1.inductor1.v = Modelica.SIunits.ComplexVoltage.'-'.subtract(singlePhaseTransformerQS1.inductor1.pin_p.v, singlePhaseTransformerQS1.inductor1.pin_n.v);
//   singlePhaseTransformerQS1.inductor1.i = singlePhaseTransformerQS1.inductor1.pin_p.i;
//   singlePhaseTransformerQS1.inductor2.v = Complex.'*'.multiply(Complex.'*'.multiply(Complex.'*'.multiply(Complex(0.0, 1.0), Complex.'constructor'.fromReal(singlePhaseTransformerQS1.inductor2.omega, 0.0)), Complex.'constructor'.fromReal(singlePhaseTransformerQS1.inductor2.L, 0.0)), singlePhaseTransformerQS1.inductor2.i);
//   Modelica.SIunits.ComplexCurrent.'+'(singlePhaseTransformerQS1.inductor2.pin_p.i, singlePhaseTransformerQS1.inductor2.pin_n.i) = Complex(0.0, 0.0);
//   singlePhaseTransformerQS1.inductor2.pin_p.reference.gamma = singlePhaseTransformerQS1.inductor2.pin_n.reference.gamma;
//   singlePhaseTransformerQS1.inductor2.omega = der(singlePhaseTransformerQS1.inductor2.pin_p.reference.gamma);
//   singlePhaseTransformerQS1.inductor2.v = Modelica.SIunits.ComplexVoltage.'-'.subtract(singlePhaseTransformerQS1.inductor2.pin_p.v, singlePhaseTransformerQS1.inductor2.pin_n.v);
//   singlePhaseTransformerQS1.inductor2.i = singlePhaseTransformerQS1.inductor2.pin_p.i;
//   assert(1.0 + singlePhaseTransformerQS1.resistor1.alpha_ref * (singlePhaseTransformerQS1.resistor1.T_heatPort - singlePhaseTransformerQS1.resistor1.T_ref) >= 1e-15, "Temperature outside scope of model!");
//   singlePhaseTransformerQS1.resistor1.R_actual = singlePhaseTransformerQS1.resistor1.R_ref * (1.0 + singlePhaseTransformerQS1.resistor1.alpha_ref * (singlePhaseTransformerQS1.resistor1.T_heatPort - singlePhaseTransformerQS1.resistor1.T_ref));
//   singlePhaseTransformerQS1.resistor1.v = Modelica.SIunits.ComplexCurrent.'*'.multiply(Complex.'constructor'.fromReal(singlePhaseTransformerQS1.resistor1.R_actual, 0.0), singlePhaseTransformerQS1.resistor1.i);
//   singlePhaseTransformerQS1.resistor1.LossPower = Modelica.ComplexMath.real(Modelica.SIunits.ComplexVoltage.'*'.multiply(singlePhaseTransformerQS1.resistor1.v, Modelica.ComplexMath.conj(singlePhaseTransformerQS1.resistor1.i)));
//   singlePhaseTransformerQS1.resistor1.T_heatPort = singlePhaseTransformerQS1.resistor1.T;
//   Modelica.SIunits.ComplexCurrent.'+'(singlePhaseTransformerQS1.resistor1.pin_p.i, singlePhaseTransformerQS1.resistor1.pin_n.i) = Complex(0.0, 0.0);
//   singlePhaseTransformerQS1.resistor1.pin_p.reference.gamma = singlePhaseTransformerQS1.resistor1.pin_n.reference.gamma;
//   singlePhaseTransformerQS1.resistor1.omega = der(singlePhaseTransformerQS1.resistor1.pin_p.reference.gamma);
//   singlePhaseTransformerQS1.resistor1.v = Modelica.SIunits.ComplexVoltage.'-'.subtract(singlePhaseTransformerQS1.resistor1.pin_p.v, singlePhaseTransformerQS1.resistor1.pin_n.v);
//   singlePhaseTransformerQS1.resistor1.i = singlePhaseTransformerQS1.resistor1.pin_p.i;
//   assert(1.0 + singlePhaseTransformerQS1.resistor2.alpha_ref * (singlePhaseTransformerQS1.resistor2.T_heatPort - singlePhaseTransformerQS1.resistor2.T_ref) >= 1e-15, "Temperature outside scope of model!");
//   singlePhaseTransformerQS1.resistor2.R_actual = singlePhaseTransformerQS1.resistor2.R_ref * (1.0 + singlePhaseTransformerQS1.resistor2.alpha_ref * (singlePhaseTransformerQS1.resistor2.T_heatPort - singlePhaseTransformerQS1.resistor2.T_ref));
//   singlePhaseTransformerQS1.resistor2.v = Modelica.SIunits.ComplexCurrent.'*'.multiply(Complex.'constructor'.fromReal(singlePhaseTransformerQS1.resistor2.R_actual, 0.0), singlePhaseTransformerQS1.resistor2.i);
//   singlePhaseTransformerQS1.resistor2.LossPower = Modelica.ComplexMath.real(Modelica.SIunits.ComplexVoltage.'*'.multiply(singlePhaseTransformerQS1.resistor2.v, Modelica.ComplexMath.conj(singlePhaseTransformerQS1.resistor2.i)));
//   singlePhaseTransformerQS1.resistor2.T_heatPort = singlePhaseTransformerQS1.resistor2.T;
//   Modelica.SIunits.ComplexCurrent.'+'(singlePhaseTransformerQS1.resistor2.pin_p.i, singlePhaseTransformerQS1.resistor2.pin_n.i) = Complex(0.0, 0.0);
//   singlePhaseTransformerQS1.resistor2.pin_p.reference.gamma = singlePhaseTransformerQS1.resistor2.pin_n.reference.gamma;
//   singlePhaseTransformerQS1.resistor2.omega = der(singlePhaseTransformerQS1.resistor2.pin_p.reference.gamma);
//   singlePhaseTransformerQS1.resistor2.v = Modelica.SIunits.ComplexVoltage.'-'.subtract(singlePhaseTransformerQS1.resistor2.pin_p.v, singlePhaseTransformerQS1.resistor2.pin_n.v);
//   singlePhaseTransformerQS1.resistor2.i = singlePhaseTransformerQS1.resistor2.pin_p.i;
//   singlePhaseTransformerQS1.inductorh.v = Complex.'*'.multiply(Complex.'*'.multiply(Complex.'*'.multiply(Complex(0.0, 1.0), Complex.'constructor'.fromReal(singlePhaseTransformerQS1.inductorh.omega, 0.0)), Complex(1.79, 0.0)), singlePhaseTransformerQS1.inductorh.i);
//   Modelica.SIunits.ComplexCurrent.'+'(singlePhaseTransformerQS1.inductorh.pin_p.i, singlePhaseTransformerQS1.inductorh.pin_n.i) = Complex(0.0, 0.0);
//   singlePhaseTransformerQS1.inductorh.pin_p.reference.gamma = singlePhaseTransformerQS1.inductorh.pin_n.reference.gamma;
//   singlePhaseTransformerQS1.inductorh.omega = der(singlePhaseTransformerQS1.inductorh.pin_p.reference.gamma);
//   singlePhaseTransformerQS1.inductorh.v = Modelica.SIunits.ComplexVoltage.'-'.subtract(singlePhaseTransformerQS1.inductorh.pin_p.v, singlePhaseTransformerQS1.inductorh.pin_n.v);
//   singlePhaseTransformerQS1.inductorh.i = singlePhaseTransformerQS1.inductorh.pin_p.i;
//   singlePhaseTransformerQS1.idealTransformer.v1 = Modelica.SIunits.ComplexVoltage.'-'.subtract(singlePhaseTransformerQS1.idealTransformer.pin_p1.v, singlePhaseTransformerQS1.idealTransformer.pin_n1.v);
//   singlePhaseTransformerQS1.idealTransformer.v2 = Modelica.SIunits.ComplexVoltage.'-'.subtract(singlePhaseTransformerQS1.idealTransformer.pin_p2.v, singlePhaseTransformerQS1.idealTransformer.pin_n2.v);
//   Modelica.SIunits.ComplexCurrent.'+'(singlePhaseTransformerQS1.idealTransformer.pin_p1.i, singlePhaseTransformerQS1.idealTransformer.pin_n1.i) = Complex(0.0, 0.0);
//   Modelica.SIunits.ComplexCurrent.'+'(singlePhaseTransformerQS1.idealTransformer.pin_p2.i, singlePhaseTransformerQS1.idealTransformer.pin_n2.i) = Complex(0.0, 0.0);
//   singlePhaseTransformerQS1.idealTransformer.v1 = Complex.'*'.multiply(Complex.'constructor'.fromReal(singlePhaseTransformerQS1.idealTransformer.n, 0.0), singlePhaseTransformerQS1.idealTransformer.v2);
//   singlePhaseTransformerQS1.idealTransformer.i2 = Complex.'*'.multiply(Complex.'constructor'.fromReal(-singlePhaseTransformerQS1.idealTransformer.n, 0.0), singlePhaseTransformerQS1.idealTransformer.i1);
//   singlePhaseTransformerQS1.idealTransformer.pin_p1.reference.gamma = singlePhaseTransformerQS1.idealTransformer.pin_n1.reference.gamma;
//   singlePhaseTransformerQS1.idealTransformer.pin_p2.reference.gamma = singlePhaseTransformerQS1.idealTransformer.pin_n2.reference.gamma;
//   singlePhaseTransformerQS1.idealTransformer.pin_p1.reference.gamma = singlePhaseTransformerQS1.idealTransformer.pin_p2.reference.gamma;
//   assert(1.0 + singlePhaseTransformerQS1.conductor.alpha_ref * (singlePhaseTransformerQS1.conductor.T_heatPort - singlePhaseTransformerQS1.conductor.T_ref) >= 1e-15, "Temperature outside scope of model!");
//   singlePhaseTransformerQS1.conductor.G_actual = 5.149330587023687e-4 / (1.0 + singlePhaseTransformerQS1.conductor.alpha_ref * (singlePhaseTransformerQS1.conductor.T_heatPort - singlePhaseTransformerQS1.conductor.T_ref));
//   singlePhaseTransformerQS1.conductor.i = Modelica.SIunits.ComplexVoltage.'*'.multiply(Complex.'constructor'.fromReal(singlePhaseTransformerQS1.conductor.G_actual, 0.0), singlePhaseTransformerQS1.conductor.v);
//   singlePhaseTransformerQS1.conductor.LossPower = Modelica.ComplexMath.real(Modelica.SIunits.ComplexVoltage.'*'.multiply(singlePhaseTransformerQS1.conductor.v, Modelica.ComplexMath.conj(singlePhaseTransformerQS1.conductor.i)));
//   singlePhaseTransformerQS1.conductor.T_heatPort = singlePhaseTransformerQS1.conductor.T;
//   Modelica.SIunits.ComplexCurrent.'+'(singlePhaseTransformerQS1.conductor.pin_p.i, singlePhaseTransformerQS1.conductor.pin_n.i) = Complex(0.0, 0.0);
//   singlePhaseTransformerQS1.conductor.pin_p.reference.gamma = singlePhaseTransformerQS1.conductor.pin_n.reference.gamma;
//   singlePhaseTransformerQS1.conductor.omega = der(singlePhaseTransformerQS1.conductor.pin_p.reference.gamma);
//   singlePhaseTransformerQS1.conductor.v = Modelica.SIunits.ComplexVoltage.'-'.subtract(singlePhaseTransformerQS1.conductor.pin_p.v, singlePhaseTransformerQS1.conductor.pin_n.v);
//   singlePhaseTransformerQS1.conductor.i = singlePhaseTransformerQS1.conductor.pin_p.i;
//   ground1.pin.v = Complex(0.0, 0.0);
//   currentSensor2.v = Complex(0.0, 0.0);
//   currentSensor2.y = currentSensor2.i;
//   Modelica.SIunits.ComplexCurrent.'+'(currentSensor2.pin_p.i, currentSensor2.pin_n.i) = Complex(0.0, 0.0);
//   currentSensor2.pin_p.reference.gamma = currentSensor2.pin_n.reference.gamma;
//   currentSensor2.omega = der(currentSensor2.pin_p.reference.gamma);
//   currentSensor2.v = Modelica.SIunits.ComplexVoltage.'-'.subtract(currentSensor2.pin_p.v, currentSensor2.pin_n.v);
//   currentSensor2.i = currentSensor2.pin_p.i;
//   voltageSource1.omega = 6.283185307179586 * voltageSource1.f;
//   voltageSource1.v = Complex.'constructor'.fromReal(voltageSource1.V * cos(voltageSource1.phi), voltageSource1.V * sin(voltageSource1.phi));
//   Modelica.SIunits.ComplexCurrent.'+'(voltageSource1.pin_p.i, voltageSource1.pin_n.i) = Complex(0.0, 0.0);
//   voltageSource1.pin_p.reference.gamma = voltageSource1.pin_n.reference.gamma;
//   voltageSource1.omega = der(voltageSource1.pin_p.reference.gamma);
//   voltageSource1.v = Modelica.SIunits.ComplexVoltage.'-'.subtract(voltageSource1.pin_p.v, voltageSource1.pin_n.v);
//   voltageSource1.i = voltageSource1.pin_p.i;
//   powerSensor1.currentP.reference.gamma = powerSensor1.currentN.reference.gamma;
//   powerSensor1.voltageP.reference.gamma = powerSensor1.voltageN.reference.gamma;
//   powerSensor1.currentP.reference.gamma = powerSensor1.voltageP.reference.gamma;
//   Modelica.SIunits.ComplexCurrent.'+'(powerSensor1.currentP.i, powerSensor1.currentN.i) = Complex(0.0, 0.0);
//   Modelica.SIunits.ComplexVoltage.'-'.subtract(powerSensor1.currentP.v, powerSensor1.currentN.v) = Complex(0.0, 0.0);
//   powerSensor1.i = powerSensor1.currentP.i;
//   Modelica.SIunits.ComplexCurrent.'+'(powerSensor1.voltageP.i, powerSensor1.voltageN.i) = Complex(0.0, 0.0);
//   powerSensor1.voltageP.i = Complex(0.0, 0.0);
//   powerSensor1.v = Modelica.SIunits.ComplexVoltage.'-'.subtract(powerSensor1.voltageP.v, powerSensor1.voltageN.v);
//   powerSensor1.y = Modelica.SIunits.ComplexVoltage.'*'.multiply(powerSensor1.v, Modelica.ComplexMath.conj(powerSensor1.i));
// end SC2_total;
// endResult
