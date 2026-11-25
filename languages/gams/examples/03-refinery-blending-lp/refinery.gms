$title Petroleum Refinery Crude Processing and Blending LP
Sets
  cr  crude oils       / wti, brent, heavy /
  pr  refined products / gasoline, diesel, jetfuel / ;

Parameters
  crCost(cr)  crude purchase and refining cost USD per bbl
    / wti    74.0
      brent  78.5
      heavy  66.0 /
  crCap(cr)   crude availability in kbbl per day
    / wti    120
      brent  100
      heavy   80 /
  prPrice(pr) product selling price USD per bbl
    / gasoline 98.0
      diesel   94.0
      jetfuel  96.0 /
  prMax(pr)   market demand ceiling in kbbl per day
    / gasoline 110
      diesel    95
      jetfuel   65 / ;

Table yield(cr,pr)  fractional distillation yield
             gasoline  diesel  jetfuel
  wti          0.45     0.30    0.20
  brent        0.40     0.35    0.20
  heavy        0.25     0.40    0.22 ;

Scalar distCap  total atmospheric distillation capacity in kbbl per day / 220 / ;

Variables
  run(cr)   crude processed in kbbl per day
  sell(pr)  product sold in kbbl per day
  profit    net daily operating margin in kUSD per day ;
Positive Variables run, sell ;

run.up(cr)  = crCap(cr) ;
sell.up(pr) = prMax(pr) ;

Equations
  obj        maximize net margin
  cduCap     crude distillation unit capacity
  matBal(pr) product material balance ;

obj..        profit =e= sum(pr, prPrice(pr)*sell(pr)) - sum(cr, crCost(cr)*run(cr)) ;
cduCap..     sum(cr, run(cr)) =l= distCap ;
matBal(pr).. sell(pr) =l= sum(cr, yield(cr,pr)*run(cr)) ;

Model refinery / all / ;
Solve refinery using lp maximizing profit ;
Display run.l, sell.l, profit.l ;
