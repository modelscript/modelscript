* 48V-to-12V 100 kHz Buck DC-DC Switching Converter
.include lib/power_mosfet.lib
.include lib/pwm_ctrl.sub

Vin vin 0 DC 48
Vpwm gate_drv 0 PULSE(0 12 0 20n 20n 2.5u 10u)
Rg gate_drv gate 10

M1 vin gate sw sw NMOS_PWR
D1 0 sw D_SCHOTTKY
L1 sw vout 47u
Rl_esr vout vout_c 0.05
Cout vout_c 0 220u
Rload vout_c 0 2.4

.MODEL NMOS_PWR NMOS(LEVEL=1 VTO=3.0 KP=12.0 RD=0.04 RS=0.02 CBD=400p CBS=400p)
.MODEL D_SCHOTTKY D(IS=2e-6 RS=0.03 N=1.15 BV=60 CJO=180p)
.TRAN 50n 2m
.END
