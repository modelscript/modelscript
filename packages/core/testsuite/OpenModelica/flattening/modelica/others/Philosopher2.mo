// name:     Philosopher2
// keywords: Example
// status:   correct
//
// This is the dining philosopher model from Peter F. book.
// Regression test for bug #1181
//

package Philosopher
  annotation(Diagram(coordinateSystem(extent={{-100.0,-100.0},{100.0,100.0}}, preserveAspectRatio=true, initialScale=0.1, grid={10,10})));
  model DiningTable
    parameter Integer n=5 "Number of philosophers and forks";
    parameter Real sigma=5 "Standard deviation of delay times";
    Philosopher phil[n](sigma=fill(sigma, n));
    Mutex mutex(n=n);
    Fork fork[n];
  equation
    for i in 1:n loop
      connect(phil[i].mutexPort,mutex.port[i]);
      connect(phil[i].right,fork[i].left);
      connect(fork[i].right,phil[mod(i, n) + 1].left);
    end for;
  end DiningTable;

  connector ForkPhilosopherConnection
    Boolean pickedUp(start=false);
    Boolean busy;
  end ForkPhilosopherConnection;

  model Fork
    ForkPhilosopherConnection left "Connection to the philosopher to the left of the fork";
    ForkPhilosopherConnection right "Connection to the philosopher to the right of the fork";
  equation
    right.busy=left.pickedUp;
    left.busy=right.pickedUp;
  end Fork;

  connector MutexPortOut "Application mutex port connector for access"
    output Boolean request "Set this to request ownership of the mutex";
    output Boolean release "Set this to release ownership of the mutex";
    input Boolean ok "This signals that ownership was granted";
  end MutexPortOut;

  model Philosopher "A Philosopher, connected to forks and a mutex"
    import Philosopher.Random;
    MutexPortOut mutexPort "Connection to the global mutex";
    discrete Real[3] startSeed={1,2,3};
    parameter Real mu=20.0 "mean value";
    parameter Real sigma=5 "standard dev";
    discrete Integer state "1==thinking, 2==hungry, 3==eating";
    ForkPhilosopherConnection left;
    ForkPhilosopherConnection right;
    annotation(Diagram(coordinateSystem(extent={{-100.0,-100.0},{100.0,100.0}}, preserveAspectRatio=true, initialScale=0.1, grid={10,10})));
  protected
    constant Integer thinking=0;
    constant Integer hungry=1;
    constant Integer eating=2;
    discrete Real T;
    discrete Real timeOfNextChange;
    discrete Real[3] randomSeed;
    Boolean canEat;
    Boolean timeToChangeState;
    Boolean timeToGetHungry;
    Boolean doneEating;
  equation
    timeToChangeState=timeOfNextChange <= time;
    canEat=state == hungry and not (left.busy or right.busy);
    timeToGetHungry=state == thinking and timeToChangeState;
    doneEating=state == eating and timeToChangeState;
  algorithm
    when initial() then
          state:=thinking;
      left.pickedUp:=false;
      right.pickedUp:=false;
      (T,randomSeed):=Random.normalvariate(mu, sigma, startSeed);
      timeOfNextChange:=abs(T);
    elsewhen pre(timeToGetHungry) then
      state:=hungry;
    end when;
    when pre(canEat) then
          mutexPort.release:=false;
      mutexPort.request:=true;
    end when;
    when pre(mutexPort.ok) then
          if pre(canEat) then
        left.pickedUp:=true;
        right.pickedUp:=true;
        (T,randomSeed):=Random.normalvariate(mu, sigma, pre(randomSeed));
        timeOfNextChange:=time + abs(T);
        state:=eating;
      end if;
      mutexPort.release:=true;
      mutexPort.request:=false;
    end when;
    when pre(doneEating) then
          state:=thinking;
      left.pickedUp:=false;
      right.pickedUp:=false;
      (T,randomSeed):=Random.normalvariate(mu, sigma, pre(randomSeed));
      timeOfNextChange:=time + abs(T);
    end when;
  end Philosopher;

  package Random
    annotation(Diagram(coordinateSystem(extent={{-148.5,-105.0},{148.5,105.0}}, preserveAspectRatio=true, initialScale=0.1, grid={10,10})));
    import Modelica.Math;
    constant Real NV_MAGICCONST=4*exp(-0.5)/sqrt(2.0);
    function random
      input Real[3] si "input random seed";
      output Real x "uniform random variate between 0 and 1";
      output Real[3] so "output random seed";
      annotation(Diagram(coordinateSystem(extent={{-100,-100},{100,100}})));
    algorithm
      so[1]:=abs(rem(171*si[1], 30269));
      so[2]:=abs(rem(172*si[2], 30307));
      so[3]:=abs(rem(170*si[3], 30323));
      if so[1] <= 0 and so[1] >= 0 then
        so[1]:=1;
      end if;
      if so[2] <= 0 and so[2] >= 0 then
        so[2]:=1;
      end if;
      if so[3] <= 0 and so[3] >= 0 then
        so[3]:=1;
      end if;
      x:=rem(so[1]/30269.0 + so[2]/30307.0 + so[3]/3023.0, 1.0);
    end random;

    function normalvariate "normally distributed random variable"
      input Real mu "mean value";
      input Real sigma "standard deviation";
      input Real[3] si "input random seed";
      output Real x;
      output Real[3] so "output random seed";
    protected
      Real[3] s1,s2;
      Real z,zz,u1,u2;
      Boolean my_break=false;
    algorithm
      s1:=si;
      u2:=1;
      while (not my_break) loop
        (u1,s2):=Random.random(s1);
        (u2,s1):=Random.random(s2);
        z:=NV_MAGICCONST*(u1 - 0.5)/u2;
        zz:=z*z/4.0;
        my_break:=zz <= -log(u2);
      end while;
      x:=mu + z*sigma;
      so:=s1;
    end normalvariate;
  end Random;

  connector MutexPortIn "Mutex port connector for receiveing requests"
    input Boolean request "Set by application to request access";
    input Boolean release "Set by application to release access";
    output Boolean ok "Signal that ownership was granted";
  end MutexPortIn;

  model Mutex "Mutual exclusion of shared resource"
    parameter Integer n=5 "The number of connected ports";
    MutexPortIn[n] port;
  protected
    Boolean request[n];
    Boolean release[n];
    Boolean ok[n];
    Boolean waiting[n];
    Boolean occupied "Mutex is locked if occupied is true";
  equation
    for i in 1:n loop
      port[i].ok=ok[i];
      request[i]=port[i].request;
      release[i]=port[i].release;
    end for;
  algorithm
    for i in 1:n loop
      when request[i] then
              if not occupied then
          ok[i]:=true;
          waiting[i]:=false;
        else
          ok[i]:=false;
          waiting[i]:=true;
        end if;
        occupied:=true;
      end when;
      when pre(waiting[i]) and not occupied then
              occupied:=true;
        ok[i]:=true;
        waiting[i]:=false;
      end when;
      when pre(release[i]) then
              ok[i]:=false;
        occupied:=false;
      end when;
    end for;
  end Mutex;

  model Random1
    discrete Real y;
    parameter Real mu=20.0 "mean value";
    parameter Real sigma=5 "standard dev";
    parameter Real[3] startSeed={1,2,3};
  protected
    discrete Real[3] seed;
  algorithm
    when initial() then
          (y,seed):=Philosopher.Random.normalvariate(mu, sigma, startSeed);
    end when;
    when sample(2, 1) then
          (y,seed):=Philosopher.Random.normalvariate(mu, sigma, pre(seed));
    end when;
  end Random1;
end Philosopher;
model Philosopher_DiningTable
  extends Philosopher.DiningTable;
end Philosopher_DiningTable;

// function Philosopher.Random.random
// input Real[3] si "input random seed";
// output Real x "uniform random variate between 0 and 1";
// output Real[3] so "output random seed";
// algorithm
//   so[1] := abs(rem(171.0 * si[1],30269.0));
//   so[2] := abs(rem(172.0 * si[2],30307.0));
//   so[3] := abs(rem(170.0 * si[3],30323.0));
//   if so[1] <= 0.0 AND so[1] >= 0.0 then
//     so[1] := 1.0;
//   end if;
//   if so[2] <= 0.0 AND so[2] >= 0.0 then
//     so[2] := 1.0;
//   end if;
//   if so[3] <= 0.0 AND so[3] >= 0.0 then
//     so[3] := 1.0;
//   end if;
//   x := rem(so[1] / 30269.0 + so[2] / 30307.0 + so[3] / 3023.0,1.0);
// end Philosopher.Random.random;
//
// function Philosopher.Random.normalvariate
// input Real mu "mean value";
// input Real sigma "standard deviation";
// input Real[3] si "input random seed";
// output Real x;
// output Real[3] so "output random seed";
// protected Real[3] s1;
// protected Real[3] s2;
// protected Real z;
// protected Real zz;
// protected Real u1;
// protected Real u2;
// protected Boolean my_break = false;
// algorithm
//   s1 := {si[1],si[2],si[3]};
//   u2 := 1.0;
//   while NOT my_break loop
//     (u1, s2) := Philosopher.Random.random({s1[1],s1[2],s1[3]});
//     (u2, s1) := Philosopher.Random.random({s2[1],s2[2],s2[3]});
//     z := 1.71552776992141 * (u1 - 0.5) / u2;
//     zz := z ^ 2.0 / 4.0;
//     my_break := zz <= -log(u2);
//   end while;
//   x := mu + z * sigma;
//   so := {s1[1],s1[2],s1[3]};
// end Philosopher.Random.normalvariate;
//
// function Philosopher.Random.normalvariate
// input Real mu "mean value";
// input Real sigma "standard deviation";
// input Real[3] si "input random seed";
// output Real x;
// output Real[3] so "output random seed";
// protected Real[3] s1;
// protected Real[3] s2;
// protected Real z;
// protected Real zz;
// protected Real u1;
// protected Real u2;
// protected Boolean my_break = false;
// algorithm
//   s1 := {si[1],si[2],si[3]};
//   u2 := 1.0;
//   while NOT my_break loop
//     (u1, s2) := Philosopher.Random.random({s1[1],s1[2],s1[3]});
//     (u2, s1) := Philosopher.Random.random({s2[1],s2[2],s2[3]});
//     z := 1.71552776992141 * (u1 - 0.5) / u2;
//     zz := z ^ 2.0 / 4.0;
//     my_break := zz <= -log(u2);
//   end while;
//   x := mu + z * sigma;
//   so := {s1[1],s1[2],s1[3]};
// end Philosopher.Random.normalvariate;
//
// function Philosopher.Random.random
// input Real[3] si "input random seed";
// output Real x "uniform random variate between 0 and 1";
// output Real[3] so "output random seed";
// algorithm
//   so[1] := abs(rem(171.0 * si[1],30269.0));
//   so[2] := abs(rem(172.0 * si[2],30307.0));
//   so[3] := abs(rem(170.0 * si[3],30323.0));
//   if so[1] <= 0.0 AND so[1] >= 0.0 then
//     so[1] := 1.0;
//   end if;
//   if so[2] <= 0.0 AND so[2] >= 0.0 then
//     so[2] := 1.0;
//   end if;
//   if so[3] <= 0.0 AND so[3] >= 0.0 then
//     so[3] := 1.0;
//   end if;
//   x := rem(so[1] / 30269.0 + so[2] / 30307.0 + so[3] / 3023.0,1.0);
// end Philosopher.Random.random;
//
// Result:
// Error processing file: Philosopher2.mo
// Error: Failed to load package Philosopher2 (default) using MODELICAPATH /home/omar/.openmodelica/libraries/.
// Error: Class Philosopher2 not found in scope <top>.
// Error: Error occurred while flattening model Philosopher2
//
// # Error encountered! Exiting...
// # Please check the error message and the flags.
//
// Execution failed!
// endResult
