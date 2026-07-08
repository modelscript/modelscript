package ComplexModels
  "Advanced examples using records, partials, and replaceable components"

  record FluidProperties
    parameter Real density = 1000 "kg/m3";
    parameter Real viscosity = 0.001 "Pa.s";
  end FluidProperties;

  partial model BasePipe
    parameter Real length = 1.0;
    parameter Real diameter = 0.1;
    parameter FluidProperties fluid;
    Real flowRate;
    Real pressureDrop;
  end BasePipe;

  model LaminarPipe
    extends BasePipe;
  equation
    // Hagen-Poiseuille equation for laminar flow
    pressureDrop = (128 * fluid.viscosity * length * flowRate) / (3.14159 * diameter^4);
  end LaminarPipe;

  model System
    parameter FluidProperties water(density=998.2, viscosity=0.001002);
    LaminarPipe pipe(length=5.0, diameter=0.05, fluid=water);
  equation
    pipe.flowRate = 0.01; // 10 L/s
  end System;

end ComplexModels;
