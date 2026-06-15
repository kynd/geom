---
title: Geom
---

This site is a sketchbook and working log for creating a music video for [*Musical Architecture*](https://thecollectionartaud.bandcamp.com/album/tca-70-musical-architecture-i-ii) by Yaporigami (Yu Miyashita). It captures the thinking and behind-the-scenes process, with the log itself serving as an introduction to [Sketching with Math and Quasi Physics](https://www.kynd.info/writing/sketching-with-math-and-quasi-physics).

## Rules (Tentative)

We want to make the video around the theme of math and geometry — but what does that mean? Polygons and <a href="https://www.kynd.info/writing/be/" target="_blank" rel="noopener">Bézier curves</a> are mathematically defined, and almost any shape can be decomposed into sine waves via <a href="https://www.kynd.info/writing/fourier-series/" target="_blank" rel="noopener">Fourier transform</a>, so in theory we could claim that anything can be described mathematically.

Here is a set of tentative, self-imposed rules.

1. We rely exclusively on deterministic, fundamental functions (e.g., polynomials and trigonometry) and their iterations, extended into complex numbers, while avoiding any manual crafting of geometry.
2. We keep the visual generation process completely deterministic: the same input (sound data) produces exactly the same result. We also avoid <a href="https://www.kynd.info/writing/taming-randomness/" target="_blank" rel="noopener">random and noise functions</a> (even though computer "randomness" is pseudo-random and therefore deterministic). Sound data is the only quasi-random element, in the sense that it yields varying values without following the mathematical functions described above.
3. We minimize arbitrary choices as much as possible, driving changes, transitions, and other variations through deterministic rules. However, we still make human choices. Eliminating arbitrariness entirely is impossible, since even the choice of which function to use — and how we process sound into data — is itself arbitrary.

## License

Code and writing: [CC BY-SA 4.0](https://creativecommons.org/licenses/by-sa/4.0/) — Kenichi Yoneda (Kynd).
Sound files: [CC BY-NC-SA 4.0](https://creativecommons.org/licenses/by-nc-sa/4.0/) — Yaporigami (Yu Miyashita).
See the [full license details](https://github.com/kynd/geom/blob/main/README.md).
