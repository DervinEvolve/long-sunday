# Working on the figure

The figure is built in code. There is no mesh file to import and no generator to run. Change the numbers in
`src/engine/characterBody.ts` (clothes), `src/engine/characterHead.ts` (face and hair) or
`src/engine/character.ts` (how he moves), and look.

## Look at him

With the dev server up (`npm run dev`):

- `/dev/figure.html` drives him with the real controller and the follow camera.
- `/tools/character/stage.html` puts several copies of him in one picture. The switches are listed at
  the top of `stage.ts`. A few I use all the time:

```
/tools/character/stage.html?turn=1&n=8                                  turnaround
/tools/character/stage.html?speed=6&t0=2&period=0.6&n=8&yaw=-90         one walk cycle, from the side
/tools/character/stage.html?speed=11.5&t0=2&period=0.43&n=8&yaw=25      one run cycle, from behind
/tools/character/stage.html?times=0.4,6.2,11.3&yaw=160                  idle at three moments
/tools/character/stage.html?turn=1&n=8&tier=low                         the low tier
/tools/character/stage.html?speed=6&stop=2&times=1.98,2.1,2.24,2.5,2.9&yaw=-90   a stop, braked like the controller
/tools/character/stage.html?speed=6&ramp=0.2&spin=3.1&times=0.02,0.1,0.18,0.3,0.5   setting off and turning about
/tools/character/stage.html?times=9.9,10.2,10.5,11&yaw=160              changing the leg he stands on
```

To save pictures (Playwright installed globally, as for `scripts/shot.mjs`):

```
node tools/character/shoot.mjs turn 1840x640 "turn=1&n=8&gap=1.25&dist=17&fov=10.5&h=1.2&ty=0.92" "turnaround"
```

They land in `.shots/figure/`. The script also prints his mesh and triangle count and the time one
update takes.

## Check him

```
npx rolldown ./tools/character/check.ts --file /tmp/figure-check.mjs --platform node
node /tmp/figure-check.mjs
```

This needs no browser. It prints the cost of each tier, the time of one update, whether `reset()`
gives the same picture twice, and then drives him for four minutes through every speed, with turns,
hops and slopes, looking for numbers that are not numbers, for anything that jumps, and for hair
that touches the head.

## Budget

At most 16 meshes, 14,000 triangles on high and 7,000 on low, and one update under 0.3 ms.
He is 12 meshes, about 10,300 triangles on high and 5,600 on low, and one update takes about 0.07 ms.

## How he moves

His feet are kept as places on the ground. A planted foot stays put while the body travels and turns over
it, so nothing slides. Above a slow walk the stride runs on a phase clock (stroll, walk and run are three
keys blended by speed). Below it he stands, and any foot that is out of place takes one real step to put it
right: that is how he settles after a stop, turns on the spot and changes the leg he rests on.
