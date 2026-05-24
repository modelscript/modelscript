model Resistor "Ideal linear electrical resistor"
  extends Modelica.Electrical.Analog.Interfaces.OnePort;
  parameter Modelica.Units.SI.Resistance R(start=1) "Resistance";
equation
  v = R * i;
  annotation (
    Icon(coordinateSystem(preserveAspectRatio=true, extent={{-100,-100},{100,100}}), graphics={
        Rectangle(extent={{-70,30},{70,-30}}, lineColor={0,0,255}, fillColor={255,255,255}, fillPattern=FillPattern.Solid),
        Line(points={{-100,0},{-70,0}}, color={0,0,255}),
        Line(points={{70,0},{100,0}}, color={0,0,255}),
        Text(extent={{-150,55},{150,95}}, textString="%name", lineColor={0,0,255}),
        Text(extent={{-150,-90},{150,-50}}, textString="R=%R")
    }),
    Diagram(coordinateSystem(preserveAspectRatio=true, extent={{-100,-100},{100,100}}), graphics={
        Rectangle(extent={{-70,30},{70,-30}}, lineColor={0,0,255}, fillColor={255,255,255}, fillPattern=FillPattern.Solid),
        Line(points={{-100,0},{-70,0}}, color={0,0,255}),
        Line(points={{70,0},{100,0}}, color={0,0,255}),
        Text(extent={{-150,55},{150,95}}, textString="%name", lineColor={0,0,255}),
        Text(extent={{-150,-90},{150,-50}}, textString="R=%R")
    })
  );
end Resistor;

model SimpleCircuit
  Modelica.Electrical.Analog.Basic.Ground g annotation(Placement(transformation(extent={{-10,-30},{10,-10}})));
  Resistor r1(R=10) annotation(Placement(transformation(extent={{-10,10},{10,30}})));
  Modelica.Electrical.Analog.Sources.SineVoltage v(V=5, freqHz=60) annotation(Placement(transformation(extent={{-50,-10},{-30,10}})));
equation
  connect(v.p, r1.p) annotation(Line(points={{-30,0},{-30,20},{-10,20}}, color={0,0,255}));
  connect(r1.n, g.p) annotation(Line(points={{10,20},{30,20},{30,-20},{0,-20}}, color={0,0,255}));
  connect(v.n, g.p) annotation(Line(points={{-50,0},{-50,-20},{0,-20}}, color={0,0,255}));
  annotation(
    Diagram(coordinateSystem(preserveAspectRatio=true, extent={{-100,-100},{100,100}}))
  );
end SimpleCircuit;
