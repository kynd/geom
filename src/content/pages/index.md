---
title: Geom
---

<div class="monologue" id="rules-tentative">
We want to make the video around the theme of math and geometry — but what does that mean?
</div>

<div class="prose">

This site is a sketchbook and working log for creating a music video for [*Musical Architecture*](https://thecollectionartaud.bandcamp.com/album/tca-70-musical-architecture-i-ii) by Yaporigami (Yu Miyashita). It captures the thinking and behind-the-scenes process, with the log itself serving as an introduction to [Sketching with Math and Quasi Physics](https://www.kynd.info/writing/sketching-with-math-and-quasi-physics).

So we talked about making the video very geometric. Setting constraints and grounding everything in strict logic felt like a fun project—especially in a time when you can ask for anything and get it without knowing how it's made. But where should we draw the line?

Polygons and <a href="https://www.kynd.info/writing/be/" target="_blank" rel="noopener">Bézier curves</a> are mathematically defined, and almost any shape can be decomposed into sine waves via <a href="https://www.kynd.info/writing/fourier-series/" target="_blank" rel="noopener">Fourier transform</a>, so in theory we could claim that anything can be described mathematically.

We set a set of tentative, self-imposed rules.

1. We rely exclusively on deterministic, fundamental functions (e.g., polynomials and trigonometry) and their iterations, extended into complex numbers, while avoiding any manual crafting of geometry.
2. We keep the visual generation process completely deterministic: the same input (sound data) produces exactly the same result. We also avoid <a href="https://www.kynd.info/writing/taming-randomness/" target="_blank" rel="noopener">random and noise functions</a> (even though computer "randomness" is pseudo-random and therefore deterministic). Sound data is the only quasi-random element, in the sense that it yields varying values without following the mathematical functions described above.
3. We minimize arbitrary choices. This means avoiding keyframing whenever we can. It turns out it is nearly impossible to follow this rule strictly, since any choice—such as which function to use and when, and how we process sound into data—is itself arbitrary. Still, we try to drive changes, transitions, and other variations through simple, deterministic rules as much as possible.

</div>

<div class="monologue">
Here's the final video.<br />
<strong>Watch, like, and share</strong> before reading the rest!
</div>

<div class="demo-embed">
<iframe src="https://player.vimeo.com/video/1215067660" title="Musical Architecture I &amp; II" scrolling="no" allow="autoplay; fullscreen; picture-in-picture" allowfullscreen></iframe>
</div>
