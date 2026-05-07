// name:     AttributesPropagation.mo
// keywords: tests if attributes are properly propagated from original to redeclared component
// status:   correct
//

package Buildings
  extends Modelica.Icons.Package;

  package Fluid
    extends Modelica.Icons.Package;

    package FixedResistances
      extends Modelica.Icons.VariantsPackage;

      model FixedResistanceDpM
        extends Buildings.Fluid.BaseClasses.PartialResistance(final m_flow_turbulent = if computeFlowResistance and use_dh then eta_default * dh / 4 * Modelica.Constants.pi * ReC elseif computeFlowResistance then deltaM * m_flow_nominal_pos else 0);
        parameter Boolean use_dh = false;
        parameter Modelica.SIunits.Length dh = 1;
        parameter Real ReC(min = 0) = 4000;
        parameter Real deltaM(min = 0.01) = 0.3;
        final parameter Real k(unit = "") = if computeFlowResistance then m_flow_nominal_pos / sqrt(dp_nominal_pos) else 0;
      protected
        final parameter Boolean computeFlowResistance = dp_nominal_pos > Modelica.Constants.eps annotation(Evaluate = true);
      initial equation
        if computeFlowResistance then
          assert(m_flow_turbulent > 0, "m_flow_turbulent must be bigger than zero.");
        end if;
        assert(m_flow_nominal_pos > 0, "m_flow_nominal_pos must be non-zero. Check parameters.");
        if m_flow_turbulent > m_flow_nominal_pos then
          Modelica.Utilities.Streams.print("Warning: In FixedResistanceDpM, m_flow_nominal is smaller than m_flow_turbulent." + "\n" + "  m_flow_nominal = " + String(m_flow_nominal) + "\n" + "  dh      = " + String(dh) + "\n" + "  To fix, set dh < " + String(4 * m_flow_nominal / eta_default / Modelica.Constants.pi / ReC) + "\n" + "  Suggested value: dh = " + String(1 / 10 * 4 * m_flow_nominal / eta_default / Modelica.Constants.pi / ReC));
        end if;
      equation
        if computeFlowResistance then
          if linearized then
            m_flow * m_flow_nominal_pos = k ^ 2 * dp;
          else
            if homotopyInitialization then
              if from_dp then
                m_flow = homotopy(actual = Buildings.Fluid.BaseClasses.FlowModels.basicFlowFunction_dp(dp = dp, k = k, m_flow_turbulent = m_flow_turbulent), simplified = m_flow_nominal_pos * dp / dp_nominal_pos);
              else
                dp = homotopy(actual = Buildings.Fluid.BaseClasses.FlowModels.basicFlowFunction_m_flow(m_flow = m_flow, k = k, m_flow_turbulent = m_flow_turbulent), simplified = dp_nominal_pos * m_flow / m_flow_nominal_pos);
              end if;
            else
              if from_dp then
                m_flow = Buildings.Fluid.BaseClasses.FlowModels.basicFlowFunction_dp(dp = dp, k = k, m_flow_turbulent = m_flow_turbulent);
              else
                dp = Buildings.Fluid.BaseClasses.FlowModels.basicFlowFunction_m_flow(m_flow = m_flow, k = k, m_flow_turbulent = m_flow_turbulent);
              end if;
            end if;
          end if;
        else
          dp = 0;
        end if;
      end FixedResistanceDpM;
    end FixedResistances;

    package HeatExchangers
      extends Modelica.Icons.VariantsPackage;

      package Boreholes
        extends Modelica.Icons.VariantsPackage;

        package BaseClasses
          extends Modelica.Icons.BasesPackage;

          model BoreholeSegment
            extends Buildings.Fluid.Interfaces.PartialFourPortInterface(redeclare final package Medium1 = Medium, redeclare final package Medium2 = Medium, final m1_flow_nominal = m_flow_nominal, final m2_flow_nominal = m_flow_nominal, final m1_flow_small = m_flow_small, final m2_flow_small = m_flow_small, final allowFlowReversal1 = allowFlowReversal, final allowFlowReversal2 = allowFlowReversal);
            extends Buildings.Fluid.Interfaces.TwoPortFlowResistanceParameters;
            extends Buildings.Fluid.Interfaces.LumpedVolumeDeclarations(T_start = TFil_start);
            replaceable package Medium = Modelica.Media.Interfaces.PartialMedium;
            replaceable parameter Buildings.HeatTransfer.Data.Soil.Generic matSoi annotation(choicesAllMatching = true);
            replaceable parameter Buildings.HeatTransfer.Data.BoreholeFillings.Generic matFil annotation(choicesAllMatching = true);
            parameter Modelica.SIunits.MassFlowRate m_flow_nominal;
            parameter Modelica.SIunits.MassFlowRate m_flow_small(min = 0) = 1E-4 * abs(m_flow_nominal);
            parameter Boolean homotopyInitialization = true annotation(Evaluate = true);
            parameter Modelica.SIunits.Radius rTub = 0.02;
            parameter Modelica.SIunits.ThermalConductivity kTub = 0.5;
            parameter Modelica.SIunits.Length eTub = 0.002;
            parameter Modelica.SIunits.Temperature TFil_start = 283.15;
            parameter Modelica.SIunits.Radius rExt = 3;
            parameter Modelica.SIunits.Temperature TExt_start = 283.15;
            parameter Integer nSta(min = 1) = 10;
            parameter Modelica.SIunits.Time samplePeriod = 604800;
            parameter Modelica.SIunits.Radius rBor = 0.1;
            parameter Modelica.SIunits.Height hSeg;
            parameter Modelica.SIunits.Length xC = 0.05;
            parameter Boolean allowFlowReversal = true annotation(Evaluate = true);
            Buildings.Fluid.HeatExchangers.Boreholes.BaseClasses.HexInternalElement pipFil(redeclare final package Medium = Medium, final matFil = matFil, final matSoi = matSoi, final hSeg = hSeg, final rTub = rTub, final eTub = eTub, final kTub = kTub, final kSoi = matSoi.k, final xC = xC, final rBor = rBor, final TFil_start = TFil_start, final m1_flow_nominal = m_flow_nominal, final m2_flow_nominal = m_flow_nominal, final dp1_nominal = dp_nominal, final dp2_nominal = 0, final from_dp1 = from_dp, final from_dp2 = from_dp, final linearizeFlowResistance1 = linearizeFlowResistance, final linearizeFlowResistance2 = linearizeFlowResistance, final deltaM1 = deltaM, final deltaM2 = deltaM, final m1_flow_small = m_flow_small, final m2_flow_small = m_flow_small, final allowFlowReversal1 = allowFlowReversal, final allowFlowReversal2 = allowFlowReversal, final homotopyInitialization = homotopyInitialization, final energyDynamics = energyDynamics, final massDynamics = massDynamics, final p1_start = p_start, T1_start = T_start, X1_start = X_start, C1_start = C_start, C1_nominal = C_nominal, final p2_start = p_start, T2_start = T_start, X2_start = X_start, C2_start = C_start, C2_nominal = C_nominal);
            Buildings.HeatTransfer.Conduction.SingleLayerCylinder soi(final material = matSoi, final h = hSeg, final nSta = nSta, final r_a = rBor, final r_b = rExt, final steadyStateInitial = false, final TInt_start = TFil_start, final TExt_start = TExt_start);
            Buildings.Fluid.HeatExchangers.Boreholes.BaseClasses.SingleUTubeBoundaryCondition TBouCon(final matSoi = matSoi, final rExt = rExt, final hSeg = hSeg, final TExt_start = TExt_start, final samplePeriod = samplePeriod);
          protected
            Modelica.Thermal.HeatTransfer.Sensors.HeatFlowSensor heaFlo;
          equation
            connect(pipFil.port_b1, port_b1);
            connect(pipFil.port_a2, port_a2);
            connect(pipFil.port_b2, port_b2);
            connect(pipFil.port, heaFlo.port_a);
            connect(heaFlo.port_b, soi.port_a);
            connect(soi.port_b, TBouCon.port);
            connect(port_a1, pipFil.port_a1);
            connect(heaFlo.Q_flow, TBouCon.Q_flow);
          end BoreholeSegment;

          model HexInternalElement
            extends Buildings.Fluid.Interfaces.FourPortHeatMassExchanger(redeclare final package Medium1 = Medium, redeclare final package Medium2 = Medium, T1_start = TFil_start, T2_start = TFil_start, final tau1 = Modelica.Constants.pi * rTub ^ 2 * hSeg * rho1_nominal / m1_flow_nominal, final tau2 = Modelica.Constants.pi * rTub ^ 2 * hSeg * rho2_nominal / m2_flow_nominal, vol1(final energyDynamics = energyDynamics, final massDynamics = massDynamics, final prescribedHeatFlowRate = false, final allowFlowReversal = allowFlowReversal1, final V = m2_flow_nominal * tau2 / rho2_nominal, final m_flow_small = m1_flow_small), final vol2(final energyDynamics = energyDynamics, final massDynamics = massDynamics, final prescribedHeatFlowRate = false, final V = m1_flow_nominal * tau1 / rho1_nominal, final m_flow_small = m2_flow_small));
            replaceable package Medium = Modelica.Media.Interfaces.PartialMedium;
            replaceable parameter Buildings.HeatTransfer.Data.BoreholeFillings.Generic matFil annotation(choicesAllMatching = true);
            replaceable parameter Buildings.HeatTransfer.Data.Soil.Generic matSoi annotation(choicesAllMatching = true);
            parameter Modelica.SIunits.Radius rTub = 0.02;
            parameter Modelica.SIunits.ThermalConductivity kTub = 0.5;
            parameter Modelica.SIunits.Length eTub = 0.002;
            parameter Modelica.SIunits.ThermalConductivity kSoi;
            parameter Modelica.SIunits.Temperature TFil_start = 283.15;
            parameter Modelica.SIunits.Height hSeg;
            parameter Modelica.SIunits.Radius rBor;
            parameter Modelica.SIunits.Length xC = 0.05;
            Modelica.Thermal.HeatTransfer.Interfaces.HeatPort_a port;
            Modelica.Thermal.HeatTransfer.Components.HeatCapacitor capFil1(final C = Co_fil / 2, T(final start = TFil_start, fixed = energyDynamics == Modelica.Fluid.Types.Dynamics.FixedInitial), der_T(fixed = energyDynamics == Modelica.Fluid.Types.Dynamics.SteadyStateInitial));
            Modelica.Thermal.HeatTransfer.Components.HeatCapacitor capFil2(final C = Co_fil / 2, T(final start = TFil_start, fixed = energyDynamics == Modelica.Fluid.Types.Dynamics.FixedInitial), der_T(fixed = energyDynamics == Modelica.Fluid.Types.Dynamics.SteadyStateInitial));
          protected
            final parameter Modelica.SIunits.SpecificHeatCapacity cpFil = matFil.c;
            final parameter Modelica.SIunits.ThermalConductivity kFil = matFil.k;
            final parameter Modelica.SIunits.Density dFil = matFil.d;
            parameter Modelica.SIunits.HeatCapacity Co_fil = dFil * cpFil * hSeg * Modelica.Constants.pi * (rBor ^ 2 - 2 * (rTub + eTub) ^ 2);
            parameter Modelica.SIunits.SpecificHeatCapacity cpMed = Medium.specificHeatCapacityCp(Medium.setState_pTX(Medium.p_default, Medium.T_default, Medium.X_default));
            parameter Modelica.SIunits.ThermalConductivity kMed = Medium.thermalConductivity(Medium.setState_pTX(Medium.p_default, Medium.T_default, Medium.X_default));
            parameter Modelica.SIunits.DynamicViscosity mueMed = Medium.dynamicViscosity(Medium.setState_pTX(Medium.p_default, Medium.T_default, Medium.X_default));
            parameter Modelica.SIunits.ThermalResistance Rgb_val(fixed = false);
            parameter Modelica.SIunits.ThermalResistance Rgg_val(fixed = false);
            parameter Modelica.SIunits.ThermalResistance RCondGro_val(fixed = false);
            parameter Real x(fixed = false);
            Modelica.Thermal.HeatTransfer.Components.ConvectiveResistor RConv1;
            Modelica.Thermal.HeatTransfer.Components.ConvectiveResistor RConv2;
            Modelica.Thermal.HeatTransfer.Components.ThermalResistor Rpg1(final R = RCondGro_val);
            Modelica.Thermal.HeatTransfer.Components.ThermalResistor Rpg2(final R = RCondGro_val);
            Modelica.Thermal.HeatTransfer.Components.ThermalResistor Rgb1(final R = Rgb_val);
            Modelica.Thermal.HeatTransfer.Components.ThermalResistor Rgb2(final R = Rgb_val);
            Modelica.Thermal.HeatTransfer.Components.ThermalResistor Rgg(final R = Rgg_val);
            Modelica.Blocks.Sources.RealExpression RVol1(y = convectionResistance(hSeg = hSeg, rTub = rTub, kMed = kMed, mueMed = mueMed, cpMed = cpMed, m_flow = m1_flow, m_flow_nominal = m1_flow_nominal));
            Modelica.Blocks.Sources.RealExpression RVol2(y = convectionResistance(hSeg = hSeg, rTub = rTub, kMed = kMed, mueMed = mueMed, cpMed = cpMed, m_flow = m2_flow, m_flow_nominal = m2_flow_nominal));
          initial equation
            (Rgb_val, Rgg_val, RCondGro_val, x) = singleUTubeResistances(hSeg = hSeg, rBor = rBor, rTub = rTub, eTub = eTub, xC = xC, kSoi = matSoi.k, kFil = matFil.k, kTub = kTub);
          equation
            connect(vol1.heatPort, RConv1.fluid);
            connect(RConv1.solid, Rpg1.port_a);
            connect(Rpg1.port_b, capFil1.port);
            connect(capFil1.port, Rgb1.port_a);
            connect(capFil1.port, Rgg.port_a);
            connect(Rgb1.port_b, port);
            connect(RConv2.solid, Rpg2.port_a);
            connect(Rpg2.port_b, capFil2.port);
            connect(RConv2.fluid, vol2.heatPort);
            connect(capFil2.port, Rgb2.port_a);
            connect(Rgg.port_b, capFil2.port);
            connect(Rgb2.port_b, port);
            connect(RVol1.y, RConv1.Rc);
            connect(RVol2.y, RConv2.Rc);
          end HexInternalElement;

          model SingleUTubeBoundaryCondition
            replaceable parameter Buildings.HeatTransfer.Data.Soil.Generic matSoi annotation(choicesAllMatching = true);
            parameter Modelica.SIunits.Radius rExt = 3;
            parameter Modelica.SIunits.Height hSeg = 10;
            parameter Modelica.SIunits.Temperature TExt_start = 283.15;
            parameter Modelica.SIunits.Time samplePeriod = 604800;
            ExtendableArray table = ExtendableArray();
            Modelica.SIunits.HeatFlowRate QAve_flow;
            Modelica.Blocks.Interfaces.RealInput Q_flow(unit = "W");
            Modelica.Thermal.HeatTransfer.Interfaces.HeatPort_b port;
          protected
            final parameter Modelica.SIunits.SpecificHeatCapacity c = matSoi.c;
            final parameter Modelica.SIunits.ThermalConductivity k = matSoi.k;
            final parameter Modelica.SIunits.Density d = matSoi.d;
            Modelica.SIunits.Energy UOld;
            Modelica.SIunits.Energy U;
            final parameter Modelica.SIunits.Time startTime(fixed = false);
            Integer iSam(min = 1);
          initial algorithm
            U := 0;
            UOld := 0;
            startTime := time;
            iSam := 1;
          equation
            der(U) = Q_flow;
          algorithm
            when initial() or sample(startTime, samplePeriod) then
              QAve_flow := (U - UOld) / samplePeriod;
              UOld := U;
              port.T := TExt_start + Buildings.Fluid.HeatExchangers.Boreholes.BaseClasses.temperatureDrop(table = table, iSam = iSam, Q_flow = QAve_flow, samplePeriod = samplePeriod, rExt = rExt, hSeg = hSeg, k = k, d = d, c = c);
              iSam := iSam + 1;
            end when;
          end SingleUTubeBoundaryCondition;

          class ExtendableArray
            extends ExternalObject;

            function constructor
              output ExtendableArray table;
              external "C" table = initArray() annotation(Include = "#include <initArray.c>", IncludeDirectory = "modelica://Buildings/Resources/C-Sources");
            end constructor;

            function destructor
              input ExtendableArray table;
              external "C" freeArray(table) annotation(Include = " #include <freeArray.c>", IncludeDirectory = "modelica://Buildings/Resources/C-Sources");
            end destructor;
          end ExtendableArray;

          function convectionResistance
            input Modelica.SIunits.Height hSeg;
            input Modelica.SIunits.Radius rTub;
            input Modelica.SIunits.ThermalConductivity kMed;
            input Modelica.SIunits.DynamicViscosity mueMed;
            input Modelica.SIunits.SpecificHeatCapacity cpMed;
            input Modelica.SIunits.MassFlowRate m_flow;
            input Modelica.SIunits.MassFlowRate m_flow_nominal;
            output Modelica.SIunits.ThermalResistance R;
          protected
            Modelica.SIunits.CoefficientOfHeatTransfer h;
            Real k(unit = "s/kg");
          algorithm
            k := 2 / (mueMed * Modelica.Constants.pi * rTub);
            h := 0.023 * kMed * (cpMed * mueMed / kMed) ^ 0.35 / (2 * rTub) * Buildings.Utilities.Math.Functions.regNonZeroPower(x = m_flow * k, n = 0.8, delta = 0.01 * m_flow_nominal * k);
            R := 1 / (2 * Modelica.Constants.pi * rTub * hSeg * h);
          end convectionResistance;

          function exchangeValues
            input ExtendableArray table;
            input Integer iX;
            input Real x;
            input Integer iY;
            output Real y;
            external "C" y = exchangeValues(table, iX, x, iY) annotation(Include = "#include <exchangeValues.c>", IncludeDirectory = "modelica://Buildings/Resources/C-Sources");
          end exchangeValues;

          function factorial
            input Integer j;
            output Integer f;
          algorithm
            f := 1;
            for i in 1:j loop
              f := f * i;
            end for;
          end factorial;

          function powerSeries
            input Real u;
            input Integer N;
            output Real W;
          algorithm
            W := (-0.5772) - Modelica.Math.log(u) + sum((-1) ^ (j + 1) * u ^ j / (j * factorial(j)) for j in 1:N);
          end powerSeries;

          function temperatureDrop
            input ExtendableArray table;
            input Integer iSam(min = 1);
            input Modelica.SIunits.HeatFlowRate Q_flow;
            input Modelica.SIunits.Time samplePeriod;
            input Modelica.SIunits.Radius rExt;
            input Modelica.SIunits.Height hSeg;
            input Modelica.SIunits.ThermalConductivity k;
            input Modelica.SIunits.Density d;
            input Modelica.SIunits.SpecificHeatCapacity c;
            output Modelica.SIunits.TemperatureDifference dT;
          protected
            Modelica.SIunits.Time minSamplePeriod = rExt ^ 2 / (4 * (k / c / d) * 3.8);
            Modelica.SIunits.HeatFlowRate QL_flow;
            Modelica.SIunits.HeatFlowRate QU_flow;
          algorithm
            assert(rExt * rExt / (4 * (k / c / d) * samplePeriod) <= 3.8, "The samplePeriod has to be bigger than " + String(minSamplePeriod) + " for convergence purpose.
              samplePeriod = " + String(samplePeriod));
            if iSam == 1 then
              dT := 0;
              QL_flow := Buildings.Fluid.HeatExchangers.Boreholes.BaseClasses.exchangeValues(table = table, iX = iSam, x = Q_flow, iY = iSam);
            else
              dT := 0;
              for i in 1:iSam - 1 loop
                QL_flow := Buildings.Fluid.HeatExchangers.Boreholes.BaseClasses.exchangeValues(table = table, iX = iSam, x = Q_flow, iY = iSam + 1 - i);
                QU_flow := Buildings.Fluid.HeatExchangers.Boreholes.BaseClasses.exchangeValues(table = table, iX = iSam, x = Q_flow, iY = iSam - i);
                dT := dT + 1 / (4 * Modelica.Constants.pi * k) * Buildings.Fluid.HeatExchangers.Boreholes.BaseClasses.powerSeries(u = c * d / (4 * k * i * samplePeriod) * rExt ^ 2, N = 10) * (QL_flow - QU_flow) / hSeg;
              end for;
            end if;
          end temperatureDrop;

          function singleUTubeResistances
            input Modelica.SIunits.Height hSeg;
            input Modelica.SIunits.Radius rBor;
            input Modelica.SIunits.Radius rTub;
            input Modelica.SIunits.Length eTub;
            input Modelica.SIunits.Length xC;
            input Modelica.SIunits.ThermalConductivity kSoi;
            input Modelica.SIunits.ThermalConductivity kFil;
            input Modelica.SIunits.ThermalConductivity kTub;
            output Modelica.SIunits.ThermalResistance Rgb;
            output Modelica.SIunits.ThermalResistance Rgg;
            output Modelica.SIunits.ThermalResistance RCondGro;
            output Real x;
          protected
            Boolean test = false;
            Modelica.SIunits.ThermalResistance Rg;
            Modelica.SIunits.ThermalResistance Rar;
            Modelica.SIunits.ThermalResistance RCondPipe;
            Real Rb;
            Real Ra;
            Real sigma;
            Real beta;
            Real R_1delta_LS;
            Real R_1delta_MP;
            Real Ra_LS;
            Integer i = 1;
          algorithm
            RCondPipe := Modelica.Math.log((rTub + eTub) / rTub) / (2 * Modelica.Constants.pi * hSeg * kTub);
            sigma := (kFil - kSoi) / (kFil + kSoi);
            R_1delta_LS := 1 / (2 * Modelica.Constants.pi * kFil) * (log(rBor / (rTub + eTub)) + log(rBor / (2 * xC)) + sigma * log(rBor ^ 4 / (rBor ^ 4 - xC ^ 4)));
            R_1delta_MP := R_1delta_LS - 1 / (2 * Modelica.Constants.pi * kFil) * ((rTub + eTub) ^ 2 / (4 * xC ^ 2) * (1 - sigma * 4 * xC ^ 4 / (rBor ^ 4 - xC ^ 4)) ^ 2) / ((1 + beta) / (1 - beta) + (rTub + eTub) ^ 2 / (4 * xC ^ 2) * (1 + sigma * 16 * xC ^ 4 * rBor ^ 4 / (rBor ^ 4 - xC ^ 4) ^ 2));
            Ra_LS := 1 / (Modelica.Constants.pi * kFil) * (log(2 * xC / rTub) + sigma * log((rBor ^ 2 + xC ^ 2) / (rBor ^ 2 - xC ^ 2)));
            beta := 2 * Modelica.Constants.pi * kFil * RCondPipe;
            Rb := R_1delta_MP / 2;
            Ra := Ra_LS - 1 / (Modelica.Constants.pi * kFil) * (rTub ^ 2 / (4 * xC ^ 2) * (1 + sigma * 4 * rBor ^ 4 * xC ^ 2 / (rBor ^ 4 - xC ^ 4)) / ((1 + beta) / (1 - beta) - rTub ^ 2 / (4 * xC ^ 2) + sigma * 2 * rTub ^ 2 * rBor ^ 2 * (rBor ^ 4 + xC ^ 4) / (rBor ^ 4 - xC ^ 4) ^ 2));
            Rg := 2 * Rb / hSeg;
            Rar := Ra / hSeg;
            while test == false and i <= 15 loop
              x := Modelica.Math.log(sqrt(rBor ^ 2 + 2 * (rTub + eTub) ^ 2) / (2 * (rTub + eTub))) / Modelica.Math.log(rBor / (sqrt(2) * (rTub + eTub))) * ((15 - i + 1) / 15);
              Rgb := (1 - x) * Rg;
              Rgg := 2 * Rgb * (Rar - 2 * x * Rg) / (2 * Rgb - Rar + 2 * x * Rg);
              test := 1 / Rgg + 1 / 2 / Rgb > 0;
              i := i + 1;
            end while;
            assert(test, "Maximum number of iterations exceeded. Check the borehole geometry.
              The tubes may be too close to the borehole wall.
              Input to the function
              Buildings.Fluid.HeatExchangers.Boreholes.BaseClasses.singleUTubeResistances
              is
                       hSeg = " + String(hSeg) + " m
                       rBor = " + String(rBor) + " m
                       rTub = " + String(rTub) + " m
                       eTub = " + String(eTub) + " m
                       xC   = " + String(xC) + " m
                       kSoi = " + String(kSoi) + " W/m/K
                       kFil = " + String(kFil) + " W/m/K
                       kTub = " + String(kTub) + " W/m/K
              Computed x    = " + String(x) + " K/W
                       Rgb  = " + String(Rgb) + " K/W
                       Rgg  = " + String(Rgg) + " K/W");
            RCondGro := x * Rg + RCondPipe;
          end singleUTubeResistances;

          package Examples
            extends Modelica.Icons.ExamplesPackage;

            model BoreholeSegment
              extends Modelica.Icons.Example;
              inner Modelica.Fluid.System system;
              package Medium = Buildings.Media.ConstantPropertyLiquidWater;
              parameter Buildings.HeatTransfer.Data.BoreholeFillings.Bentonite bento;
              Buildings.Fluid.HeatExchangers.Boreholes.BaseClasses.BoreholeSegment seg(redeclare package Medium = Medium, matFil = bento, m_flow_nominal = 0.2, dp_nominal = 5, rTub = 0.02, eTub = 0.002, rBor = 0.1, rExt = 3, nSta = 9, samplePeriod = 604800, kTub = 0.5, hSeg = 10, xC = 0.05, redeclare Buildings.HeatTransfer.Data.Soil.Concrete matSoi, energyDynamics = Modelica.Fluid.Types.Dynamics.SteadyStateInitial, TFil_start = 283.15, TExt_start = 283.15);
              Fluid.Sources.Boundary_pT sou_1(redeclare package Medium = Medium, nPorts = 1, use_T_in = false, p = 101340, T = 303.15);
              Fluid.Sources.Boundary_pT sin_2(redeclare package Medium = Medium, use_p_in = false, use_T_in = false, nPorts = 1, p = 101330, T = 283.15);
            equation
              connect(sou_1.ports[1], seg.port_a1);
              connect(seg.port_b1, seg.port_a2);
              connect(seg.port_b2, sin_2.ports[1]);
            end BoreholeSegment;
          end Examples;
        end BaseClasses;
      end Boreholes;
    end HeatExchangers;

    package MixingVolumes
      extends Modelica.Icons.VariantsPackage;

      model MixingVolume
        extends Buildings.Fluid.MixingVolumes.BaseClasses.PartialMixingVolume;
      protected
        Modelica.Blocks.Sources.Constant masExc(k = 0);
      equation
        connect(masExc.y, dynBal.mWat_flow);
        connect(masExc.y, steBal.mWat_flow);
        connect(QSen_flow.y, steBal.Q_flow);
        connect(QSen_flow.y, dynBal.Q_flow);
      end MixingVolume;

      package BaseClasses
        extends Modelica.Icons.BasesPackage;

        partial model PartialMixingVolume
          outer Modelica.Fluid.System system;
          extends Buildings.Fluid.Interfaces.LumpedVolumeDeclarations;
          parameter Modelica.SIunits.MassFlowRate m_flow_nominal(min = 0);
          parameter Integer nPorts = 0 annotation(Evaluate = true);
          parameter Modelica.SIunits.MassFlowRate m_flow_small(min = 0) = 1E-4 * abs(m_flow_nominal);
          parameter Boolean allowFlowReversal = system.allowFlowReversal annotation(Evaluate = true);
          parameter Modelica.SIunits.Volume V;
          parameter Boolean prescribedHeatFlowRate = false annotation(Evaluate = true);
          parameter Boolean initialize_p = not Medium.singleState;
          Modelica.Fluid.Vessels.BaseClasses.VesselFluidPorts_b[nPorts] ports(redeclare each package Medium = Medium);
          Modelica.Thermal.HeatTransfer.Interfaces.HeatPort_a heatPort;
          Modelica.SIunits.Temperature T;
          Modelica.SIunits.Pressure p;
          Modelica.SIunits.MassFraction[Medium.nXi] Xi;
          Medium.ExtraProperty[Medium.nC] C(nominal = C_nominal);
        protected
          Buildings.Fluid.Interfaces.StaticTwoPortConservationEquation steBal(sensibleOnly = true, redeclare final package Medium = Medium, final m_flow_nominal = m_flow_nominal, final allowFlowReversal = allowFlowReversal, final m_flow_small = m_flow_small) if useSteadyStateTwoPort;
          Buildings.Fluid.Interfaces.ConservationEquation dynBal(redeclare final package Medium = Medium, final energyDynamics = energyDynamics, final massDynamics = massDynamics, final p_start = p_start, final T_start = T_start, final X_start = X_start, final C_start = C_start, final C_nominal = C_nominal, final fluidVolume = V, final initialize_p = initialize_p, m(start = V * rho_start), U(start = V * rho_start * Medium.specificInternalEnergy(state_start)), nPorts = nPorts) if not useSteadyStateTwoPort;
          parameter Modelica.SIunits.Density rho_default = Medium.density(state = state_default);
          parameter Modelica.SIunits.Density rho_start = Medium.density(state = state_start);
          final parameter Medium.ThermodynamicState state_default = Medium.setState_pTX(T = Medium.T_default, p = Medium.p_default, X = Medium.X_default[1:Medium.nXi]);
          final parameter Medium.ThermodynamicState state_start = Medium.setState_pTX(T = T_start, p = p_start, X = X_start[1:Medium.nXi]);
          final parameter Boolean useSteadyStateTwoPort = nPorts == 2 and prescribedHeatFlowRate and energyDynamics == Modelica.Fluid.Types.Dynamics.SteadyState and massDynamics == Modelica.Fluid.Types.Dynamics.SteadyState and substanceDynamics == Modelica.Fluid.Types.Dynamics.SteadyState and traceDynamics == Modelica.Fluid.Types.Dynamics.SteadyState annotation(Evaluate = true);
          Modelica.Blocks.Interfaces.RealOutput hOut_internal(unit = "J/kg");
          Modelica.Blocks.Interfaces.RealOutput[Medium.nXi] XiOut_internal(each unit = "1");
          Modelica.Blocks.Interfaces.RealOutput[Medium.nC] COut_internal(each unit = "1");
          Modelica.Blocks.Sources.RealExpression QSen_flow(y = heatPort.Q_flow);
        equation
          if not allowFlowReversal then
            assert(ports[1].m_flow > (-m_flow_small), "Model has flow reversal, but the parameter allowFlowReversal is set to false.
              m_flow_small    = " + String(m_flow_small) + "
              ports[1].m_flow = " + String(ports[1].m_flow) + "
            ");
          end if;
          if useSteadyStateTwoPort then
            connect(steBal.port_a, ports[1]);
            connect(steBal.port_b, ports[2]);
            connect(hOut_internal, steBal.hOut);
            connect(XiOut_internal, steBal.XiOut);
            connect(COut_internal, steBal.COut);
          else
            connect(dynBal.ports, ports);
            connect(hOut_internal, dynBal.hOut);
            connect(XiOut_internal, dynBal.XiOut);
            connect(COut_internal, dynBal.COut);
          end if;
          p = if nPorts > 0 then ports[1].p else p_start;
          T = Medium.temperature_phX(p = p, h = hOut_internal, X = cat(1, Xi, {1 - sum(Xi)}));
          Xi = XiOut_internal;
          C = COut_internal;
          heatPort.T = T;
        end PartialMixingVolume;
      end BaseClasses;
    end MixingVolumes;

    package Sources
      extends Modelica.Icons.SourcesPackage;

      model Boundary_pT
        extends Modelica.Fluid.Sources.BaseClasses.PartialSource;
        parameter Boolean use_p_in = false annotation(Evaluate = true, HideResult = true);
        parameter Boolean use_T_in = false annotation(Evaluate = true, HideResult = true);
        parameter Boolean use_X_in = false annotation(Evaluate = true, HideResult = true);
        parameter Boolean use_C_in = false annotation(Evaluate = true, HideResult = true);
        parameter Medium.AbsolutePressure p = Medium.p_default;
        parameter Medium.Temperature T = Medium.T_default;
        parameter Medium.MassFraction[Medium.nX] X = Medium.X_default;
        parameter Medium.ExtraProperty[Medium.nC] C(quantity = Medium.extraPropertiesNames) = fill(0, Medium.nC);
        Modelica.Blocks.Interfaces.RealInput p_in if use_p_in;
        Modelica.Blocks.Interfaces.RealInput T_in if use_T_in;
        Modelica.Blocks.Interfaces.RealInput[Medium.nX] X_in if use_X_in;
        Modelica.Blocks.Interfaces.RealInput[Medium.nC] C_in if use_C_in;
      protected
        Modelica.Blocks.Interfaces.RealInput p_in_internal;
        Modelica.Blocks.Interfaces.RealInput T_in_internal;
        Modelica.Blocks.Interfaces.RealInput[Medium.nX] X_in_internal;
        Modelica.Blocks.Interfaces.RealInput[Medium.nC] C_in_internal;
      equation
        Modelica.Fluid.Utilities.checkBoundary(Medium.mediumName, Medium.substanceNames, Medium.singleState, true, X_in_internal, "Boundary_pT");
        connect(p_in, p_in_internal);
        connect(T_in, T_in_internal);
        connect(X_in, X_in_internal);
        connect(C_in, C_in_internal);
        if not use_p_in then
          p_in_internal = p;
        end if;
        if not use_T_in then
          T_in_internal = T;
        end if;
        if not use_X_in then
          X_in_internal = X;
        end if;
        if not use_C_in then
          C_in_internal = C;
        end if;
        medium.p = p_in_internal;
        medium.T = T_in_internal;
        medium.Xi = X_in_internal[1:Medium.nXi];
        ports.C_outflow = fill(C_in_internal, nPorts);
      end Boundary_pT;
    end Sources;

    package BaseClasses
      extends Modelica.Icons.BasesPackage;

      package FlowModels
        extends Modelica.Icons.BasesPackage;

        function basicFlowFunction_dp
          input Modelica.SIunits.Pressure dp(displayUnit = "Pa");
          input Real k(min = 0, unit = "");
          input Modelica.SIunits.MassFlowRate m_flow_turbulent(min = 0);
          output Modelica.SIunits.MassFlowRate m_flow;
        protected
          Modelica.SIunits.Pressure dp_turbulent(displayUnit = "Pa");
          Real kSqu(unit = "kg.m");
        algorithm
          kSqu := k * k;
          dp_turbulent := m_flow_turbulent ^ 2 / kSqu;
          m_flow := Modelica.Fluid.Utilities.regRoot2(x = dp, x_small = dp_turbulent, k1 = kSqu, k2 = kSqu);
        end basicFlowFunction_dp;

        function basicFlowFunction_m_flow
          input Modelica.SIunits.MassFlowRate m_flow;
          input Real k(unit = "");
          input Modelica.SIunits.MassFlowRate m_flow_turbulent(min = 0);
          output Modelica.SIunits.Pressure dp(displayUnit = "Pa");
        protected
          Real kSquInv(unit = "1/(kg.m)");
        algorithm
          kSquInv := 1 / k ^ 2;
          dp := Modelica.Fluid.Utilities.regSquare2(x = m_flow, x_small = m_flow_turbulent, k1 = kSquInv, k2 = kSquInv);
        end basicFlowFunction_m_flow;
      end FlowModels;

      partial model PartialResistance
        extends Buildings.Fluid.Interfaces.PartialTwoPortInterface(show_T = false, m_flow(start = 0, nominal = m_flow_nominal_pos), dp(start = 0, nominal = dp_nominal_pos), final m_flow_small = 1E-4 * abs(m_flow_nominal));
        parameter Boolean from_dp = false annotation(Evaluate = true);
        parameter Modelica.SIunits.Pressure dp_nominal(displayUnit = "Pa");
        parameter Boolean homotopyInitialization = true annotation(Evaluate = true);
        parameter Boolean linearized = false annotation(Evaluate = true);
        parameter Modelica.SIunits.MassFlowRate m_flow_turbulent(min = 0);
      protected
        parameter Medium.ThermodynamicState sta_default = Medium.setState_pTX(T = Medium.T_default, p = Medium.p_default, X = Medium.X_default);
        parameter Modelica.SIunits.DynamicViscosity eta_default = Medium.dynamicViscosity(sta_default);
        final parameter Modelica.SIunits.MassFlowRate m_flow_nominal_pos = abs(m_flow_nominal);
        final parameter Modelica.SIunits.Pressure dp_nominal_pos = abs(dp_nominal);
      equation
        port_a.h_outflow = inStream(port_b.h_outflow);
        port_b.h_outflow = inStream(port_a.h_outflow);
        port_a.m_flow + port_b.m_flow = 0;
        port_a.Xi_outflow = inStream(port_b.Xi_outflow);
        port_b.Xi_outflow = inStream(port_a.Xi_outflow);
        port_a.C_outflow = inStream(port_b.C_outflow);
        port_b.C_outflow = inStream(port_a.C_outflow);
      end PartialResistance;
    end BaseClasses;

    package Interfaces
      extends Modelica.Icons.InterfacesPackage;

      model ConservationEquation
        extends Buildings.Fluid.Interfaces.LumpedVolumeDeclarations;
        parameter Integer nPorts = 0 annotation(Evaluate = true);
        parameter Boolean initialize_p = not Medium.singleState;
        Modelica.Fluid.Vessels.BaseClasses.VesselFluidPorts_b[nPorts] ports(redeclare each package Medium = Medium);
        Medium.BaseProperties medium(preferredMediumStates = not energyDynamics == Modelica.Fluid.Types.Dynamics.SteadyState, p(start = p_start, nominal = Medium.p_default, stateSelect = if not massDynamics == Modelica.Fluid.Types.Dynamics.SteadyState then StateSelect.prefer else StateSelect.default), h(start = hStart), T(start = T_start, nominal = Medium.T_default, stateSelect = if not energyDynamics == Modelica.Fluid.Types.Dynamics.SteadyState then StateSelect.prefer else StateSelect.default), Xi(start = X_start[1:Medium.nXi], nominal = Medium.X_default[1:Medium.nXi], each stateSelect = if not substanceDynamics == Modelica.Fluid.Types.Dynamics.SteadyState then StateSelect.prefer else StateSelect.default), d(start = rho_nominal));
        Modelica.SIunits.Energy U;
        Modelica.SIunits.Mass m;
        Modelica.SIunits.Mass[Medium.nXi] mXi;
        Modelica.SIunits.Mass[Medium.nC] mC;
        Medium.ExtraProperty[Medium.nC] C(nominal = C_nominal);
        Modelica.SIunits.MassFlowRate mb_flow;
        Modelica.SIunits.MassFlowRate[Medium.nXi] mbXi_flow;
        Medium.ExtraPropertyFlowRate[Medium.nC] mbC_flow;
        Modelica.SIunits.EnthalpyFlowRate Hb_flow;
        input Modelica.SIunits.Volume fluidVolume;
        Modelica.Blocks.Interfaces.RealInput Q_flow(unit = "W");
        Modelica.Blocks.Interfaces.RealInput mWat_flow(unit = "kg/s");
        Modelica.Blocks.Interfaces.RealOutput hOut(unit = "J/kg", start = hStart);
        Modelica.Blocks.Interfaces.RealOutput[Medium.nXi] XiOut(each unit = "1", each min = 0, each max = 1);
        Modelica.Blocks.Interfaces.RealOutput[Medium.nC] COut(each min = 0);
      protected
        Medium.EnthalpyFlowRate[nPorts] ports_H_flow;
        Modelica.SIunits.MassFlowRate[nPorts, Medium.nXi] ports_mXi_flow;
        Medium.ExtraPropertyFlowRate[nPorts, Medium.nC] ports_mC_flow;
        parameter Modelica.SIunits.Density rho_nominal = Medium.density(Medium.setState_pTX(T = T_start, p = p_start, X = X_start[1:Medium.nXi]));
        final parameter Real[Medium.nXi] s = array(if Modelica.Utilities.Strings.isEqual(string1 = Medium.substanceNames[i], string2 = "Water", caseSensitive = false) then 1 else 0 for i in 1:Medium.nXi);
        parameter Modelica.SIunits.SpecificEnthalpy hStart = Medium.specificEnthalpy_pTX(p_start, T_start, X_start);
      initial equation
        assert(Medium.nXi == 0 or abs(sum(s) - 1) < 1e-5, "If Medium.nXi > 1, then substance 'water' must be present for one component.'" + Medium.mediumName + "'.\n" + "Check medium model.");
        if energyDynamics == Modelica.Fluid.Types.Dynamics.SteadyState then
          assert(massDynamics == energyDynamics, "
                   If 'massDynamics == Modelica.Fluid.Types.Dynamics.SteadyState', then it is
                   required that 'energyDynamics==Modelica.Fluid.Types.Dynamics.SteadyState'.
                   Otherwise, the system of equations may not be consistent.
                   You need to select other parameter values.");
        end if;
        if energyDynamics == Modelica.Fluid.Types.Dynamics.FixedInitial then
          medium.T = T_start;
        else
          if energyDynamics == Modelica.Fluid.Types.Dynamics.SteadyStateInitial then
            der(medium.T) = 0;
          end if;
        end if;
        if massDynamics == Modelica.Fluid.Types.Dynamics.FixedInitial then
          if initialize_p then
            medium.p = p_start;
          end if;
        else
          if massDynamics == Modelica.Fluid.Types.Dynamics.SteadyStateInitial then
            if initialize_p then
              der(medium.p) = 0;
            end if;
          end if;
        end if;
        if substanceDynamics == Modelica.Fluid.Types.Dynamics.FixedInitial then
          medium.Xi = X_start[1:Medium.nXi];
        else
          if substanceDynamics == Modelica.Fluid.Types.Dynamics.SteadyStateInitial then
            der(medium.Xi) = zeros(Medium.nXi);
          end if;
        end if;
        if traceDynamics == Modelica.Fluid.Types.Dynamics.FixedInitial then
          C = C_start[1:Medium.nC];
        else
          if traceDynamics == Modelica.Fluid.Types.Dynamics.SteadyStateInitial then
            der(C) = zeros(Medium.nC);
          end if;
        end if;
      equation
        m = fluidVolume * medium.d;
        mXi = m * medium.Xi;
        U = m * medium.u;
        mC = m * C;
        hOut = medium.h;
        XiOut = medium.Xi;
        COut = C;
        for i in 1:nPorts loop
          ports_H_flow[i] = ports[i].m_flow * actualStream(ports[i].h_outflow);
          ports_mXi_flow[i, :] = ports[i].m_flow * actualStream(ports[i].Xi_outflow);
          ports_mC_flow[i, :] = ports[i].m_flow * actualStream(ports[i].C_outflow);
        end for;
        for i in 1:Medium.nXi loop
          mbXi_flow[i] = sum(ports_mXi_flow[:, i]);
        end for;
        for i in 1:Medium.nC loop
          mbC_flow[i] = sum(ports_mC_flow[:, i]);
        end for;
        mb_flow = sum(ports.m_flow);
        Hb_flow = sum(ports_H_flow);
        if energyDynamics == Modelica.Fluid.Types.Dynamics.SteadyState then
          0 = Hb_flow + Q_flow;
        else
          der(U) = Hb_flow + Q_flow;
        end if;
        if massDynamics == Modelica.Fluid.Types.Dynamics.SteadyState then
          0 = mb_flow + mWat_flow;
        else
          der(m) = mb_flow + mWat_flow;
        end if;
        if substanceDynamics == Modelica.Fluid.Types.Dynamics.SteadyState then
          zeros(Medium.nXi) = mbXi_flow + mWat_flow * s;
        else
          der(mXi) = mbXi_flow + mWat_flow * s;
        end if;
        if traceDynamics == Modelica.Fluid.Types.Dynamics.SteadyState then
          zeros(Medium.nC) = mbC_flow;
        else
          der(mC) = mbC_flow;
        end if;
        for i in 1:nPorts loop
          ports[i].p = medium.p;
          ports[i].h_outflow = medium.h;
          ports[i].Xi_outflow = medium.Xi;
          ports[i].C_outflow = C;
        end for;
      end ConservationEquation;

      model FourPort
        outer Modelica.Fluid.System system;
        replaceable package Medium1 = Modelica.Media.Interfaces.PartialMedium;
        replaceable package Medium2 = Modelica.Media.Interfaces.PartialMedium;
        parameter Boolean allowFlowReversal1 = system.allowFlowReversal annotation(Evaluate = true);
        parameter Boolean allowFlowReversal2 = system.allowFlowReversal annotation(Evaluate = true);
        parameter Modelica.SIunits.SpecificEnthalpy h_outflow_a1_start = Medium1.h_default;
        parameter Modelica.SIunits.SpecificEnthalpy h_outflow_b1_start = Medium1.h_default;
        parameter Modelica.SIunits.SpecificEnthalpy h_outflow_a2_start = Medium2.h_default;
        parameter Modelica.SIunits.SpecificEnthalpy h_outflow_b2_start = Medium2.h_default;
        Modelica.Fluid.Interfaces.FluidPort_a port_a1(redeclare package Medium = Medium1, m_flow(min = if allowFlowReversal1 then -Modelica.Constants.inf else 0), h_outflow(nominal = 1E5, start = h_outflow_a1_start), Xi_outflow(each nominal = 0.01));
        Modelica.Fluid.Interfaces.FluidPort_b port_b1(redeclare package Medium = Medium1, m_flow(max = if allowFlowReversal1 then +Modelica.Constants.inf else 0), h_outflow(nominal = 1E5, start = h_outflow_b1_start), Xi_outflow(each nominal = 0.01));
        Modelica.Fluid.Interfaces.FluidPort_a port_a2(redeclare package Medium = Medium2, m_flow(min = if allowFlowReversal2 then -Modelica.Constants.inf else 0), h_outflow(nominal = 1E5, start = h_outflow_a2_start), Xi_outflow(each nominal = 0.01));
        Modelica.Fluid.Interfaces.FluidPort_b port_b2(redeclare package Medium = Medium2, m_flow(max = if allowFlowReversal2 then +Modelica.Constants.inf else 0), h_outflow(nominal = 1E5, start = h_outflow_b2_start), Xi_outflow(each nominal = 0.01));
      end FourPort;

      record FourPortFlowResistanceParameters
        parameter Boolean computeFlowResistance1 = true annotation(Evaluate = true);
        parameter Boolean from_dp1 = false annotation(Evaluate = true);
        parameter Modelica.SIunits.Pressure dp1_nominal(min = 0, displayUnit = "Pa");
        parameter Boolean linearizeFlowResistance1 = false;
        parameter Real deltaM1 = 0.1;
        parameter Boolean computeFlowResistance2 = true annotation(Evaluate = true);
        parameter Boolean from_dp2 = false annotation(Evaluate = true);
        parameter Modelica.SIunits.Pressure dp2_nominal(min = 0, displayUnit = "Pa");
        parameter Boolean linearizeFlowResistance2 = false;
        parameter Real deltaM2 = 0.1;
      end FourPortFlowResistanceParameters;

      model FourPortHeatMassExchanger
        extends Buildings.Fluid.Interfaces.PartialFourPortInterface(final h_outflow_a1_start = h1_outflow_start, final h_outflow_b1_start = h1_outflow_start, final h_outflow_a2_start = h2_outflow_start, final h_outflow_b2_start = h2_outflow_start);
        extends Buildings.Fluid.Interfaces.FourPortFlowResistanceParameters(final computeFlowResistance1 = true, final computeFlowResistance2 = true);
        parameter Modelica.SIunits.Time tau1 = 30;
        parameter Modelica.SIunits.Time tau2 = 30;
        parameter Boolean homotopyInitialization = true annotation(Evaluate = true);
        parameter Modelica.Fluid.Types.Dynamics energyDynamics = Modelica.Fluid.Types.Dynamics.DynamicFreeInitial annotation(Evaluate = true);
        parameter Modelica.Fluid.Types.Dynamics massDynamics = energyDynamics annotation(Evaluate = true);
        parameter Medium1.AbsolutePressure p1_start = Medium1.p_default;
        parameter Medium1.Temperature T1_start = Medium1.T_default;
        parameter Medium1.MassFraction[Medium1.nX] X1_start = Medium1.X_default;
        parameter Medium1.ExtraProperty[Medium1.nC] C1_start(quantity = Medium1.extraPropertiesNames) = fill(0, Medium1.nC);
        parameter Medium1.ExtraProperty[Medium1.nC] C1_nominal(quantity = Medium1.extraPropertiesNames) = fill(1E-2, Medium1.nC);
        parameter Medium2.AbsolutePressure p2_start = Medium2.p_default;
        parameter Medium2.Temperature T2_start = Medium2.T_default;
        parameter Medium2.MassFraction[Medium2.nX] X2_start = Medium2.X_default;
        parameter Medium2.ExtraProperty[Medium2.nC] C2_start(quantity = Medium2.extraPropertiesNames) = fill(0, Medium2.nC);
        parameter Medium2.ExtraProperty[Medium2.nC] C2_nominal(quantity = Medium2.extraPropertiesNames) = fill(1E-2, Medium2.nC);
        Buildings.Fluid.MixingVolumes.MixingVolume vol1(redeclare final package Medium = Medium1, nPorts = 2, V = m1_flow_nominal * tau1 / rho1_nominal, final m_flow_nominal = m1_flow_nominal, energyDynamics = if tau1 > Modelica.Constants.eps then energyDynamics else Modelica.Fluid.Types.Dynamics.SteadyState, massDynamics = if tau1 > Modelica.Constants.eps then massDynamics else Modelica.Fluid.Types.Dynamics.SteadyState, final p_start = p1_start, final T_start = T1_start, final X_start = X1_start, final C_start = C1_start, final C_nominal = C1_nominal);
        replaceable Buildings.Fluid.MixingVolumes.MixingVolume vol2 constrainedby Buildings.Fluid.MixingVolumes.BaseClasses.PartialMixingVolume(redeclare final package Medium = Medium2, nPorts = 2, V = m2_flow_nominal * tau2 / rho2_nominal, final m_flow_nominal = m2_flow_nominal, energyDynamics = if tau2 > Modelica.Constants.eps then energyDynamics else Modelica.Fluid.Types.Dynamics.SteadyState, massDynamics = if tau2 > Modelica.Constants.eps then massDynamics else Modelica.Fluid.Types.Dynamics.SteadyState, final p_start = p2_start, final T_start = T2_start, final X_start = X2_start, final C_start = C2_start, final C_nominal = C2_nominal);
        Modelica.SIunits.HeatFlowRate Q1_flow = vol1.heatPort.Q_flow;
        Modelica.SIunits.HeatFlowRate Q2_flow = vol2.heatPort.Q_flow;
        Buildings.Fluid.FixedResistances.FixedResistanceDpM preDro1(redeclare package Medium = Medium1, final use_dh = false, final m_flow_nominal = m1_flow_nominal, final deltaM = deltaM1, final allowFlowReversal = allowFlowReversal1, final show_T = false, final from_dp = from_dp1, final linearized = linearizeFlowResistance1, final homotopyInitialization = homotopyInitialization, final dp_nominal = dp1_nominal, final dh = 1, final ReC = 4000);
        Buildings.Fluid.FixedResistances.FixedResistanceDpM preDro2(redeclare package Medium = Medium2, final use_dh = false, final m_flow_nominal = m2_flow_nominal, final deltaM = deltaM2, final allowFlowReversal = allowFlowReversal2, final show_T = false, final from_dp = from_dp2, final linearized = linearizeFlowResistance2, final homotopyInitialization = homotopyInitialization, final dp_nominal = dp2_nominal, final dh = 1, final ReC = 4000);
      protected
        parameter Medium1.ThermodynamicState sta1_nominal = Medium1.setState_pTX(T = Medium1.T_default, p = Medium1.p_default, X = Medium1.X_default);
        parameter Modelica.SIunits.Density rho1_nominal = Medium1.density(sta1_nominal);
        parameter Medium2.ThermodynamicState sta2_nominal = Medium2.setState_pTX(T = Medium2.T_default, p = Medium2.p_default, X = Medium2.X_default);
        parameter Modelica.SIunits.Density rho2_nominal = Medium2.density(sta2_nominal);
        parameter Medium1.ThermodynamicState sta1_start = Medium1.setState_pTX(T = T1_start, p = p1_start, X = X1_start);
        parameter Modelica.SIunits.SpecificEnthalpy h1_outflow_start = Medium1.specificEnthalpy(sta1_start);
        parameter Medium2.ThermodynamicState sta2_start = Medium2.setState_pTX(T = T2_start, p = p2_start, X = X2_start);
        parameter Modelica.SIunits.SpecificEnthalpy h2_outflow_start = Medium2.specificEnthalpy(sta2_start);
      initial algorithm
        assert(energyDynamics == Modelica.Fluid.Types.Dynamics.SteadyState or tau1 > Modelica.Constants.eps, "The parameter tau1, or the volume of the model from which tau may be derived, is unreasonably small.
         You need to set energyDynamics == Modelica.Fluid.Types.Dynamics.SteadyState to model steady-state.
         Received tau1 = " + String(tau1) + "\n");
        assert(massDynamics == Modelica.Fluid.Types.Dynamics.SteadyState or tau1 > Modelica.Constants.eps, "The parameter tau1, or the volume of the model from which tau may be derived, is unreasonably small.
         You need to set massDynamics == Modelica.Fluid.Types.Dynamics.SteadyState to model steady-state.
         Received tau1 = " + String(tau1) + "\n");
        assert(energyDynamics == Modelica.Fluid.Types.Dynamics.SteadyState or tau2 > Modelica.Constants.eps, "The parameter tau2, or the volume of the model from which tau may be derived, is unreasonably small.
         You need to set energyDynamics == Modelica.Fluid.Types.Dynamics.SteadyState to model steady-state.
         Received tau2 = " + String(tau2) + "\n");
        assert(massDynamics == Modelica.Fluid.Types.Dynamics.SteadyState or tau2 > Modelica.Constants.eps, "The parameter tau2, or the volume of the model from which tau may be derived, is unreasonably small.
         You need to set massDynamics == Modelica.Fluid.Types.Dynamics.SteadyState to model steady-state.
         Received tau2 = " + String(tau2) + "\n");
      equation
        connect(vol1.ports[2], port_b1);
        connect(vol2.ports[2], port_b2);
        connect(port_a1, preDro1.port_a);
        connect(preDro1.port_b, vol1.ports[1]);
        connect(port_a2, preDro2.port_a);
        connect(preDro2.port_b, vol2.ports[1]);
      end FourPortHeatMassExchanger;

      record LumpedVolumeDeclarations
        replaceable package Medium = Modelica.Media.Interfaces.PartialMedium;
        parameter Modelica.Fluid.Types.Dynamics energyDynamics = Modelica.Fluid.Types.Dynamics.DynamicFreeInitial annotation(Evaluate = true);
        parameter Modelica.Fluid.Types.Dynamics massDynamics = energyDynamics annotation(Evaluate = true);
        final parameter Modelica.Fluid.Types.Dynamics substanceDynamics = energyDynamics annotation(Evaluate = true);
        final parameter Modelica.Fluid.Types.Dynamics traceDynamics = energyDynamics annotation(Evaluate = true);
        parameter Medium.AbsolutePressure p_start = Medium.p_default;
        parameter Medium.Temperature T_start = Medium.T_default;
        parameter Medium.MassFraction[Medium.nX] X_start = Medium.X_default;
        parameter Medium.ExtraProperty[Medium.nC] C_start(quantity = Medium.extraPropertiesNames) = fill(0, Medium.nC);
        parameter Medium.ExtraProperty[Medium.nC] C_nominal(quantity = Medium.extraPropertiesNames) = fill(1E-2, Medium.nC);
      end LumpedVolumeDeclarations;

      partial model PartialFourPortInterface
        extends Buildings.Fluid.Interfaces.FourPort;
        parameter Modelica.SIunits.MassFlowRate m1_flow_nominal(min = 0);
        parameter Modelica.SIunits.MassFlowRate m2_flow_nominal(min = 0);
        parameter Medium1.MassFlowRate m1_flow_small(min = 0) = 1E-4 * abs(m1_flow_nominal);
        parameter Medium2.MassFlowRate m2_flow_small(min = 0) = 1E-4 * abs(m2_flow_nominal);
        parameter Boolean show_T = false;
        Medium1.MassFlowRate m1_flow(start = 0) = port_a1.m_flow;
        Modelica.SIunits.Pressure dp1(start = 0, displayUnit = "Pa");
        Medium2.MassFlowRate m2_flow(start = 0) = port_a2.m_flow;
        Modelica.SIunits.Pressure dp2(start = 0, displayUnit = "Pa");
        Medium1.ThermodynamicState sta_a1 = Medium1.setState_phX(port_a1.p, noEvent(actualStream(port_a1.h_outflow)), noEvent(actualStream(port_a1.Xi_outflow))) if show_T;
        Medium1.ThermodynamicState sta_b1 = Medium1.setState_phX(port_b1.p, noEvent(actualStream(port_b1.h_outflow)), noEvent(actualStream(port_b1.Xi_outflow))) if show_T;
        Medium2.ThermodynamicState sta_a2 = Medium2.setState_phX(port_a2.p, noEvent(actualStream(port_a2.h_outflow)), noEvent(actualStream(port_a2.Xi_outflow))) if show_T;
        Medium2.ThermodynamicState sta_b2 = Medium2.setState_phX(port_b2.p, noEvent(actualStream(port_b2.h_outflow)), noEvent(actualStream(port_b2.Xi_outflow))) if show_T;
      protected
        Medium1.ThermodynamicState state_a1_inflow = Medium1.setState_phX(port_a1.p, inStream(port_a1.h_outflow), inStream(port_a1.Xi_outflow));
        Medium1.ThermodynamicState state_b1_inflow = Medium1.setState_phX(port_b1.p, inStream(port_b1.h_outflow), inStream(port_b1.Xi_outflow));
        Medium2.ThermodynamicState state_a2_inflow = Medium2.setState_phX(port_a2.p, inStream(port_a2.h_outflow), inStream(port_a2.Xi_outflow));
        Medium2.ThermodynamicState state_b2_inflow = Medium2.setState_phX(port_b2.p, inStream(port_b2.h_outflow), inStream(port_b2.Xi_outflow));
      equation
        dp1 = port_a1.p - port_b1.p;
        dp2 = port_a2.p - port_b2.p;
      end PartialFourPortInterface;

      partial model PartialTwoPortInterface
        extends Modelica.Fluid.Interfaces.PartialTwoPort(port_a(p(start = Medium.p_default, nominal = Medium.p_default)), port_b(p(start = Medium.p_default, nominal = Medium.p_default)));
        parameter Modelica.SIunits.MassFlowRate m_flow_nominal;
        parameter Modelica.SIunits.MassFlowRate m_flow_small(min = 0) = 1E-4 * abs(m_flow_nominal);
        parameter Boolean show_T = false;
        Modelica.SIunits.MassFlowRate m_flow(start = 0) = port_a.m_flow;
        Modelica.SIunits.Pressure dp(start = 0, displayUnit = "Pa");
        Medium.ThermodynamicState sta_a = Medium.setState_phX(port_a.p, noEvent(actualStream(port_a.h_outflow)), noEvent(actualStream(port_a.Xi_outflow))) if show_T;
        Medium.ThermodynamicState sta_b = Medium.setState_phX(port_b.p, noEvent(actualStream(port_b.h_outflow)), noEvent(actualStream(port_b.Xi_outflow))) if show_T;
      equation
        dp = port_a.p - port_b.p;
      end PartialTwoPortInterface;

      model StaticTwoPortConservationEquation
        extends Buildings.Fluid.Interfaces.PartialTwoPortInterface(showDesignFlowDirection = false);
        constant Boolean sensibleOnly;
        Modelica.Blocks.Interfaces.RealInput Q_flow(unit = "W");
        Modelica.Blocks.Interfaces.RealInput mWat_flow(unit = "kg/s");
        Modelica.Blocks.Interfaces.RealOutput hOut(unit = "J/kg", start = Medium.specificEnthalpy_pTX(p = Medium.p_default, T = Medium.T_default, X = Medium.X_default));
        Modelica.Blocks.Interfaces.RealOutput[Medium.nXi] XiOut(each unit = "1", each min = 0, each max = 1);
        Modelica.Blocks.Interfaces.RealOutput[Medium.nC] COut(each min = 0);
        constant Boolean use_safeDivision = true;
      protected
        Real m_flowInv(unit = "s/kg");
        Modelica.SIunits.MassFlowRate[Medium.nXi] mXi_flow;
        final parameter Real[Medium.nXi] s = array(if Modelica.Utilities.Strings.isEqual(string1 = Medium.substanceNames[i], string2 = "Water", caseSensitive = false) then 1 else 0 for i in 1:Medium.nXi);
      initial equation
        assert(Medium.nXi == 0 or abs(sum(s) - 1) < 1e-5, "If Medium.nXi > 1, then substance 'water' must be present for one component.'" + Medium.mediumName + "'.\n" + "Check medium model.");
      equation
        mXi_flow = mWat_flow * s;
        if use_safeDivision then
          m_flowInv = Buildings.Utilities.Math.Functions.inverseXRegularized(x = port_a.m_flow, delta = m_flow_small / 1E3);
        else
          m_flowInv = 0;
        end if;
        if allowFlowReversal then
          hOut = Buildings.Utilities.Math.Functions.spliceFunction(pos = port_b.h_outflow, neg = port_a.h_outflow, x = port_a.m_flow, deltax = m_flow_small / 1E3);
          XiOut = Buildings.Utilities.Math.Functions.spliceFunction(pos = port_b.Xi_outflow, neg = port_a.Xi_outflow, x = port_a.m_flow, deltax = m_flow_small / 1E3);
          COut = Buildings.Utilities.Math.Functions.spliceFunction(pos = port_b.C_outflow, neg = port_a.C_outflow, x = port_a.m_flow, deltax = m_flow_small / 1E3);
        else
          hOut = port_b.h_outflow;
          XiOut = port_b.Xi_outflow;
          COut = port_b.C_outflow;
        end if;
        if sensibleOnly then
          port_a.m_flow = -port_b.m_flow;
          if use_safeDivision then
            port_b.h_outflow = inStream(port_a.h_outflow) + Q_flow * m_flowInv;
            port_a.h_outflow = inStream(port_b.h_outflow) - Q_flow * m_flowInv;
          else
            port_a.m_flow * (inStream(port_a.h_outflow) - port_b.h_outflow) = -Q_flow;
            port_a.m_flow * (inStream(port_b.h_outflow) - port_a.h_outflow) = +Q_flow;
          end if;
          port_a.Xi_outflow = inStream(port_b.Xi_outflow);
          port_b.Xi_outflow = inStream(port_a.Xi_outflow);
          port_a.C_outflow = inStream(port_b.C_outflow);
          port_b.C_outflow = inStream(port_a.C_outflow);
        else
          port_a.m_flow + port_b.m_flow = -mWat_flow;
          if use_safeDivision then
            port_b.h_outflow = inStream(port_a.h_outflow) + Q_flow * m_flowInv;
            port_a.h_outflow = inStream(port_b.h_outflow) - Q_flow * m_flowInv;
            port_b.Xi_outflow = inStream(port_a.Xi_outflow) + mXi_flow * m_flowInv;
            port_a.Xi_outflow = inStream(port_b.Xi_outflow) - mXi_flow * m_flowInv;
          else
            port_a.m_flow * (inStream(port_a.h_outflow) - port_b.h_outflow) = -Q_flow;
            port_a.m_flow * (inStream(port_b.h_outflow) - port_a.h_outflow) = +Q_flow;
            port_a.m_flow * (inStream(port_a.Xi_outflow) - port_b.Xi_outflow) = -mXi_flow;
            port_a.m_flow * (inStream(port_b.Xi_outflow) - port_a.Xi_outflow) = +mXi_flow;
          end if;
          port_a.m_flow * port_a.C_outflow = -port_b.m_flow * inStream(port_b.C_outflow);
          port_b.m_flow * port_b.C_outflow = -port_a.m_flow * inStream(port_a.C_outflow);
        end if;
        port_a.p = port_b.p;
      end StaticTwoPortConservationEquation;

      record TwoPortFlowResistanceParameters
        parameter Boolean computeFlowResistance = true annotation(Evaluate = true);
        parameter Boolean from_dp = false annotation(Evaluate = true);
        parameter Modelica.SIunits.Pressure dp_nominal(min = 0, displayUnit = "Pa");
        parameter Boolean linearizeFlowResistance = false;
        parameter Real deltaM = 0.1;
      end TwoPortFlowResistanceParameters;
    end Interfaces;
  end Fluid;

  package HeatTransfer
    extends Modelica.Icons.Package;

    package Conduction
      extends Modelica.Icons.VariantsPackage;

      model SingleLayerCylinder
        replaceable parameter Buildings.HeatTransfer.Data.Soil.Generic material annotation(choicesAllMatching = true);
        parameter Modelica.SIunits.Height h;
        parameter Modelica.SIunits.Radius r_a;
        parameter Modelica.SIunits.Radius r_b;
        parameter Integer nSta(min = 1);
        parameter Modelica.SIunits.Temperature TInt_start = 293.15;
        parameter Modelica.SIunits.Temperature TExt_start = 293.15;
        parameter Boolean steadyStateInitial = false annotation(Evaluate = true);
        parameter Real griFac(min = 1) = 2;
        Modelica.SIunits.TemperatureDifference dT;
        Modelica.Thermal.HeatTransfer.Interfaces.HeatPort_a port_a;
        Modelica.Thermal.HeatTransfer.Interfaces.HeatPort_b port_b;
        Modelica.SIunits.Temperature[nSta] T(start = array(TInt_start + (TExt_start - TInt_start) / Modelica.Math.log(r_b / r_a) * Modelica.Math.log((r_a + (r_b - r_a) / nSta * (i - 0.5)) / r_a) for i in 1:nSta));
        Modelica.SIunits.HeatFlowRate[nSta + 1] Q_flow;
      protected
        parameter Modelica.SIunits.Radius[nSta + 1] r(each fixed = false);
        parameter Modelica.SIunits.Radius[nSta] rC(each fixed = false);
        final parameter Modelica.SIunits.SpecificHeatCapacity c = material.c;
        final parameter Modelica.SIunits.ThermalConductivity k = material.k;
        final parameter Modelica.SIunits.Density d = material.d;
        parameter Modelica.SIunits.ThermalConductance[nSta + 1] G(each fixed = false);
        parameter Modelica.SIunits.HeatCapacity[nSta] C(each fixed = false);
      initial equation
        assert(r_a < r_b, "Error: Model requires r_a < r_b.");
        assert(0 < r_a, "Error: Model requires 0 < r_a.");
        r[1] = r_a;
        for i in 2:nSta + 1 loop
          r[i] = r[i - 1] + (r_b - r_a) * (1 - griFac) / (1 - griFac ^ nSta) * griFac ^ (i - 2);
        end for;
        assert(abs(r[nSta + 1] - r_b) < 1E-10, "Error: Wrong computation of radius. r[nSta+1]=" + String(r[nSta + 1]));
        for i in 1:nSta loop
          rC[i] = (r[i] + r[i + 1]) / 2;
        end for;
        G[1] = 2 * Modelica.Constants.pi * k * h / Modelica.Math.log(rC[1] / r_a);
        G[nSta + 1] = 2 * Modelica.Constants.pi * k * h / Modelica.Math.log(r_b / rC[nSta]);
        for i in 2:nSta loop
          G[i] = 2 * Modelica.Constants.pi * k * h / Modelica.Math.log(rC[i] / rC[i - 1]);
        end for;
        for i in 1:nSta loop
          C[i] = d * Modelica.Constants.pi * c * h * (r[i + 1] ^ 2 - r[i] ^ 2);
        end for;
        if not material.steadyState then
          if steadyStateInitial then
            der(T) = zeros(nSta);
          else
            for i in 1:nSta loop
              T[i] = TInt_start + (TExt_start - TInt_start) / Modelica.Math.log(r_b / r_a) * Modelica.Math.log(rC[i] / r_a);
            end for;
          end if;
        end if;
      equation
        dT = port_a.T - port_b.T;
        port_a.Q_flow = +Q_flow[1];
        port_b.Q_flow = -Q_flow[nSta + 1];
        Q_flow[1] = G[1] * (port_a.T - T[1]);
        Q_flow[nSta + 1] = G[nSta + 1] * (T[nSta] - port_b.T);
        for i in 2:nSta loop
          Q_flow[i] = G[i] * (T[i - 1] - T[i]);
        end for;
        if material.steadyState then
          for i in 2:nSta + 1 loop
            Q_flow[i] = Q_flow[1];
          end for;
        else
          for i in 1:nSta loop
            der(T[i]) = (Q_flow[i] - Q_flow[i + 1]) / C[i];
          end for;
        end if;
      end SingleLayerCylinder;
    end Conduction;

    package Data
      extends Modelica.Icons.MaterialPropertiesPackage;

      package BoreholeFillings
        extends Modelica.Icons.MaterialPropertiesPackage;
        record Generic = Buildings.HeatTransfer.Data.BaseClasses.ThermalProperties;
        record Bentonite = Buildings.HeatTransfer.Data.BoreholeFillings.Generic(k = 1.15, d = 1600, c = 800);
      end BoreholeFillings;

      package Soil
        extends Modelica.Icons.MaterialPropertiesPackage;

        record Generic
          extends Buildings.HeatTransfer.Data.BaseClasses.ThermalProperties;
        end Generic;

        record Concrete = Buildings.HeatTransfer.Data.Soil.Generic(k = 3.1, d = 2000, c = 840);
      end Soil;

      package BaseClasses
        extends Modelica.Icons.BasesPackage;

        record ThermalProperties
          extends Modelica.Icons.Record;
          parameter Modelica.SIunits.ThermalConductivity k;
          parameter Modelica.SIunits.SpecificHeatCapacity c;
          parameter Modelica.SIunits.Density d;
          parameter Boolean steadyState = c == 0 or d == 0 annotation(Evaluate = true);
        end ThermalProperties;
      end BaseClasses;
    end Data;
  end HeatTransfer;

  package Media
    extends Modelica.Icons.Package;

    package ConstantPropertyLiquidWater
      extends Buildings.Media.Interfaces.PartialSimpleMedium(mediumName = "SimpleLiquidWater", cp_const = 4184, cv_const = 4184, d_const = 995.586, eta_const = 1.e-3, lambda_const = 0.598, a_const = 1484, T_min = Modelica.SIunits.Conversions.from_degC(-1), T_max = Modelica.SIunits.Conversions.from_degC(130), T0 = 273.15, MM_const = 0.018015268, fluidConstants = .Modelica.Media.Water.ConstantPropertyLiquidWater.simpleWaterConstants, ThermoStates = Interfaces.Choices.IndependentVariables.T);

      redeclare replaceable function extends specificInternalEnergy
      algorithm
        u := cv_const * (state.T - T0);
      end specificInternalEnergy;
    end ConstantPropertyLiquidWater;

    package Interfaces
      extends Modelica.Icons.InterfacesPackage;

      package Choices
        type IndependentVariables = enumeration(T, pT, ph, phX, pTX, dTX);
      end Choices;

      partial package PartialSimpleMedium
        extends Modelica.Media.Interfaces.PartialPureSubstance(ThermoStates = Choices.IndependentVariables.pT, final singleState = true, reference_p = p0, p_default = p0);
        constant SpecificHeatCapacity cp_const;
        constant SpecificHeatCapacity cv_const;
        constant Density d_const;
        constant DynamicViscosity eta_const;
        constant ThermalConductivity lambda_const;
        constant VelocityOfSound a_const;
        constant Temperature T_min;
        constant Temperature T_max;
        constant Temperature T0 = reference_T;
        constant MolarMass MM_const;
        constant FluidConstants[nS] fluidConstants;

        redeclare record extends ThermodynamicState
          AbsolutePressure p(start = p_default);
          Temperature T(start = T_default);
        end ThermodynamicState;

        constant Modelica.SIunits.AbsolutePressure p0 = 3E5;

        redeclare replaceable model extends BaseProperties
        equation
          assert(T >= T_min and T <= T_max, "
          Temperature T (= " + String(T) + " K) is not
          in the allowed range (" + String(T_min) + " K <= T <= " + String(T_max) + " K)
          required from medium model \"" + mediumName + "\".
          ");
          h = specificEnthalpy_pTX(p, T, X);
          u = cv_const * (T - T0);
          d = d_const;
          R = 0;
          MM = MM_const;
          state.T = T;
          state.p = p;
        end BaseProperties;

        redeclare function setState_pTX
          extends Modelica.Icons.Function;
          input AbsolutePressure p;
          input Temperature T;
          input MassFraction[:] X = reference_X;
          output ThermodynamicState state;
        algorithm
          state := ThermodynamicState(p = p, T = T);
        end setState_pTX;

        redeclare function setState_phX
          extends Modelica.Icons.Function;
          input AbsolutePressure p;
          input SpecificEnthalpy h;
          input MassFraction[:] X = reference_X;
          output ThermodynamicState state;
        algorithm
          state := ThermodynamicState(p = p, T = temperature_phX(p, h, X));
        end setState_phX;

        redeclare function extends setSmoothState
        algorithm
          state := ThermodynamicState(p = Modelica.Media.Common.smoothStep(x, state_a.p, state_b.p, x_small), T = Modelica.Media.Common.smoothStep(x, state_a.T, state_b.T, x_small));
        end setSmoothState;

        redeclare function extends dynamicViscosity
        algorithm
          eta := eta_const;
        end dynamicViscosity;

        redeclare function extends thermalConductivity
        algorithm
          lambda := lambda_const;
        end thermalConductivity;

        redeclare function extends pressure
        algorithm
          p := state.p;
        end pressure;

        redeclare function extends temperature
        algorithm
          T := state.T;
        end temperature;

        redeclare function extends density
        algorithm
          d := d_const;
        end density;

        redeclare function extends specificEnthalpy
        algorithm
          h := cp_const * (state.T - T0);
        end specificEnthalpy;

        redeclare function extends specificHeatCapacityCp
        algorithm
          cp := cp_const;
        end specificHeatCapacityCp;

        redeclare function extends specificHeatCapacityCv
        algorithm
          cv := cv_const;
        end specificHeatCapacityCv;

        redeclare function extends isentropicExponent
        algorithm
          gamma := cp_const / cv_const;
        end isentropicExponent;

        redeclare function extends velocityOfSound
        algorithm
          a := a_const;
        end velocityOfSound;

        redeclare function specificEnthalpy_pTX
          extends Modelica.Icons.Function;
          input AbsolutePressure p;
          input Temperature T;
          input MassFraction[nX] X;
          output SpecificEnthalpy h;
        algorithm
          h := cp_const * (T - T0);
        end specificEnthalpy_pTX;

        redeclare function temperature_phX
          extends Modelica.Icons.Function;
          input AbsolutePressure p;
          input SpecificEnthalpy h;
          input MassFraction[nX] X;
          output Temperature T;
        algorithm
          T := T0 + h / cp_const;
        end temperature_phX;
      end PartialSimpleMedium;
    end Interfaces;
  end Media;

  package Utilities
    extends Modelica.Icons.Package;

    package Math
      extends Modelica.Icons.Package;

      package Functions
        extends Modelica.Icons.VariantsPackage;

        function inverseXRegularized
          input Real x;
          input Real delta(min = 0);
          output Real y;
        protected
          Real delta2;
          Real x2_d2;
        algorithm
          if abs(x) > delta then
            y := 1 / x;
          else
            delta2 := delta * delta;
            x2_d2 := x * x / delta2;
            y := x / delta2 + x * abs(x / delta2 / delta * (2 - x2_d2 * (3 - x2_d2)));
          end if;
        end inverseXRegularized;

        function regNonZeroPower
          input Real x;
          input Real n;
          input Real delta = 0.01;
          output Real y;
        protected
          Real a1;
          Real a3;
          Real a5;
          Real delta2;
          Real x2;
          Real y_d;
          Real yP_d;
          Real yPP_d;
        algorithm
          if abs(x) > delta then
            y := abs(x) ^ n;
          else
            delta2 := delta * delta;
            x2 := x * x;
            y_d := delta ^ n;
            yP_d := n * delta ^ (n - 1);
            yPP_d := n * (n - 1) * delta ^ (n - 2);
            a1 := -(yP_d / delta - yPP_d) / delta2 / 8;
            a3 := (yPP_d - 12 * a1 * delta2) / 2;
            a5 := y_d - delta2 * (a3 + delta2 * a1);
            y := a5 + x2 * (a3 + x2 * a1);
            assert(a5 > 0, "Delta is too small for this exponent.");
          end if;
        end regNonZeroPower;

        function spliceFunction
          input Real pos;
          input Real neg;
          input Real x;
          input Real deltax;
          output Real out;
        protected
          Real scaledX1;
          Real y;
          constant Real asin1 = Modelica.Math.asin(1);
        algorithm
          scaledX1 := x / deltax;
          if scaledX1 <= (-0.999999999) then
            out := neg;
          elseif scaledX1 >= 0.999999999 then
            out := pos;
          else
            y := (Modelica.Math.tanh(Modelica.Math.tan(scaledX1 * asin1)) + 1) / 2;
            out := pos * y + (1 - y) * neg;
          end if;
        end spliceFunction;

        package BaseClasses
          extends Modelica.Icons.BasesPackage;

          function der_2_regNonZeroPower
            input Real x;
            input Real n;
            input Real delta = 0.01;
            input Real der_x;
            input Real der_2_x;
            output Real der_2_y;
          protected
            Real a1;
            Real a3;
            Real delta2;
            Real x2;
            Real y_d;
            Real yP_d;
            Real yPP_d;
          algorithm
            if abs(x) > delta then
              der_2_y := n * (n - 1) * abs(x) ^ (n - 2);
            else
              delta2 := delta * delta;
              x2 := x * x;
              y_d := delta ^ n;
              yP_d := n * delta ^ (n - 1);
              yPP_d := n * (n - 1) * delta ^ (n - 2);
              a1 := -(yP_d / delta - yPP_d) / delta2 / 8;
              a3 := (yPP_d - 12 * a1 * delta2) / 2;
              der_2_y := 12 * a1 * x2 + 2 * a3;
            end if;
          end der_2_regNonZeroPower;

          function der_regNonZeroPower
            input Real x;
            input Real n;
            input Real delta = 0.01;
            input Real der_x;
            output Real der_y;
          protected
            Real a1;
            Real a3;
            Real delta2;
            Real x2;
            Real y_d;
            Real yP_d;
            Real yPP_d;
          algorithm
            if abs(x) > delta then
              der_y := sign(x) * n * abs(x) ^ (n - 1);
            else
              delta2 := delta * delta;
              x2 := x * x;
              y_d := delta ^ n;
              yP_d := n * delta ^ (n - 1);
              yPP_d := n * (n - 1) * delta ^ (n - 2);
              a1 := -(yP_d / delta - yPP_d) / delta2 / 8;
              a3 := (yPP_d - 12 * a1 * delta2) / 2;
              der_y := x * (4 * a1 * x * x + 2 * a3);
            end if;
          end der_regNonZeroPower;

          function der_spliceFunction
            input Real pos;
            input Real neg;
            input Real x;
            input Real deltax = 1;
            input Real dpos;
            input Real dneg;
            input Real dx;
            input Real ddeltax = 0;
            output Real out;
          protected
            Real scaledX;
            Real scaledX1;
            Real dscaledX1;
            Real y;
            constant Real asin1 = Modelica.Math.asin(1);
          algorithm
            scaledX1 := x / deltax;
            if scaledX1 <= (-0.99999999999) then
              out := dneg;
            elseif scaledX1 >= 0.9999999999 then
              out := dpos;
            else
              scaledX := scaledX1 * asin1;
              dscaledX1 := (dx - scaledX1 * ddeltax) / deltax;
              y := (Modelica.Math.tanh(Modelica.Math.tan(scaledX)) + 1) / 2;
              out := dpos * y + (1 - y) * dneg;
              out := out + (pos - neg) * dscaledX1 * asin1 / 2 / (Modelica.Math.cosh(Modelica.Math.tan(scaledX)) * Modelica.Math.cos(scaledX)) ^ 2;
            end if;
          end der_spliceFunction;
        end BaseClasses;
      end Functions;
    end Math;
  end Utilities;
end Buildings;

package ModelicaServices
  extends Modelica.Icons.Package;

  package Machine
    extends Modelica.Icons.Package;
    final constant Real eps = 1.e-15;
    final constant Real small = 1.e-60;
    final constant Real inf = 1.e+60;
    final constant Integer Integer_inf = OpenModelica.Internal.Architecture.integerMax();
  end Machine;
end ModelicaServices;

package Modelica
  extends Modelica.Icons.Package;

  package Blocks
    extends Modelica.Icons.Package;

    package Interfaces
      extends Modelica.Icons.InterfacesPackage;
      connector RealInput = input Real;
      connector RealOutput = output Real;

      partial block SO
        extends Modelica.Blocks.Icons.Block;
        RealOutput y;
      end SO;
    end Interfaces;

    package Sources
      extends Modelica.Icons.SourcesPackage;

      block RealExpression
        Modelica.Blocks.Interfaces.RealOutput y = 0.0;
      end RealExpression;

      block Constant
        parameter Real k(start = 1);
        extends .Modelica.Blocks.Interfaces.SO;
      equation
        y = k;
      end Constant;
    end Sources;

    package Icons
      extends Modelica.Icons.IconsPackage;

      partial block Block  end Block;
    end Icons;
  end Blocks;

  package Fluid
    extends Modelica.Icons.Package;

    model System
      parameter Modelica.SIunits.AbsolutePressure p_ambient = 101325;
      parameter Modelica.SIunits.Temperature T_ambient = 293.15;
      parameter Modelica.SIunits.Acceleration g = Modelica.Constants.g_n;
      parameter Boolean allowFlowReversal = true annotation(Evaluate = true);
      parameter Modelica.Fluid.Types.Dynamics energyDynamics = Types.Dynamics.DynamicFreeInitial annotation(Evaluate = true);
      parameter Modelica.Fluid.Types.Dynamics massDynamics = energyDynamics annotation(Evaluate = true);
      final parameter Modelica.Fluid.Types.Dynamics substanceDynamics = massDynamics annotation(Evaluate = true);
      final parameter Modelica.Fluid.Types.Dynamics traceDynamics = massDynamics annotation(Evaluate = true);
      parameter Modelica.Fluid.Types.Dynamics momentumDynamics = Types.Dynamics.SteadyState annotation(Evaluate = true);
      parameter Modelica.SIunits.MassFlowRate m_flow_start = 0;
      parameter Modelica.SIunits.AbsolutePressure p_start = p_ambient;
      parameter Modelica.SIunits.Temperature T_start = T_ambient;
      parameter Boolean use_eps_Re = false annotation(Evaluate = true);
      parameter Modelica.SIunits.MassFlowRate m_flow_nominal = if use_eps_Re then 1 else 1e2 * m_flow_small;
      parameter Real eps_m_flow(min = 0) = 1e-4;
      parameter Modelica.SIunits.AbsolutePressure dp_small(min = 0) = 1;
      parameter Modelica.SIunits.MassFlowRate m_flow_small(min = 0) = 1e-2;
    end System;

    package Vessels
      extends Modelica.Icons.VariantsPackage;

      package BaseClasses
        extends Modelica.Icons.BasesPackage;

        connector VesselFluidPorts_b
          extends Interfaces.FluidPort;
        end VesselFluidPorts_b;
      end BaseClasses;
    end Vessels;

    package Sources
      extends Modelica.Icons.SourcesPackage;

      package BaseClasses
        extends Modelica.Icons.BasesPackage;

        partial model PartialSource
          parameter Integer nPorts = 0;
          replaceable package Medium = Modelica.Media.Interfaces.PartialMedium;
          Medium.BaseProperties medium;
          Interfaces.FluidPorts_b[nPorts] ports(redeclare each package Medium = Medium, m_flow(each max = if flowDirection == Types.PortFlowDirection.Leaving then 0 else +.Modelica.Constants.inf, each min = if flowDirection == Types.PortFlowDirection.Entering then 0 else -.Modelica.Constants.inf));
        protected
          parameter Types.PortFlowDirection flowDirection = Types.PortFlowDirection.Bidirectional annotation(Evaluate = true);
        equation
          for i in 1:nPorts loop
            assert(cardinality(ports[i]) <= 1, "
            each ports[i] of boundary shall at most be connected to one component.
            If two or more connections are present, ideal mixing takes
            place with these connections, which is usually not the intention
            of the modeller. Increase nPorts to add an additional port.
            ");
            ports[i].p = medium.p;
            ports[i].h_outflow = medium.h;
            ports[i].Xi_outflow = medium.Xi;
          end for;
        end PartialSource;
      end BaseClasses;
    end Sources;

    package Interfaces
      extends Modelica.Icons.InterfacesPackage;

      connector FluidPort
        replaceable package Medium = Modelica.Media.Interfaces.PartialMedium;
        flow Medium.MassFlowRate m_flow;
        Medium.AbsolutePressure p;
        stream Medium.SpecificEnthalpy h_outflow;
        stream Medium.MassFraction[Medium.nXi] Xi_outflow;
        stream Medium.ExtraProperty[Medium.nC] C_outflow;
      end FluidPort;

      connector FluidPort_a
        extends FluidPort;
      end FluidPort_a;

      connector FluidPort_b
        extends FluidPort;
      end FluidPort_b;

      connector FluidPorts_b
        extends FluidPort;
      end FluidPorts_b;

      partial model PartialTwoPort
        outer Modelica.Fluid.System system;
        replaceable package Medium = Modelica.Media.Interfaces.PartialMedium;
        parameter Boolean allowFlowReversal = system.allowFlowReversal annotation(Evaluate = true);
        Modelica.Fluid.Interfaces.FluidPort_a port_a(redeclare package Medium = Medium, m_flow(min = if allowFlowReversal then -.Modelica.Constants.inf else 0));
        Modelica.Fluid.Interfaces.FluidPort_b port_b(redeclare package Medium = Medium, m_flow(max = if allowFlowReversal then +.Modelica.Constants.inf else 0));
      protected
        parameter Boolean port_a_exposesState = false;
        parameter Boolean port_b_exposesState = false;
        parameter Boolean showDesignFlowDirection = true;
      end PartialTwoPort;
    end Interfaces;

    package Types
      extends Modelica.Icons.TypesPackage;
      type Dynamics = enumeration(DynamicFreeInitial, FixedInitial, SteadyStateInitial, SteadyState);
      type PortFlowDirection = enumeration(Entering, Leaving, Bidirectional);
    end Types;

    package Utilities
      extends Modelica.Icons.UtilitiesPackage;

      function checkBoundary
        extends Modelica.Icons.Function;
        input String mediumName;
        input String[:] substanceNames;
        input Boolean singleState;
        input Boolean define_p;
        input Real[:] X_boundary;
        input String modelName = "??? boundary ???";
      protected
        Integer nX = size(X_boundary, 1);
        String X_str;
      algorithm
        assert(not singleState or singleState and define_p, "
        Wrong value of parameter define_p (= false) in model \"" + modelName + "\":
        The selected medium \"" + mediumName + "\" has Medium.singleState=true.
        Therefore, an boundary density cannot be defined and
        define_p = true is required.
        ");
        for i in 1:nX loop
          assert(X_boundary[i] >= 0.0, "
          Wrong boundary mass fractions in medium \"" + mediumName + "\" in model \"" + modelName + "\":
          The boundary value X_boundary(" + String(i) + ") = " + String(X_boundary[i]) + "
          is negative. It must be positive.
          ");
        end for;
        if nX > 0 and abs(sum(X_boundary) - 1.0) > 1.e-10 then
          X_str := "";
          for i in 1:nX loop
            X_str := X_str + "   X_boundary[" + String(i) + "] = " + String(X_boundary[i]) + " \"" + substanceNames[i] + "\"\n";
          end for;
          Modelica.Utilities.Streams.error("The boundary mass fractions in medium \"" + mediumName + "\" in model \"" + modelName + "\"\n" + "do not sum up to 1. Instead, sum(X_boundary) = " + String(sum(X_boundary)) + ":\n" + X_str);
        else
        end if;
      end checkBoundary;

      function regRoot2
        extends Modelica.Icons.Function;
        input Real x;
        input Real x_small(min = 0) = 0.01;
        input Real k1(min = 0) = 1;
        input Real k2(min = 0) = 1;
        input Boolean use_yd0 = false;
        input Real yd0(min = 0) = 1;
        output Real y;

      protected
        encapsulated function regRoot2_utility
          extends .Modelica.Icons.Function;
          input Real x;
          input Real x1;
          input Real k1;
          input Real k2;
          input Boolean use_yd0;
          input Real yd0(min = 0);
          output Real y;
        protected
          Real x2;
          Real xsqrt1;
          Real xsqrt2;
          Real y1;
          Real y2;
          Real y1d;
          Real y2d;
          Real w;
          Real y0d;
          Real w1;
          Real w2;
          Real sqrt_k1 = if k1 > 0 then sqrt(k1) else 0;
          Real sqrt_k2 = if k2 > 0 then sqrt(k2) else 0;
        algorithm
          if k2 > 0 then
            x2 := -x1 * (k2 / k1);
          elseif k1 > 0 then
            x2 := -x1;
          else
            y := 0;
            return;
          end if;
          if x <= x2 then
            y := -sqrt_k2 * sqrt(abs(x));
          else
            y1 := sqrt_k1 * sqrt(x1);
            y2 := -sqrt_k2 * sqrt(abs(x2));
            y1d := sqrt_k1 / sqrt(x1) / 2;
            y2d := sqrt_k2 / sqrt(abs(x2)) / 2;
            if use_yd0 then
              y0d := yd0;
            else
              w := x2 / x1;
              y0d := ((3 * y2 - x2 * y2d) / w - (3 * y1 - x1 * y1d) * w) / (2 * x1 * (1 - w));
            end if;
            w1 := sqrt_k1 * sqrt(8.75 / x1);
            w2 := sqrt_k2 * sqrt(8.75 / abs(x2));
            y0d := smooth(2, min(y0d, 0.9 * min(w1, w2)));
            y := y1 * (if x >= 0 then .Modelica.Fluid.Utilities.evaluatePoly3_derivativeAtZero(x / x1, 1, 1, y1d * x1 / y1, y0d * x1 / y1) else .Modelica.Fluid.Utilities.evaluatePoly3_derivativeAtZero(x / x1, x2 / x1, y2 / y1, y2d * x1 / y1, y0d * x1 / y1));
          end if;
        end regRoot2_utility;
      algorithm
        y := smooth(2, if x >= x_small then sqrt(k1 * x) else if x <= (-x_small) then -sqrt(k2 * abs(x)) else if k1 >= k2 then regRoot2_utility(x, x_small, k1, k2, use_yd0, yd0) else -regRoot2_utility(-x, x_small, k2, k1, use_yd0, yd0));
      end regRoot2;

      function regSquare2
        extends Modelica.Icons.Function;
        input Real x;
        input Real x_small(min = 0) = 0.01;
        input Real k1(min = 0) = 1;
        input Real k2(min = 0) = 1;
        input Boolean use_yd0 = false;
        input Real yd0(min = 0) = 1;
        output Real y;

      protected
        encapsulated function regSquare2_utility
          extends .Modelica.Icons.Function;
          input Real x;
          input Real x1;
          input Real k1;
          input Real k2;
          input Boolean use_yd0 = false;
          input Real yd0(min = 0) = 1;
          output Real y;
        protected
          Real x2;
          Real y1;
          Real y2;
          Real y1d;
          Real y2d;
          Real w;
          Real w1;
          Real w2;
          Real y0d;
          Real ww;
        algorithm
          x2 := -x1;
          if x <= x2 then
            y := -k2 * x ^ 2;
          else
            y1 := k1 * x1 ^ 2;
            y2 := -k2 * x2 ^ 2;
            y1d := k1 * 2 * x1;
            y2d := -k2 * 2 * x2;
            if use_yd0 then
              y0d := yd0;
            else
              w := x2 / x1;
              y0d := ((3 * y2 - x2 * y2d) / w - (3 * y1 - x1 * y1d) * w) / (2 * x1 * (1 - w));
            end if;
            w1 := sqrt(5) * k1 * x1;
            w2 := sqrt(5) * k2 * abs(x2);
            ww := 0.9 * (if w1 < w2 then w1 else w2);
            if ww < y0d then
              y0d := ww;
            else
            end if;
            y := if x >= 0 then .Modelica.Fluid.Utilities.evaluatePoly3_derivativeAtZero(x, x1, y1, y1d, y0d) else .Modelica.Fluid.Utilities.evaluatePoly3_derivativeAtZero(x, x2, y2, y2d, y0d);
          end if;
        end regSquare2_utility;
      algorithm
        y := smooth(2, if x >= x_small then k1 * x ^ 2 else if x <= (-x_small) then -k2 * x ^ 2 else if k1 >= k2 then regSquare2_utility(x, x_small, k1, k2, use_yd0, yd0) else -regSquare2_utility(-x, x_small, k2, k1, use_yd0, yd0));
      end regSquare2;

      function evaluatePoly3_derivativeAtZero
        extends Modelica.Icons.Function;
        input Real x;
        input Real x1;
        input Real y1;
        input Real y1d;
        input Real y0d;
        output Real y;
      protected
        Real a1;
        Real a2;
        Real a3;
        Real xx;
      algorithm
        a1 := x1 * y0d;
        a2 := 3 * y1 - x1 * y1d - 2 * a1;
        a3 := y1 - a2 - a1;
        xx := x / x1;
        y := xx * (a1 + xx * (a2 + xx * a3));
      end evaluatePoly3_derivativeAtZero;
    end Utilities;
  end Fluid;

  package Media
    extends Modelica.Icons.Package;

    package Interfaces
      extends Modelica.Icons.InterfacesPackage;

      partial package PartialMedium
        extends Modelica.Media.Interfaces.Types;
        extends Modelica.Icons.MaterialPropertiesPackage;
        constant Modelica.Media.Interfaces.Choices.IndependentVariables ThermoStates;
        constant String mediumName = "unusablePartialMedium";
        constant String[:] substanceNames = {mediumName};
        constant String[:] extraPropertiesNames = fill("", 0);
        constant Boolean singleState;
        constant Boolean reducedX = true;
        constant Boolean fixedX = false;
        constant AbsolutePressure reference_p = 101325;
        constant Temperature reference_T = 298.15;
        constant MassFraction[nX] reference_X = fill(1 / nX, nX);
        constant AbsolutePressure p_default = 101325;
        constant Temperature T_default = Modelica.SIunits.Conversions.from_degC(20);
        constant SpecificEnthalpy h_default = specificEnthalpy_pTX(p_default, T_default, X_default);
        constant MassFraction[nX] X_default = reference_X;
        final constant Integer nS = size(substanceNames, 1) annotation(Evaluate = true);
        constant Integer nX = nS annotation(Evaluate = true);
        constant Integer nXi = if fixedX then 0 else if reducedX then nS - 1 else nS annotation(Evaluate = true);
        final constant Integer nC = size(extraPropertiesNames, 1) annotation(Evaluate = true);
        replaceable record FluidConstants = Modelica.Media.Interfaces.Types.Basic.FluidConstants;

        replaceable record ThermodynamicState
          extends Modelica.Icons.Record;
        end ThermodynamicState;

        replaceable partial model BaseProperties
          InputAbsolutePressure p;
          InputMassFraction[nXi] Xi(start = reference_X[1:nXi]);
          InputSpecificEnthalpy h;
          Density d;
          Temperature T;
          MassFraction[nX] X(start = reference_X);
          SpecificInternalEnergy u;
          SpecificHeatCapacity R;
          MolarMass MM;
          ThermodynamicState state;
          parameter Boolean preferredMediumStates = false annotation(Evaluate = true);
          parameter Boolean standardOrderComponents = true;
          .Modelica.SIunits.Conversions.NonSIunits.Temperature_degC T_degC = Modelica.SIunits.Conversions.to_degC(T);
          .Modelica.SIunits.Conversions.NonSIunits.Pressure_bar p_bar = Modelica.SIunits.Conversions.to_bar(p);
          connector InputAbsolutePressure = input .Modelica.SIunits.AbsolutePressure;
          connector InputSpecificEnthalpy = input .Modelica.SIunits.SpecificEnthalpy;
          connector InputMassFraction = input .Modelica.SIunits.MassFraction;
        equation
          if standardOrderComponents then
            Xi = X[1:nXi];
            if fixedX then
              X = reference_X;
            end if;
            if reducedX and not fixedX then
              X[nX] = 1 - sum(Xi);
            end if;
            for i in 1:nX loop
              assert(X[i] >= (-1.e-5) and X[i] <= 1 + 1.e-5, "Mass fraction X[" + String(i) + "] = " + String(X[i]) + "of substance " + substanceNames[i] + "\nof medium " + mediumName + " is not in the range 0..1");
            end for;
          end if;
          assert(p >= 0.0, "Pressure (= " + String(p) + " Pa) of medium \"" + mediumName + "\" is negative\n(Temperature = " + String(T) + " K)");
        end BaseProperties;

        replaceable partial function setState_pTX
          extends Modelica.Icons.Function;
          input AbsolutePressure p;
          input Temperature T;
          input MassFraction[:] X = reference_X;
          output ThermodynamicState state;
        end setState_pTX;

        replaceable partial function setState_phX
          extends Modelica.Icons.Function;
          input AbsolutePressure p;
          input SpecificEnthalpy h;
          input MassFraction[:] X = reference_X;
          output ThermodynamicState state;
        end setState_phX;

        replaceable partial function setSmoothState
          extends Modelica.Icons.Function;
          input Real x;
          input ThermodynamicState state_a;
          input ThermodynamicState state_b;
          input Real x_small(min = 0);
          output ThermodynamicState state;
        end setSmoothState;

        replaceable partial function dynamicViscosity
          extends Modelica.Icons.Function;
          input ThermodynamicState state;
          output DynamicViscosity eta;
        end dynamicViscosity;

        replaceable partial function thermalConductivity
          extends Modelica.Icons.Function;
          input ThermodynamicState state;
          output ThermalConductivity lambda;
        end thermalConductivity;

        replaceable partial function pressure
          extends Modelica.Icons.Function;
          input ThermodynamicState state;
          output AbsolutePressure p;
        end pressure;

        replaceable partial function temperature
          extends Modelica.Icons.Function;
          input ThermodynamicState state;
          output Temperature T;
        end temperature;

        replaceable partial function density
          extends Modelica.Icons.Function;
          input ThermodynamicState state;
          output Density d;
        end density;

        replaceable partial function specificEnthalpy
          extends Modelica.Icons.Function;
          input ThermodynamicState state;
          output SpecificEnthalpy h;
        end specificEnthalpy;

        replaceable partial function specificInternalEnergy
          extends Modelica.Icons.Function;
          input ThermodynamicState state;
          output SpecificEnergy u;
        end specificInternalEnergy;

        replaceable partial function specificEntropy
          extends Modelica.Icons.Function;
          input ThermodynamicState state;
          output SpecificEntropy s;
        end specificEntropy;

        replaceable partial function specificGibbsEnergy
          extends Modelica.Icons.Function;
          input ThermodynamicState state;
          output SpecificEnergy g;
        end specificGibbsEnergy;

        replaceable partial function specificHelmholtzEnergy
          extends Modelica.Icons.Function;
          input ThermodynamicState state;
          output SpecificEnergy f;
        end specificHelmholtzEnergy;

        replaceable partial function specificHeatCapacityCp
          extends Modelica.Icons.Function;
          input ThermodynamicState state;
          output SpecificHeatCapacity cp;
        end specificHeatCapacityCp;

        replaceable partial function specificHeatCapacityCv
          extends Modelica.Icons.Function;
          input ThermodynamicState state;
          output SpecificHeatCapacity cv;
        end specificHeatCapacityCv;

        replaceable partial function isentropicExponent
          extends Modelica.Icons.Function;
          input ThermodynamicState state;
          output IsentropicExponent gamma;
        end isentropicExponent;

        replaceable partial function isentropicEnthalpy
          extends Modelica.Icons.Function;
          input AbsolutePressure p_downstream;
          input ThermodynamicState refState;
          output SpecificEnthalpy h_is;
        end isentropicEnthalpy;

        replaceable partial function velocityOfSound
          extends Modelica.Icons.Function;
          input ThermodynamicState state;
          output VelocityOfSound a;
        end velocityOfSound;

        replaceable partial function isobaricExpansionCoefficient
          extends Modelica.Icons.Function;
          input ThermodynamicState state;
          output IsobaricExpansionCoefficient beta;
        end isobaricExpansionCoefficient;

        replaceable partial function isothermalCompressibility
          extends Modelica.Icons.Function;
          input ThermodynamicState state;
          output .Modelica.SIunits.IsothermalCompressibility kappa;
        end isothermalCompressibility;

        replaceable partial function density_derp_T
          extends Modelica.Icons.Function;
          input ThermodynamicState state;
          output DerDensityByPressure ddpT;
        end density_derp_T;

        replaceable partial function density_derT_p
          extends Modelica.Icons.Function;
          input ThermodynamicState state;
          output DerDensityByTemperature ddTp;
        end density_derT_p;

        replaceable partial function density_derX
          extends Modelica.Icons.Function;
          input ThermodynamicState state;
          output Density[nX] dddX;
        end density_derX;

        replaceable partial function molarMass
          extends Modelica.Icons.Function;
          input ThermodynamicState state;
          output MolarMass MM;
        end molarMass;

        replaceable function specificEnthalpy_pTX
          extends Modelica.Icons.Function;
          input AbsolutePressure p;
          input Temperature T;
          input MassFraction[:] X = reference_X;
          output SpecificEnthalpy h;
        algorithm
          h := specificEnthalpy(setState_pTX(p, T, X));
        end specificEnthalpy_pTX;

        replaceable function temperature_phX
          extends Modelica.Icons.Function;
          input AbsolutePressure p;
          input SpecificEnthalpy h;
          input MassFraction[:] X = reference_X;
          output Temperature T;
        algorithm
          T := temperature(setState_phX(p, h, X));
        end temperature_phX;

        type MassFlowRate = .Modelica.SIunits.MassFlowRate(quantity = "MassFlowRate." + mediumName, min = -1.0e5, max = 1.e5);
      end PartialMedium;

      partial package PartialPureSubstance
        extends PartialMedium(final reducedX = true, final fixedX = true);

        redeclare replaceable partial model extends BaseProperties  end BaseProperties;
      end PartialPureSubstance;

      partial package PartialSimpleMedium
        extends Interfaces.PartialPureSubstance(final ThermoStates = Choices.IndependentVariables.pT, final singleState = true);
        constant SpecificHeatCapacity cp_const;
        constant SpecificHeatCapacity cv_const;
        constant Density d_const;
        constant DynamicViscosity eta_const;
        constant ThermalConductivity lambda_const;
        constant VelocityOfSound a_const;
        constant Temperature T_min;
        constant Temperature T_max;
        constant Temperature T0 = reference_T;
        constant MolarMass MM_const;
        constant FluidConstants[nS] fluidConstants;

        redeclare record extends ThermodynamicState
          AbsolutePressure p;
          Temperature T;
        end ThermodynamicState;

        redeclare replaceable model extends BaseProperties
        equation
          assert(T >= T_min and T <= T_max, "
          Temperature T (= " + String(T) + " K) is not
          in the allowed range (" + String(T_min) + " K <= T <= " + String(T_max) + " K)
          required from medium model \"" + mediumName + "\".
          ");
          h = specificEnthalpy_pTX(p, T, X);
          u = cv_const * (T - T0);
          d = d_const;
          R = 0;
          MM = MM_const;
          state.T = T;
          state.p = p;
        end BaseProperties;

        redeclare function setState_pTX
          extends Modelica.Icons.Function;
          input AbsolutePressure p;
          input Temperature T;
          input MassFraction[:] X = reference_X;
          output ThermodynamicState state;
        algorithm
          state := ThermodynamicState(p = p, T = T);
        end setState_pTX;

        redeclare function setState_phX
          extends Modelica.Icons.Function;
          input AbsolutePressure p;
          input SpecificEnthalpy h;
          input MassFraction[:] X = reference_X;
          output ThermodynamicState state;
        algorithm
          state := ThermodynamicState(p = p, T = T0 + h / cp_const);
        end setState_phX;

        redeclare function extends setSmoothState
        algorithm
          state := ThermodynamicState(p = Media.Common.smoothStep(x, state_a.p, state_b.p, x_small), T = Media.Common.smoothStep(x, state_a.T, state_b.T, x_small));
        end setSmoothState;

        redeclare function extends dynamicViscosity
        algorithm
          eta := eta_const;
        end dynamicViscosity;

        redeclare function extends thermalConductivity
        algorithm
          lambda := lambda_const;
        end thermalConductivity;

        redeclare function extends pressure
        algorithm
          p := state.p;
        end pressure;

        redeclare function extends temperature
        algorithm
          T := state.T;
        end temperature;

        redeclare function extends density
        algorithm
          d := d_const;
        end density;

        redeclare function extends specificEnthalpy
        algorithm
          h := cp_const * (state.T - T0);
        end specificEnthalpy;

        redeclare function extends specificHeatCapacityCp
        algorithm
          cp := cp_const;
        end specificHeatCapacityCp;

        redeclare function extends specificHeatCapacityCv
        algorithm
          cv := cv_const;
        end specificHeatCapacityCv;

        redeclare function extends isentropicExponent
        algorithm
          gamma := cp_const / cv_const;
        end isentropicExponent;

        redeclare function extends velocityOfSound
        algorithm
          a := a_const;
        end velocityOfSound;

        redeclare function specificEnthalpy_pTX
          extends Modelica.Icons.Function;
          input AbsolutePressure p;
          input Temperature T;
          input MassFraction[nX] X;
          output SpecificEnthalpy h;
        algorithm
          h := cp_const * (T - T0);
        end specificEnthalpy_pTX;

        redeclare function temperature_phX
          extends Modelica.Icons.Function;
          input AbsolutePressure p;
          input SpecificEnthalpy h;
          input MassFraction[nX] X;
          output Temperature T;
        algorithm
          T := T0 + h / cp_const;
        end temperature_phX;

        redeclare function extends specificInternalEnergy
          extends Modelica.Icons.Function;
        algorithm
          u := cv_const * (state.T - T0);
        end specificInternalEnergy;

        redeclare function extends specificEntropy
          extends Modelica.Icons.Function;
        algorithm
          s := cv_const * Modelica.Math.log(state.T / T0);
        end specificEntropy;

        redeclare function extends specificGibbsEnergy
          extends Modelica.Icons.Function;
        algorithm
          g := specificEnthalpy(state) - state.T * specificEntropy(state);
        end specificGibbsEnergy;

        redeclare function extends specificHelmholtzEnergy
          extends Modelica.Icons.Function;
        algorithm
          f := specificInternalEnergy(state) - state.T * specificEntropy(state);
        end specificHelmholtzEnergy;

        redeclare function extends isentropicEnthalpy
        algorithm
          h_is := cp_const * (temperature(refState) - T0);
        end isentropicEnthalpy;

        redeclare function extends isobaricExpansionCoefficient
        algorithm
          beta := 0.0;
        end isobaricExpansionCoefficient;

        redeclare function extends isothermalCompressibility
        algorithm
          kappa := 0;
        end isothermalCompressibility;

        redeclare function extends density_derp_T
        algorithm
          ddpT := 0;
        end density_derp_T;

        redeclare function extends density_derT_p
        algorithm
          ddTp := 0;
        end density_derT_p;

        redeclare function extends density_derX
        algorithm
          dddX := fill(0, nX);
        end density_derX;

        redeclare function extends molarMass
        algorithm
          MM := MM_const;
        end molarMass;
      end PartialSimpleMedium;

      package Choices
        extends Modelica.Icons.Package;
        type IndependentVariables = enumeration(T, pT, ph, phX, pTX, dTX);
      end Choices;

      package Types
        extends Modelica.Icons.Package;
        type AbsolutePressure = .Modelica.SIunits.AbsolutePressure(min = 0, max = 1.e8, nominal = 1.e5, start = 1.e5);
        type Density = .Modelica.SIunits.Density(min = 0, max = 1.e5, nominal = 1, start = 1);
        type DynamicViscosity = .Modelica.SIunits.DynamicViscosity(min = 0, max = 1.e8, nominal = 1.e-3, start = 1.e-3);
        type EnthalpyFlowRate = .Modelica.SIunits.EnthalpyFlowRate(nominal = 1000.0, min = -1.0e8, max = 1.e8);
        type MassFraction = Real(quantity = "MassFraction", final unit = "kg/kg", min = 0, max = 1, nominal = 0.1);
        type MolarMass = .Modelica.SIunits.MolarMass(min = 0.001, max = 0.25, nominal = 0.032);
        type MolarVolume = .Modelica.SIunits.MolarVolume(min = 1e-6, max = 1.0e6, nominal = 1.0);
        type IsentropicExponent = .Modelica.SIunits.RatioOfSpecificHeatCapacities(min = 1, max = 500000, nominal = 1.2, start = 1.2);
        type SpecificEnergy = .Modelica.SIunits.SpecificEnergy(min = -1.0e8, max = 1.e8, nominal = 1.e6);
        type SpecificInternalEnergy = SpecificEnergy;
        type SpecificEnthalpy = .Modelica.SIunits.SpecificEnthalpy(min = -1.0e10, max = 1.e10, nominal = 1.e6);
        type SpecificEntropy = .Modelica.SIunits.SpecificEntropy(min = -1.e7, max = 1.e7, nominal = 1.e3);
        type SpecificHeatCapacity = .Modelica.SIunits.SpecificHeatCapacity(min = 0, max = 1.e7, nominal = 1.e3, start = 1.e3);
        type Temperature = .Modelica.SIunits.Temperature(min = 1, max = 1.e4, nominal = 300, start = 300);
        type ThermalConductivity = .Modelica.SIunits.ThermalConductivity(min = 0, max = 500, nominal = 1, start = 1);
        type VelocityOfSound = .Modelica.SIunits.Velocity(min = 0, max = 1.e5, nominal = 1000, start = 1000);
        type ExtraProperty = Real(min = 0.0, start = 1.0);
        type ExtraPropertyFlowRate = Real(unit = "kg/s");
        type IsobaricExpansionCoefficient = Real(min = 0, max = 1.0e8, unit = "1/K");
        type DipoleMoment = Real(min = 0.0, max = 2.0, unit = "debye", quantity = "ElectricDipoleMoment");
        type DerDensityByPressure = .Modelica.SIunits.DerDensityByPressure;
        type DerDensityByTemperature = .Modelica.SIunits.DerDensityByTemperature;

        package Basic
          extends Icons.Package;

          record FluidConstants
            extends Modelica.Icons.Record;
            String iupacName;
            String casRegistryNumber;
            String chemicalFormula;
            String structureFormula;
            MolarMass molarMass;
          end FluidConstants;
        end Basic;

        package TwoPhase
          extends Icons.Package;

          record FluidConstants
            extends Modelica.Media.Interfaces.Types.Basic.FluidConstants;
            Temperature criticalTemperature;
            AbsolutePressure criticalPressure;
            MolarVolume criticalMolarVolume;
            Real acentricFactor;
            Temperature triplePointTemperature;
            AbsolutePressure triplePointPressure;
            Temperature meltingPoint;
            Temperature normalBoilingPoint;
            DipoleMoment dipoleMoment;
            Boolean hasIdealGasHeatCapacity = false;
            Boolean hasCriticalData = false;
            Boolean hasDipoleMoment = false;
            Boolean hasFundamentalEquation = false;
            Boolean hasLiquidHeatCapacity = false;
            Boolean hasSolidHeatCapacity = false;
            Boolean hasAccurateViscosityData = false;
            Boolean hasAccurateConductivityData = false;
            Boolean hasVapourPressureCurve = false;
            Boolean hasAcentricFactor = false;
            SpecificEnthalpy HCRIT0 = 0.0;
            SpecificEntropy SCRIT0 = 0.0;
            SpecificEnthalpy deltah = 0.0;
            SpecificEntropy deltas = 0.0;
          end FluidConstants;
        end TwoPhase;
      end Types;
    end Interfaces;

    package Common
      extends Modelica.Icons.Package;
      constant Real MINPOS = 1.0e-9;

      function smoothStep
        extends Modelica.Icons.Function;
        input Real x;
        input Real y1;
        input Real y2;
        input Real x_small(min = 0) = 1e-5;
        output Real y;
      algorithm
        y := smooth(1, if x > x_small then y1 else if x < (-x_small) then y2 else if abs(x_small) > 0 then x / x_small * ((x / x_small) ^ 2 - 3) * (y2 - y1) / 4 + (y1 + y2) / 2 else (y1 + y2) / 2);
      end smoothStep;
    end Common;

    package Water
      extends Modelica.Icons.VariantsPackage;

      package ConstantPropertyLiquidWater
        constant Modelica.Media.Interfaces.Types.Basic.FluidConstants[1] simpleWaterConstants(each chemicalFormula = "H2O", each structureFormula = "H2O", each casRegistryNumber = "7732-18-5", each iupacName = "oxidane", each molarMass = 0.018015268);
        extends Interfaces.PartialSimpleMedium(mediumName = "SimpleLiquidWater", cp_const = 4184, cv_const = 4184, d_const = 995.586, eta_const = 1.e-3, lambda_const = 0.598, a_const = 1484, T_min = .Modelica.SIunits.Conversions.from_degC(-1), T_max = .Modelica.SIunits.Conversions.from_degC(130), T0 = 273.15, MM_const = 0.018015268, fluidConstants = simpleWaterConstants);
      end ConstantPropertyLiquidWater;
    end Water;
  end Media;

  package Thermal
    extends Modelica.Icons.Package;

    package HeatTransfer
      extends Modelica.Icons.Package;

      package Components
        extends Modelica.Icons.Package;

        model HeatCapacitor
          parameter Modelica.SIunits.HeatCapacity C;
          Modelica.SIunits.Temperature T(start = 293.15, displayUnit = "degC");
          Modelica.SIunits.TemperatureSlope der_T(start = 0);
          Interfaces.HeatPort_a port;
        equation
          T = port.T;
          der_T = der(T);
          C * der(T) = port.Q_flow;
        end HeatCapacitor;

        model ThermalResistor
          extends Interfaces.Element1D;
          parameter Modelica.SIunits.ThermalResistance R;
        equation
          dT = R * Q_flow;
        end ThermalResistor;

        model ConvectiveResistor
          Modelica.SIunits.HeatFlowRate Q_flow;
          Modelica.SIunits.TemperatureDifference dT;
          Modelica.Blocks.Interfaces.RealInput Rc(unit = "K/W");
          Interfaces.HeatPort_a solid;
          Interfaces.HeatPort_b fluid;
        equation
          dT = solid.T - fluid.T;
          solid.Q_flow = Q_flow;
          fluid.Q_flow = -Q_flow;
          dT = Rc * Q_flow;
        end ConvectiveResistor;
      end Components;

      package Sensors
        extends Modelica.Icons.SensorsPackage;

        model HeatFlowSensor
          extends Modelica.Icons.RotationalSensor;
          Modelica.Blocks.Interfaces.RealOutput Q_flow(unit = "W");
          Interfaces.HeatPort_a port_a;
          Interfaces.HeatPort_b port_b;
        equation
          port_a.T = port_b.T;
          port_a.Q_flow + port_b.Q_flow = 0;
          Q_flow = port_a.Q_flow;
        end HeatFlowSensor;
      end Sensors;

      package Interfaces
        extends Modelica.Icons.InterfacesPackage;

        partial connector HeatPort
          Modelica.SIunits.Temperature T;
          flow Modelica.SIunits.HeatFlowRate Q_flow;
        end HeatPort;

        connector HeatPort_a
          extends HeatPort;
        end HeatPort_a;

        connector HeatPort_b
          extends HeatPort;
        end HeatPort_b;

        partial model Element1D
          Modelica.SIunits.HeatFlowRate Q_flow;
          Modelica.SIunits.TemperatureDifference dT;
          HeatPort_a port_a;
          HeatPort_b port_b;
        equation
          dT = port_a.T - port_b.T;
          port_a.Q_flow = Q_flow;
          port_b.Q_flow = -Q_flow;
        end Element1D;
      end Interfaces;
    end HeatTransfer;
  end Thermal;

  package Math
    extends Modelica.Icons.Package;

    package Icons
      extends Modelica.Icons.IconsPackage;

      partial function AxisLeft  end AxisLeft;

      partial function AxisCenter  end AxisCenter;
    end Icons;

    function cos
      extends Modelica.Math.Icons.AxisLeft;
      input .Modelica.SIunits.Angle u;
      output Real y;
      external "builtin" y = cos(u);
    end cos;

    function tan
      extends Modelica.Math.Icons.AxisCenter;
      input .Modelica.SIunits.Angle u;
      output Real y;
      external "builtin" y = tan(u);
    end tan;

    function asin
      extends Modelica.Math.Icons.AxisCenter;
      input Real u;
      output .Modelica.SIunits.Angle y;
      external "builtin" y = asin(u);
    end asin;

    function cosh
      extends Modelica.Math.Icons.AxisCenter;
      input Real u;
      output Real y;
      external "builtin" y = cosh(u);
    end cosh;

    function tanh
      extends Modelica.Math.Icons.AxisCenter;
      input Real u;
      output Real y;
      external "builtin" y = tanh(u);
    end tanh;

    function exp
      extends Modelica.Math.Icons.AxisCenter;
      input Real u;
      output Real y;
      external "builtin" y = exp(u);
    end exp;

    function log
      extends Modelica.Math.Icons.AxisLeft;
      input Real u;
      output Real y;
      external "builtin" y = log(u);
    end log;
  end Math;

  package Utilities
    extends Modelica.Icons.Package;

    package Streams
      extends Modelica.Icons.Package;

      function print
        extends Modelica.Icons.Function;
        input String string = "";
        input String fileName = "";
        external "C" ModelicaInternal_print(string, fileName) annotation(Library = "ModelicaExternalC");
      end print;

      function error
        extends Modelica.Icons.Function;
        input String string;
        external "C" ModelicaError(string) annotation(Library = "ModelicaExternalC");
      end error;
    end Streams;

    package Strings
      extends Modelica.Icons.Package;

      function compare
        extends Modelica.Icons.Function;
        input String string1;
        input String string2;
        input Boolean caseSensitive = true;
        output Modelica.Utilities.Types.Compare result;
        external "C" result = ModelicaStrings_compare(string1, string2, caseSensitive) annotation(Library = "ModelicaExternalC");
      end compare;

      function isEqual
        extends Modelica.Icons.Function;
        input String string1;
        input String string2;
        input Boolean caseSensitive = true;
        output Boolean identical;
      algorithm
        identical := compare(string1, string2, caseSensitive) == Types.Compare.Equal;
      end isEqual;
    end Strings;

    package Types
      extends Modelica.Icons.TypesPackage;
      type Compare = enumeration(Less, Equal, Greater);
    end Types;
  end Utilities;

  package Constants
    extends Modelica.Icons.Package;
    final constant Real pi = 2 * Math.asin(1.0);
    final constant Real eps = ModelicaServices.Machine.eps;
    final constant Real inf = ModelicaServices.Machine.inf;
    final constant .Modelica.SIunits.Velocity c = 299792458;
    final constant .Modelica.SIunits.Acceleration g_n = 9.80665;
    final constant Real mue_0(final unit = "N/A2") = 4 * pi * 1.e-7;
    final constant .Modelica.SIunits.Conversions.NonSIunits.Temperature_degC T_zero = -273.15;
  end Constants;

  package Icons
    extends Icons.Package;

    partial package ExamplesPackage
      extends Modelica.Icons.Package;
    end ExamplesPackage;

    partial model Example  end Example;

    partial package Package  end Package;

    partial package BasesPackage
      extends Modelica.Icons.Package;
    end BasesPackage;

    partial package VariantsPackage
      extends Modelica.Icons.Package;
    end VariantsPackage;

    partial package InterfacesPackage
      extends Modelica.Icons.Package;
    end InterfacesPackage;

    partial package SourcesPackage
      extends Modelica.Icons.Package;
    end SourcesPackage;

    partial package SensorsPackage
      extends Modelica.Icons.Package;
    end SensorsPackage;

    partial package UtilitiesPackage
      extends Modelica.Icons.Package;
    end UtilitiesPackage;

    partial package TypesPackage
      extends Modelica.Icons.Package;
    end TypesPackage;

    partial package IconsPackage
      extends Modelica.Icons.Package;
    end IconsPackage;

    partial package MaterialPropertiesPackage
      extends Modelica.Icons.Package;
    end MaterialPropertiesPackage;

    partial class RotationalSensor  end RotationalSensor;

    partial function Function  end Function;

    partial record Record  end Record;
  end Icons;

  package SIunits
    extends Modelica.Icons.Package;

    package Icons
      extends Modelica.Icons.IconsPackage;

      partial function Conversion  end Conversion;
    end Icons;

    package Conversions
      extends Modelica.Icons.Package;

      package NonSIunits
        extends Modelica.Icons.Package;
        type Temperature_degC = Real(final quantity = "ThermodynamicTemperature", final unit = "degC");
        type Pressure_bar = Real(final quantity = "Pressure", final unit = "bar");
      end NonSIunits;

      function to_degC
        extends Modelica.SIunits.Icons.Conversion;
        input Temperature Kelvin;
        output NonSIunits.Temperature_degC Celsius;
      algorithm
        Celsius := Kelvin + Modelica.Constants.T_zero;
      end to_degC;

      function from_degC
        extends Modelica.SIunits.Icons.Conversion;
        input NonSIunits.Temperature_degC Celsius;
        output Temperature Kelvin;
      algorithm
        Kelvin := Celsius - Modelica.Constants.T_zero;
      end from_degC;

      function to_bar
        extends Modelica.SIunits.Icons.Conversion;
        input Pressure Pa;
        output NonSIunits.Pressure_bar bar;
      algorithm
        bar := Pa / 1e5;
      end to_bar;
    end Conversions;

    type Angle = Real(final quantity = "Angle", final unit = "rad", displayUnit = "deg");
    type Length = Real(final quantity = "Length", final unit = "m");
    type Height = Length(min = 0);
    type Radius = Length(min = 0);
    type Area = Real(final quantity = "Area", final unit = "m2");
    type Volume = Real(final quantity = "Volume", final unit = "m3");
    type Time = Real(final quantity = "Time", final unit = "s");
    type Velocity = Real(final quantity = "Velocity", final unit = "m/s");
    type Acceleration = Real(final quantity = "Acceleration", final unit = "m/s2");
    type Mass = Real(quantity = "Mass", final unit = "kg", min = 0);
    type Density = Real(final quantity = "Density", final unit = "kg/m3", displayUnit = "g/cm3", min = 0.0);
    type Pressure = Real(final quantity = "Pressure", final unit = "Pa", displayUnit = "bar");
    type AbsolutePressure = Pressure(min = 0.0, nominal = 1e5);
    type DynamicViscosity = Real(final quantity = "DynamicViscosity", final unit = "Pa.s", min = 0);
    type Energy = Real(final quantity = "Energy", final unit = "J");
    type Power = Real(final quantity = "Power", final unit = "W");
    type EnthalpyFlowRate = Real(final quantity = "EnthalpyFlowRate", final unit = "W");
    type MassFlowRate = Real(quantity = "MassFlowRate", final unit = "kg/s");
    type MomentumFlux = Real(final quantity = "MomentumFlux", final unit = "N");
    type ThermodynamicTemperature = Real(final quantity = "ThermodynamicTemperature", final unit = "K", min = 0.0, start = 288.15, nominal = 300, displayUnit = "degC");
    type Temperature = ThermodynamicTemperature;
    type TemperatureDifference = Real(final quantity = "ThermodynamicTemperature", final unit = "K");
    type TemperatureSlope = Real(final quantity = "TemperatureSlope", final unit = "K/s");
    type Compressibility = Real(final quantity = "Compressibility", final unit = "1/Pa");
    type IsothermalCompressibility = Compressibility;
    type HeatFlowRate = Real(final quantity = "Power", final unit = "W");
    type ThermalConductivity = Real(final quantity = "ThermalConductivity", final unit = "W/(m.K)");
    type CoefficientOfHeatTransfer = Real(final quantity = "CoefficientOfHeatTransfer", final unit = "W/(m2.K)");
    type ThermalResistance = Real(final quantity = "ThermalResistance", final unit = "K/W");
    type ThermalConductance = Real(final quantity = "ThermalConductance", final unit = "W/K");
    type HeatCapacity = Real(final quantity = "HeatCapacity", final unit = "J/K");
    type SpecificHeatCapacity = Real(final quantity = "SpecificHeatCapacity", final unit = "J/(kg.K)");
    type RatioOfSpecificHeatCapacities = Real(final quantity = "RatioOfSpecificHeatCapacities", final unit = "1");
    type Entropy = Real(final quantity = "Entropy", final unit = "J/K");
    type SpecificEntropy = Real(final quantity = "SpecificEntropy", final unit = "J/(kg.K)");
    type SpecificEnergy = Real(final quantity = "SpecificEnergy", final unit = "J/kg");
    type SpecificEnthalpy = SpecificEnergy;
    type DerDensityByPressure = Real(final unit = "s2/m2");
    type DerDensityByTemperature = Real(final unit = "kg/(m3.K)");
    type AmountOfSubstance = Real(final quantity = "AmountOfSubstance", final unit = "mol", min = 0);
    type MolarMass = Real(final quantity = "MolarMass", final unit = "kg/mol", min = 0);
    type MolarVolume = Real(final quantity = "MolarVolume", final unit = "m3/mol", min = 0);
    type MassFraction = Real(final quantity = "MassFraction", final unit = "1", min = 0, max = 1);
    type MoleFraction = Real(final quantity = "MoleFraction", final unit = "1", min = 0, max = 1);
    type FaradayConstant = Real(final quantity = "FaradayConstant", final unit = "C/mol");
  end SIunits;
end Modelica;

model BoreholeSegment
  extends Buildings.Fluid.HeatExchangers.Boreholes.BaseClasses.Examples.BoreholeSegment;
  annotation(experiment(StopTime = 157680000), __Dymola_Commands(file = "modelica://Buildings/Resources/Scripts/Dymola/Fluid/HeatExchangers/Boreholes/BaseClasses/Examples/BoreholeSegment.mos"));
end BoreholeSegment;

// Result:
// Error processing file: AttributesPropagation.mo
// Error: Failed to load package AttributesPropagation (default) using MODELICAPATH /home/omar/.openmodelica/libraries/.
// Error: Class AttributesPropagation.mo not found in scope <top>.
// Error: Error occurred while flattening model AttributesPropagation.mo
//
// # Error encountered! Exiting...
// # Please check the error message and the flags.
//
// Execution failed!
// endResult
