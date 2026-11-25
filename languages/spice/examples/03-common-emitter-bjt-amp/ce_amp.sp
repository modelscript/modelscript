* Common-Emitter NPN BJT Small-Signal Amplifier
.include lib/bjt_models.lib

Vcc vcc 0 DC 12
Vin in 0 DC 0 AC 10m SIN(0 10m 1k)
Rs in in_s 600
Cin in_s base 10u

R1 vcc base 47k
R2 base 0 10k
Rc vcc coll 2.2k
Re emit 0 470
Ce emit 0 100u

Q1 coll base emit Q2N2222
Cout coll out 10u
Rload out 0 10k

.MODEL Q2N2222 NPN(IS=14.34f BF=255.9 VAF=74.03 IKF=0.2847 RB=10 RC=1 RE=0.5 CJE=22.01p CJC=7.306p TF=411.1p)
.OP
.AC DEC 20 10 10Meg
.TRAN 10u 5m
.END
