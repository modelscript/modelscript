* Full-Wave Diode Bridge Rectifier with Ripple Filter
Vac ac_p ac_n SIN(0 17 60)
Rref ac_n 0 100k

D1 ac_p vdc_p D1N4007
D2 ac_n vdc_p D1N4007
D3 0 ac_p D1N4007
D4 0 ac_n D1N4007

Cfilt vdc_p 0 470u
Rload vdc_p 0 100

.MODEL D1N4007 D(IS=7.02e-9 RS=0.034 N=1.80 BV=1000 IBV=5u CJO=15p)
.TRAN 100u 50m
.END
