# Visual Starter

Original geometric skinned GLB hero and skeleton, released under CC0 1.0.
No third-party models or textures. Generated deterministically by
`node scripts/build-visual-sample.mjs`; shared mesh joints and six real clips
(Idle/Walk/Attack/Hit/Death/Cast), plus a tiny original embedded PNG texture on
the skeleton to exercise texture validation and cache disposal. Its cast mapping is omitted
to demonstrate idle fallback. Default play stays procedural until the player
chooses a model in Home → Models & appearances.

These intentionally small examples demonstrate the loading and animation contract;
they are not polished art or changes to the skeleton statblock.

The separate import test fixture intentionally adds fake node extras for a
raycast ownership regression. The shipped assets have no such test metadata;
runtime instances ignore authored node metadata while exports retain exact bytes.
