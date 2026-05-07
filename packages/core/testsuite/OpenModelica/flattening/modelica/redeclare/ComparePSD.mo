// name:     ComparePSD.mo [BUG: #2739]
// keywords: redeclare function
// status:   correct
//
// Checks that it's possible to uniquely modify packages in different components having the same type
//
//

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
      connector RealOutput = output Real;

      partial block SO
        extends Modelica.Blocks.Icons.Block;
        RealOutput y;
      end SO;
    end Interfaces;

    package Icons
      extends Modelica.Icons.IconsPackage;

      partial block Block  end Block;
    end Icons;
  end Blocks;

  package Math
    extends Modelica.Icons.Package;

    package Icons
      extends Modelica.Icons.IconsPackage;

      partial function AxisCenter  end AxisCenter;
    end Icons;

    function asin
      extends Modelica.Math.Icons.AxisCenter;
      input Real u;
      output .Modelica.SIunits.Angle y;
      external "builtin" y = asin(u);
    end asin;

    function exp
      extends Modelica.Math.Icons.AxisCenter;
      input Real u;
      output Real y;
      external "builtin" y = exp(u);
    end exp;
  end Math;

  package Constants
    extends Modelica.Icons.Package;
    final constant Real pi = 2 * Math.asin(1.0);
    final constant .Modelica.SIunits.Velocity c = 299792458;
    final constant Real mue_0(final unit = "N/A2") = 4 * pi * 1.e-7;
  end Constants;

  package Icons
    extends Icons.Package;

    partial package ExamplesPackage
      extends Modelica.Icons.Package;
    end ExamplesPackage;

    partial model Example  end Example;

    partial package Package  end Package;

    partial package InterfacesPackage
      extends Modelica.Icons.Package;
    end InterfacesPackage;

    partial package UtilitiesPackage
      extends Modelica.Icons.Package;
    end UtilitiesPackage;

    partial package IconsPackage
      extends Modelica.Icons.Package;
    end IconsPackage;
  end Icons;

  package SIunits
    extends Modelica.Icons.Package;

    package Conversions
      extends Modelica.Icons.Package;

      package NonSIunits
        extends Modelica.Icons.Package;
        type Temperature_degC = Real(final quantity = "ThermodynamicTemperature", final unit = "degC");
      end NonSIunits;
    end Conversions;

    type Angle = Real(final quantity = "Angle", final unit = "rad", displayUnit = "deg");
    type Time = Real(final quantity = "Time", final unit = "s");
    type Velocity = Real(final quantity = "Velocity", final unit = "m/s");
    type Acceleration = Real(final quantity = "Acceleration", final unit = "m/s2");
    type Period = Real(final quantity = "Time", final unit = "s");
    type Frequency = Real(final quantity = "Frequency", final unit = "Hz");
    type FaradayConstant = Real(final quantity = "FaradayConstant", final unit = "C/mol");
  end SIunits;
end Modelica;

package Noise
  extends Modelica.Icons.Package;

  model GlobalSeed
    parameter Integer userSeed = 1;
    final parameter Integer seed = userSeed;
  end GlobalSeed;

  block PRNG
    extends Modelica.Blocks.Interfaces.SO;
    outer GlobalSeed globalSeed;
    parameter Boolean useSampleBasedMethods = false;
    replaceable function SampleBasedRNG = Noise.RNG.SampleBased.RNG_LCG constrainedby Noise.Utilities.Interfaces.SampleBasedRNG;
    replaceable function SampleFreeRNG = Noise.RNG.SampleFree.RNG_DIRCS constrainedby Noise.Utilities.Interfaces.SampleFreeRNG;
  protected
    function SampleBasedRNG0 = SampleBasedRNG;
    function SampleFreeRNG0 = SampleFreeRNG;
  public
    replaceable function PDF = Noise.PDF.PDF_Uniform constrainedby Noise.Utilities.Interfaces.PDF;
  protected
    function SampleBasedPDF0 = PDF(redeclare function RNG = SampleBasedRNG0);
    function SampleFreePDF0 = PDF(redeclare function RNG = SampleFreeRNG0);
  public
    parameter Boolean infiniteFreq = false;
  protected
    parameter Modelica.SIunits.Frequency freq = 0.5 * 1 / samplePeriod;
  public
    replaceable function PSD = Noise.PSD.PSD_WhiteNoise constrainedby Noise.Utilities.Interfaces.PSD;
  protected
    function SampleBasedPSD0 = PSD(redeclare function PDF = SampleBasedPDF0);
    function SampleFreePSD0 = PSD(redeclare function PDF = SampleFreePDF0);
    function InfiniteFreqPSD0 = Noise.PSD.PSD_WhiteNoise(redeclare function PDF = SampleFreePDF0);
  public
    parameter Modelica.SIunits.Time startTime = 0;
    parameter Modelica.SIunits.Time samplePeriod = 0.01;
    parameter Boolean enable = true;
    parameter Real y_off = 0;
    replaceable function Seed = Noise.Seed.Seed_MRG(real_seed = 0.0) constrainedby Noise.Utilities.Interfaces.Seed;
  protected
    parameter Integer state_size = 33;
    Integer[state_size] state;
    Real t_last;
  public
    parameter Integer localSeed = 123456789;
    parameter Boolean useGlobalSeed = true;
    final parameter Integer seed = if useGlobalSeed then Utilities.Auxiliary.combineSeedLCG(localSeed, globalSeed.seed) else localSeed;
    final parameter Real DT = 1 / (2 * freq);
    output Real y_hold;
  protected
    discrete Real dummy1;
    discrete Real dummy2;
  initial equation
    if useSampleBasedMethods then
      pre(state) = Seed(local_seed = localSeed, global_seed = if useGlobalSeed then globalSeed.seed else 0, n = state_size, real_seed = 0.0);
      pre(t_last) = floor(time / DT) * DT;
    end if;
  equation
    if not enable then
      y = y_off;
      y_hold = y_off;
      t_last = 0;
      dummy1 = 0;
      dummy2 = 0;
      state = zeros(state_size);
    else
      if useSampleBasedMethods then
        when sample(0, DT) then
          t_last = time;
          (dummy1, dummy2, state) = SampleBasedPSD0(t = time, dt = DT, t_last = pre(t_last), states_in = pre(state));
        end when;
        (y_hold, y) = SampleBasedPSD0(t = time, dt = DT, t_last = t_last, states_in = state);
      else
        when initial() then
          dummy1 = 0;
          dummy2 = 0;
        end when;
        state = Seed(local_seed = localSeed, global_seed = if useGlobalSeed then globalSeed.seed else 0, n = state_size, real_seed = 0.0);
        t_last = noEvent(2 * abs(time) + 1);
        if infiniteFreq then
          (y_hold, y) = InfiniteFreqPSD0(t = time, dt = 0, t_last = t_last, states_in = state);
        else
          (y_hold, y) = SampleFreePSD0(t = time, dt = DT, t_last = t_last, states_in = state);
        end if;
      end if;
    end if;
  end PRNG;

  package RNG
    extends Modelica.Icons.Package;

    package SampleBased
      extends Modelica.Icons.Package;

      function RNG_MRG
        extends Noise.Utilities.Interfaces.SampleBasedRNG;
        input Integer[:] a = {1071064, 0, 0, 0, 0, 0, 2113664};
        input Integer c = 0;
        input Integer m = 1073741823;
      algorithm
        assert(size(states_in, 1) >= size(a, 1), "State must have at least as many elements as a!");
        states_out := states_in;
        states_out[1] := 0;
        for i in 1:size(a, 1) loop
          states_out[1] := states_out[1] + a[i] * states_in[i];
        end for;
        states_out[1] := integer(mod(states_out[1] + c, m));
        for i in 1:size(a, 1) - 1 loop
          states_out[i + 1] := states_in[i];
        end for;
        rand := abs(states_out[1] / (m - 1));
      end RNG_MRG;

      function RNG_LCG
        extends Noise.Utilities.Interfaces.SampleBasedRNG;
        input Integer a = 69069;
        input Integer c = 1;
        input Integer m = 1073741823;
      algorithm
        (rand, states_out) := RNG_MRG(instance, states_in, a = {a}, c = c, m = m);
      end RNG_LCG;
    end SampleBased;

    package SampleFree
      extends Modelica.Icons.Package;

      function RNG_DIRCS
        extends Noise.Utilities.Interfaces.SampleFreeRNG;
        replaceable function Seed = Noise.Seed.Seed_Real constrainedby Noise.Utilities.Interfaces.Seed;
        replaceable function RNG = Noise.RNG.SampleBased.RNG_MRG(a = {134775813, 134775813}, c = 1) constrainedby Noise.Utilities.Interfaces.RNG;
        input Integer k = 1;
      protected
        Integer[2] states_internal;
      algorithm
        states_internal := Seed(real_seed = instance, local_seed = states_in[1], global_seed = 0, n = 2);
        for i in 1:k loop
          (rand, states_internal) := RNG(instance = instance, states_in = states_internal);
        end for;
        states_out := states_in;
      end RNG_DIRCS;
    end SampleFree;
  end RNG;

  package PDF
    extends Noise.Utilities.Icons.PDFPackage;

    function PDF_Uniform
      extends Noise.Utilities.Interfaces.PDF;
      input Real[2] interval = {0, 1};
    algorithm
      (rand, states_out) := RNG(instance = instance, states_in = states_in);
      rand := rand * (interval[2] - interval[1]) + interval[1];
    end PDF_Uniform;
  end PDF;

  package PSD
    extends Noise.Utilities.Icons.PSDPackage;

    function PSD_WhiteNoise
      extends Noise.Utilities.Interfaces.PSD;
    algorithm
      if dt > 0 then
        (rand, states_out) := PDF(instance = floor(t / dt) * dt, states_in = states_in);
      else
        (rand, states_out) := PDF(instance = t, states_in = states_in);
      end if;
      rand_hold := rand;
    end PSD_WhiteNoise;

    function PSD_IdealLowPass
      extends PSD_Interpolation(redeclare function Kernel = Kernels.IdealLowPass);
    end PSD_IdealLowPass;

    function PSD_LinearInterpolation
      extends PSD_Interpolation(redeclare function Kernel = Kernels.Linear, n = 1);
    end PSD_LinearInterpolation;

    function PSD_Interpolation
      extends Noise.Utilities.Interfaces.PSD;
      replaceable function Kernel = Noise.PSD.Kernels.IdealLowPass constrainedby Utilities.Interfaces.Kernel;
      input Integer n = 5;
      input Integer max_n = n;
    protected
      Real raw;
      Real coefficient;
      Real scaling;
      Integer[size(states_in, 1)] states_temp;
    algorithm
      rand := 0;
      scaling := 0;
      states_temp := states_in;
      for i in (-max_n):(-n) loop
        (raw, states_temp) := PDF(instance = (floor(t / dt) + i) * dt, states_in = states_temp);
      end for;
      for i in (-n) + 1:n loop
        (raw, states_temp) := PDF(states_in = states_temp, instance = floor(t / dt + i) * dt);
        coefficient := if t_last <= t then Kernel(t = t - (t_last + i * dt), dt = dt) else Kernel(t = t - floor(t / dt + i) * dt, dt = dt);
        rand := rand + raw * coefficient;
        scaling := scaling + coefficient;
        if i == 0 then
          rand_hold := raw;
        else
        end if;
      end for;
      rand := rand / scaling;
      (raw, states_out) := PDF(states_in = states_in, instance = floor(t / dt) * dt);
    end PSD_Interpolation;

    package Kernels
      extends Modelica.Icons.Package;

      function IdealLowPass
        extends Noise.Utilities.Interfaces.Kernel;
        input Modelica.SIunits.Frequency B = 1 / 2 / dt;
      algorithm
        h := 2 * B * .Noise.Utilities.Math.sinc(2 * .Modelica.Constants.pi * B * t);
      end IdealLowPass;

      function Linear
        extends Noise.Utilities.Interfaces.Kernel;
      algorithm
        h := if t < (-dt) then 0 else if t < 0 then 1 + t / dt else if t < dt then 1 - t / dt else 0;
      end Linear;
    end Kernels;
  end PSD;

  package Seed
    extends Noise.Utilities.Icons.SeedPackage;

    function Seed_MRG
      extends Utilities.Interfaces.Seed;
      input Integer[:] a = fill(134775813, n);
      input Integer c = 1;
      input Integer m = 1073741823;
      input Integer k = n;
    protected
      Real dummy;
      Integer[max(n, 2)] internal_states;
    algorithm
      assert(n > 0, "You are seeding a state vector of size 0!");
      internal_states := cat(1, {local_seed, global_seed}, fill(0, max(n, 2) - 2));
      for i in 1:k loop
        (dummy, internal_states) := RNG.SampleBased.RNG_MRG(instance = real_seed, states_in = internal_states, a = a, c = c, m = m);
      end for;
      for i in 1:n loop
        states[i] := internal_states[i];
      end for;
    end Seed_MRG;

    function Seed_Real
      extends Utilities.Interfaces.Seed;
    algorithm
      states := Noise.Utilities.Auxiliary.SeedReal(local_seed = local_seed, global_seed = global_seed, real_seed = real_seed, n = n);
    end Seed_Real;
  end Seed;

  package Utilities
    extends Modelica.Icons.Package;
    extends Modelica.Icons.UtilitiesPackage;

    package Icons
      extends Modelica.Icons.IconsPackage;

      partial function PDF  end PDF;

      partial package PDFPackage
        extends Modelica.Icons.Package;
      end PDFPackage;

      partial function PSD  end PSD;

      partial package PSDPackage
        extends Modelica.Icons.Package;
      end PSDPackage;

      partial function Seed  end Seed;

      partial package SeedPackage
        extends Modelica.Icons.Package;
      end SeedPackage;
    end Icons;

    package Interfaces
      extends Modelica.Icons.InterfacesPackage;

      partial function InputOutput
        input Modelica.SIunits.Time instance;
        input Integer[:] states_in;
        output Real rand;
        output Integer[size(states_in, 1)] states_out;
      end InputOutput;

      partial function RNG
        extends Interfaces.InputOutput;
      end RNG;

      partial function SampleBasedRNG
        extends Interfaces.RNG;
      end SampleBasedRNG;

      partial function SampleFreeRNG
        extends Interfaces.RNG;
      end SampleFreeRNG;

      partial function PDF
        extends Icons.PDF;
        extends Interfaces.InputOutput;
        replaceable function RNG = Noise.RNG.SampleBased.RNG_LCG constrainedby Interfaces.RNG;
      end PDF;

      partial function PSD
        extends Icons.PSD;
        output Real rand_hold;
        extends Interfaces.InputOutput(instance = t);
        input Modelica.SIunits.Time t;
        input Modelica.SIunits.Period dt;
        input Modelica.SIunits.Time t_last;
        replaceable function PDF = Noise.PDF.PDF_Uniform constrainedby Interfaces.PDF;
      end PSD;

      partial function Kernel
        input Real t;
        input Real dt;
        output Real h;
      end Kernel;

      partial function Seed
        extends Icons.Seed;
        input Integer local_seed = 12345;
        input Integer global_seed = 67890;
        input Real real_seed = 1.234;
        input Integer n = 33;
        output Integer[n] states;
      end Seed;

      partial function combineSeed
        input Integer seed1;
        input Integer seed2;
        output Integer newSeed;
      end combineSeed;
    end Interfaces;

    package Auxiliary
      extends Modelica.Icons.Package;

      function SeedReal
        input Integer local_seed;
        input Integer global_seed;
        input Real real_seed;
        input Integer n;
        output Integer[n] states;
        external "C" NOISE_SeedReal(local_seed, global_seed, real_seed, n, states);
      end SeedReal;

      function combineSeedLCG
        extends Interfaces.combineSeed;
        external "C" newSeed = NOISE_combineSeedLCG(seed1, seed2);
      end combineSeedLCG;
    end Auxiliary;

    package Math
      extends Modelica.Icons.Package;

      function sinc
        input Real x;
        output Real y;
      algorithm
        y := if abs(x) > 0.5e-4 then sin(x) / x else 1 - x ^ 2 / 6 + x ^ 4 / 120;
      end sinc;
    end Math;
  end Utilities;
end Noise;

model ComparePSD
  extends Modelica.Icons.Example;
  .Noise.PRNG WhiteNoise(redeclare function PSD = .Noise.PSD.PSD_WhiteNoise, useSampleBasedMethods = false, redeclare function PDF = .Noise.PDF.PDF_Uniform(interval = {-1, 1}));
  .Noise.PRNG IdealLowPass(redeclare function PSD = .Noise.PSD.PSD_IdealLowPass(n = 10), useSampleBasedMethods = false, redeclare function PDF = .Noise.PDF.PDF_Uniform(interval = {-1, 1}));
  .Noise.PRNG Linear(redeclare function PSD = .Noise.PSD.PSD_LinearInterpolation(n = 5), useSampleBasedMethods = false, redeclare function PDF = .Noise.PDF.PDF_Uniform(interval = {-1, 1}));
  inner .Noise.GlobalSeed globalSeed;
end ComparePSD;

// Result:
// Error processing file: ComparePSD.mo
// Error: Failed to load package ClassExtends4 (default) using MODELICAPATH /home/omar/.openmodelica/libraries/.
// Error: Class ClassExtends4 not found in scope <top>.
// Error: Error occurred while flattening model ComparePSD.mo [BUG: #2739]
//
// # Error encountered! Exiting...
// # Please check the error message and the flags.
//
// Execution failed!
// endResult
