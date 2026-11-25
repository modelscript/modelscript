function mpc = case3
% 3-Bus Economic Dispatch DC-OPF Case
mpc.version = '2';
mpc.baseMVA = 100.0;

%% bus data
% bus_i type Pd Qd Gs Bs area Vm Va baseKV zone Vmax Vmin
mpc.bus = [
	1	3	0.0	0.0	0.0	0.0	1	1.04	0.0	138.0	1	1.06	0.94;
	2	2	20.0	5.0	0.0	0.0	1	1.02	-1.5	138.0	1	1.06	0.94;
	3	1	130.0	40.0	0.0	0.0	1	0.99	-5.1	138.0	1	1.06	0.94;
];

%% generator data
% bus Pg Qg Qmax Qmin Vg mBase status Pmax Pmin
mpc.gen = [
	1	90.0	25.0	100.0	-60.0	1.04	100.0	1	150.0	10.0;
	2	60.0	20.0	80.0	-50.0	1.02	100.0	1	120.0	10.0;
];

%% branch data
% fbus tbus r x b rateA rateB rateC ratio angle status angmin angmax
mpc.branch = [
	1	2	0.015	0.080	0.024	120.0	120.0	120.0	0.0	0.0	1	-360.0	360.0;
	1	3	0.020	0.100	0.030	100.0	100.0	100.0	0.0	0.0	1	-360.0	360.0;
	2	3	0.018	0.095	0.028	100.0	100.0	100.0	0.0	0.0	1	-360.0	360.0;
];

%% generator cost data
% 2 startup shutdown n c(n-1) ... c0
mpc.gencost = [
	2	0	0	3	0.015	22.0	100.0;
	2	0	0	3	0.020	28.0	120.0;
];
