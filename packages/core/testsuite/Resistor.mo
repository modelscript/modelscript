
    partial model ConditionalHeatPort
      parameter Boolean useHeatPort = false;
    end ConditionalHeatPort;

    model Resistor
      extends ConditionalHeatPort;
      Modelica.Electrical.Analog.Interfaces.Pin p;
      Modelica.Electrical.Analog.Interfaces.Pin n;
      Modelica.Thermal.HeatTransfer.Interfaces.HeatPort_a heatPort if useHeatPort;
    end Resistor;
  