// Muscle-map stat sheet (Profile tab). Two toggleable body silhouettes
// (front/back), each muscle group colored per the app's own red/green
// scale, driven by /api/muscle-scores.
//
// The body shapes themselves are real anatomical SVG path data adapted
// from vulovix/body-muscles (https://github.com/vulovix/body-muscles),
// Copyright 2024 Ivan Vulović, licensed Apache License 2.0. A first
// hand-drawn attempt (tapered "muscle belly" shapes generated from
// parametric curves) looked visibly artificial next to a real reference
// photo -- tracing the Skulpt screenshot ImIceTry showed for inspiration
// wasn't an option (that's someone else's copyrighted illustration), so
// this swaps in a properly licensed, professionally-drawn anatomical
// asset instead of continuing to hand-tune curve math. Only the raw path
// coordinates are reused here; the region-to-muscle-group mapping, the
// scoring/coloring, and all the surrounding rendering/interaction code
// are original to this app.
//
// Regions in the source asset with no corresponding entry in this app's
// primary_muscles taxonomy (obliques, serratus anterior, hip flexors,
// tibialis anterior, spine, and joint/extremity regions like knees,
// elbows, hands, feet, head/face) are drawn as plain neutral shading,
// not colored or clickable -- same "don't fabricate a score" principle
// already used for muscle groups with no real training data.

// The body itself is unchanged on its own real coordinates; the viewBox
// just grows by a margin on the right (2026-09-15, all progress labels
// moved to one column per ImIceTry's follow-up ask) so there's open space
// clear of the silhouette for the callout labels/lines, plus a small
// left margin so the body isn't flush against that edge.
const LEFT_MARGIN = 2;
const RIGHT_MARGIN = 18;
const FRONT_VIEWBOX = `${-LEFT_MARGIN} 0 ${35 + LEFT_MARGIN + RIGHT_MARGIN} 93`;
const BACK_VIEWBOX = `${37 - LEFT_MARGIN} 0 ${35 + LEFT_MARGIN + RIGHT_MARGIN} 93`;

// Each entry: { muscle: <taxonomy name> | null, d: <exact source path> }.
// `muscle: null` regions render as neutral body shading only.
const MUSCLE_MAP_REGIONS = {
  front: [
    { muscle: null, d: "m 11.671635,6.3585449 -0.0482,-2.59085 4.20648,-2.46806 4.42769,2.95361 -0.0405,1.94408 0.24197,-3.34467 -2.03129,-2.31103004 -2.84508,-0.51629 -2.20423,0.52915 -1.9363,2.63077004 z" },
    { muscle: null, d: "m 19.748825,6.7034949 0.0203,-2.20747 -3.96689,-2.7637 -3.74099,2.23559 -0.006,2.63528 -0.60741,0.0403 0.27408,1.82447 0.97635,0.33932 0.44244,2.1802901 1.82222,2.06556 2.03518,-0.0607 1.79223,-1.94408 0.35957,-2.2406601 0.97616,-0.33932 0.25159,-1.78416 z" },
    { muscle: "neck", d: "m 13.304665,11.910505 1.64975,2.35202 0.74426,2.62159 -1.73486,-1.38354 -0.86649,-2.97104 z" },
    { muscle: "neck", d: "m 18.385135,11.910505 -1.64975,2.35202 -0.74538,2.62234 1.73486,-1.38354 0.86649,-2.97104 z" },
    // The shoulder cap was always two separate traced fragments per side --
    // the upper one hugging the collarbone/neck (anatomically anterior
    // deltoid) and the lower one wrapping the joint toward the arm
    // (lateral deltoid). Splitting front/side delts here needed no new
    // artwork, just recognizing that split already existed in the source
    // path data (2026-09-14, per ImIceTry's request to make the body map
    // distinguish deltoid heads).
    { muscle: "front delts", d: "m 19.047795,13.248365 3.55748,1.97916 0.72653,-0.35074 z m -0.107,0.43288 -0.37119,1.73073 2.1846,0.53561 1.40116,-0.49436 z" },
    { muscle: "side delts", d: "m 22.922305,15.657195 0.75814,-0.41 2.40806,1.66799 1.17364,1.50707 0.62662,1.5626 -0.0464,3.70194 -1.3284,-1.72153 0.0407,-2.59376 -0.48842,-0.50049 c 0,0 -3.09778,-3.19058 -3.14371,-3.21401 z m -0.2409,0.10873 c -0.001,0.0525 3.32987,3.54733 3.32987,3.54733 l 0.10067,3.10396 -1.15426,-1.97782 -2.22547,-0.94804 -1.56576,-2.88481 z" },
    { muscle: "front delts", d: "m 12.624785,13.248365 -3.5574599,1.97916 -0.72653,-0.35074 z m 0.107,0.43288 0.37119,1.73073 -2.18459,0.53561 -1.4011499,-0.49436 z" },
    { muscle: "side delts", d: "m 8.7502951,15.657195 -0.75814,-0.41 -2.40806,1.66799 -1.17364,1.50707 -0.62662,1.56259 0.0464,3.70195 1.3284,-1.72153 -0.0407,-2.59376 0.48843,-0.5005 c 0,0 3.09777,-3.19057 3.1437,-3.214 z m 0.2409,0.10873 c 0.002,0.0525 -3.32987,3.54733 -3.32987,3.54733 l -0.10067,3.10396 1.15426,-1.97782 2.22547,-0.94804 1.5657499,-2.88481 z" },
    { muscle: "biceps", d: "m 27.621665,30.814715 -0.33838,1.70499 -1.81932,-2.54418 -0.6629,-1.26895 z m -2.85271,-2.6096 c -0.0259,-0.0144 -0.0536,-0.0254 -0.0824,-0.0324 l -1.48333,-4.95503 1.00456,-2.08428 1.65511,1.74532 2.23034,6.67667 0.0415,0.93739 c -1.06528,-0.84215 -2.18962,-1.60679 -3.36434,-2.28803 z m 1.6945,-5.75654 1.64893,6.43421 -0.36469,-4.92266 z" },
    { muscle: "forearms", d: "m 26.955425,32.969125 1.30083,10.28927 -1.10778,0.01 -1.89387,-7.99609 0.19174,-4.53719 z m 1.21978,-1.94971 -0.58729,2.58635 1.11876,9.15614 0.55849,-0.21663 0.2304,-6.77018 z" },
    { muscle: "biceps", d: "m 4.0746451,30.814715 0.33838,1.70499 1.81931,-2.54418 0.66289,-1.26895 z m 2.8527,-2.6096 c 0.0259,-0.0144 0.0536,-0.0254 0.0824,-0.0324 l 1.48332,-4.95503 -1.00455,-2.08428 -1.65509,1.74532 -2.23034,6.67667 -0.0415,0.93739 c 1.06528,-0.84215 2.18961,-1.60679 3.36433,-2.28803 z m -1.6945,-5.75654 -1.64891,6.43421 0.36468,-4.92266 z" },
    { muscle: "forearms", d: "m 4.5752651,32.969125 -1.30083,10.28927 1.10778,0.01 1.89387,-7.99609 -0.19174,-4.53719 z m -1.21978,-1.94971 0.58728,2.58635 -1.11875,9.15614 -0.55849,-0.21663 -0.2304,-6.77018 z" },
    { muscle: "chest", d: "m 20.337455,17.085495 1.72942,3.09103 1.890,0.94 -0.5,0.3 -6.8, -2.1 z" },
    { muscle: "chest", d: "m 16.66,19.72 6.8,2.1 -0.65,0.5 -0.90604,2.63773 -2.09968,0.86537 -3.34524,-1.655 0.2,-3.8 z" },
    { muscle: "chest", d: "m 11.351215,17.085495 -1.7294199,3.09103 -1.890,0.94 0.5,0.3 6.8,-2.1 z" },
    { muscle: "chest", d: "m 15.03,19.72 -6.8,2.1 0.65,0.5 0.90586,2.63773 2.0996699,0.86537 3.34636,-1.655 -0.2,-3.8 z" },
    // Abs split into upper/lower/obliques (2026-09-15, ImIceTry's ask). The
    // rendered six-pack reads as 5 stacked rows top to bottom: two rows of
    // fine lattice detail, the widest/most-lateral main block, the second
    // main block, then a bottom lattice tip -- confirmed by temporarily
    // coloring each of the 10 shapes individually and screenshotting, not
    // guessed from raw coordinates (several of these are multi-subpath
    // shapes whose bounding box alone doesn't reveal the actual row
    // layout). There's no separate traced region for obliques anywhere in
    // the source art -- unlike the rear-delt cut, there's no single bigger
    // adjacent shape to slice a clean strip from, and these blocks are
    // already small enough that cutting each one into inner/outer slivers
    // would be illegible. ImIceTry's own call: use the widest, most-lateral
    // existing block on each side as obliques instead of literally cutting
    // new geometry -- an honest stand-in given the constraint, not a
    // precise trace.
    { muscle: "obliques", d: "m 19.641935,34.707615 1.81341,-1.36479 0.15748,1.83347 1.28642,2.37338 -1.98044,2.73652 -1.03109,0.16554 -0.37026,-3.88816 z" },
    { muscle: "upper abs", d: "M 19.289,26.152 l -3.11202 -1.40604 0.0937 2.27965 2.80119 1.43603 z M 21.224,27.820 l -1.29355 0.7212 0.14997 -1.70898 z M 20.171,26.183 l 2.47968 -1.03241 -0.9336 2.52093 z M 21.702,27.921 l -1.69005 1.03372 -0.28871 2.0678 1.64975 -1.07533 z" },
    { muscle: "upper abs", d: "M 18.791,29.025 l -0.0622 1.62387 -2.30308 -0.49961 -0.12448 -2.21722 z M 18.635,31.429 l 0.0311 1.99844 -2.20953 0.59391 -0.0311 -3.1227 z M 21.290,30.444 l -1.48383 1.03372 -0.20622 2.10905 1.64862 -1.32355 z" },
    { muscle: "obliques", d: "m 12.045985,34.707615 -1.81341,-1.36479 -0.15748,1.83347 -1.2856799,2.37432 1.9804499,2.73595 1.03109,0.16554 0.37119,-3.88721 z" },
    { muscle: "lower abs", d: "m 15.636055,44.919735 -0.60647,-5.91209 -0.015,-3.84879 -2.18479,-1.07533 -0.24746,7.03017 z" },
    { muscle: "lower abs", d: "m 16.051865,44.919165 0.60628,-5.91209 0.0154,-3.84915 2.18404,-1.07515 0.24746,7.03017 z" },
    { muscle: "upper abs", d: "m 12.399365,26.152365 3.11202,-1.40603 -0.0937,2.27965 -2.80138,1.4364 z m -1.93508,1.6685 1.29355,0.72139 -0.14997,-1.70899 z m 1.05303,-1.637 -2.4793099,-1.03259 0.93361,2.52148 z m -1.5316399,1.73729 1.6900499,1.03372 0.28871,2.06743 -1.64881,-1.07515 z" },
    { muscle: "upper abs", d: "M 12.897,29.025 l 0.0623 1.62387 2.30327 -0.49961 0.12448 -2.21703 z M 13.053,31.430 l -0.0309 1.99844 2.20973 0.59353 0.0311 -3.1227 z M 10.398,30.445 l 1.48384 1.0339 0.20622 2.10905 -1.64975 -1.32355 z" },
    { muscle: "lower abs", d: "m 14.404465,45.040075 0.0221,-0.0277 -0.14866,-0.37945 -3.10172,-3.40449 -0.23283,-0.0825 2.05918,5.32009 z m -1.17263,2.01833 1.27705,3.29948 0.42631,-4.04862 -0.25196,-0.64303 z" },
    { muscle: "lower abs", d: "m 17.284025,45.040455 -0.0221,-0.0281 0.14867,-0.37926 3.10171,-3.40449 0.23246,-0.0825 -2.05843,5.3199 z m 1.17263,2.01795 -1.27706,3.29948 -0.42631,-4.04843 0.25197,-0.64303 z" },
    { muscle: "quadriceps", d: "m 23.419015,50.399125 -0.15504,4.75091 -2.40263,6.60949 0.7362,1.90021 2.36401,-8.34435 z m -0.58154,-11.60825 -0.15485,4.00722 1.31793,7.93154 0.61977,-6.40308 z m -0.38731,5.12268 -2.75152,6.07258 -0.62015,4.87425 1.16232,6.85771 2.51886,-6.98144 0.15504,-7.18764 z" },
    { muscle: "adductors", d: "m 22.063225,39.369605 v 4.21363 l -2.94574,5.82511 -1.86027,5.78349 0.19365,-4.0072 z m -3.24944,13.42596 -0.0649,0.15467 -1.21294,2.90207 0.78325,7.18803 1.23619,-0.66122 -1.0714,-6.69272 z" },
    { muscle: null, d: "m 17.255895,87.868445 0.1243,3.45228 0.28983,1.20638 h 0.87136 l 0.24897,-0.83181 0.29058,-0.0416 -0.0624,0.83181 1.09914,-0.33332 0.29058,-0.16629 1.24444,-0.27033 0.0416,-0.97748 -1.20319,-2.03743 -0.82974,-1.0399 -2.03294,-0.83181 z" },
    { muscle: null, d: "m 18.251375,70.441125 0.29058,0.91486 0.6224,3.8681 0.0829,5.15733 -0.87136,5.03304 0.0412,-6.44714 -0.91242,-2.57848 -0.12561,-2.82837 z m 1.9915,2.32915 -0.20753,7.73637 -1.65949,6.23904 1.80478,-0.853 3.00816,-10.83583 -1.03727,-6.82095 z" },
    { muscle: null, d: "m 21.404635,64.784375 0.1243,1.12295 -0.87118,1.08171 -0.29058,1.70599 -0.58116,0.24933 -0.49774,-2.57866 -0.33182,-0.91486 0.29058,-0.58247 z m -3.85853,0.0832 0.6224,1.74685 1.3273,2.57867 -0.33182,2.37095 -0.95423,-2.66209 -0.78738,-1.49734 z m 4.97811,-2.37039 -0.95423,5.11609 0.62241,-0.33295 0.49773,1.66381 z" },
    { muscle: "quadriceps", d: "m 8.2694651,50.399125 0.15504,4.75053 2.4026299,6.60968 -0.73638,1.90021 -2.3640099,-8.34435 z m 0.58117,-11.60768 0.15503,4.00684 -1.31754,7.93154 -0.61978,-6.40308 z m 0.38769,5.1223 2.7515099,6.07239 0.61997,4.87425 -1.16232,6.85771 -2.5190499,-6.98163 -0.15504,-7.18801 z" },
    { muscle: "adductors", d: "m 9.6258251,39.369415 v 4.21363 l 2.9451699,5.8253 1.86028,5.78349 -0.19366,-4.0072 z m 3.2488699,13.42559 0.0647,0.15485 1.21294,2.90207 -0.78307,7.18803 -1.23618,-0.66102 1.0714,-6.69273 z" },
    { muscle: null, d: "m 14.433335,87.868265 -0.12448,3.45228 -0.29058,1.20637 h -0.87118 l -0.24877,-0.83181 -0.29059,-0.0416 0.0623,0.83181 -1.09934,-0.33333 -0.29058,-0.16629 -1.2448,-0.27033 -0.0412,-0.97747 1.2031899,-2.03781 0.82975,-1.04009 2.03294,-0.83181 z" },
    { muscle: null, d: "m 13.437675,70.440945 -0.29058,0.91486 -0.62241,3.86828 -0.0829,5.15733 0.87174,5.03304 -0.0418,-6.44714 0.91298,-2.57848 0.1243,-2.82837 z m -1.99151,2.32914 0.20735,7.73637 1.65968,6.23904 -1.80497,-0.85299 -3.0079799,-10.83584 1.03728,-6.82095 z" },
    { muscle: null, d: "m 10.284405,64.784375 -0.12448,1.12295 0.87118,1.08171 0.29058,1.70599 0.58116,0.24933 0.49774,-2.57866 0.33182,-0.91486 -0.29058,-0.58247 z m 3.85854,0.0832 -0.62241,1.74685 -1.32767,2.57867 0.33182,2.37095 0.95423,-2.66209 0.78832,-1.4964 z m -4.9786799,-2.37058 0.9542299,5.11609 -0.6223999,-0.33313 -0.49793,1.6638 z" },
    { muscle: null, d: "m 3.2054751,27.370125 0.005,3.09419 -0.57959,1.91184 -0.54539,-2.41185 z" },
    { muscle: null, d: "m 4.3904451,43.563145 -1.5198,0.0506 -0.76631,-0.67112 -1.21261996,2.15767 -0.86245,3.32873 0.49386,0.22113 0.59814996,-2.20238 0.50016,0.25356 -0.35639,2.49422 0.62382,0.24345 0.41402,-2.49194 0.55839,0.17851 -0.2262,2.76603 0.76938,0.32268 0.25788,-2.86764 0.4578,-0.0181 0.16611,2.65239 0.65997,0.2633 0.0712,-4.56643 0.34158,-0.19428 1.35316,1.68367 0.32832,-0.34354 -0.72644,-2.0551 z" },
    { muscle: null, d: "m 28.325215,27.370125 -0.005,3.09419 0.57959,1.91184 0.54538,-2.41185 z" },
    { muscle: null, d: "m 27.140245,43.563145 1.5198,0.0506 0.76631,-0.67111 1.21262,2.15766 0.86245,3.32873 -0.49386,0.22113 -0.59815,-2.20238 -0.50016,0.25356 0.35639,2.49422 -0.62382,0.24345 -0.41402,-2.49194 -0.55839,0.17851 0.2262,2.76603 -0.76938,0.32268 -0.25788,-2.86764 -0.4578,-0.0181 -0.16611,2.6524 -0.65997,0.26329 -0.0712,-4.56643 -0.34158,-0.19428 -1.35316,1.68368 -0.32832,-0.34355 0.72644,-2.0551 z" },
  ],
  back: [
    { muscle: null, d: "m 48.157455,6.3585449 0.44208,-0.14964 0.16111,0.16427 1.48163,4.0475101 2.32401,1.45118 2.39971,-1.52387 0.97577,-3.6896901 0.52752,-0.55908 0.23367,0.0981 0.24198,-3.34467 -2.03129,-2.31103004 -2.84509,-0.51629 -2.20422,0.52915 -1.93631,2.63077004 z" },
    { muscle: null, d: "m 52.369695,12.105075 -2.35767,-1.55045 -1.47119,-3.9514301 -0.60741,0.0403 0.27409,1.82447 0.97635,0.33932 0.7613,2.2157201 0.33017,1.06849 0.0895,2.14894 1.16448,0.008 0.10563,-0.70833 0.54716,-0.0606 z m 1.01793,1.47595 0.23768,0.64982 1.38107,-0.004 0.01,-2.38784 0.25971,-0.79061 0.57215,-2.1698001 0.76359,-0.41018 0.25158,-1.78416 -0.62859,0.0193 -1.08488,3.8998101 -2.39725,1.46684 0.2768,1.48507 z" },
    { muscle: "traps", d: "M 49.625,14.629 L 49.688,12.005 L 48.974,13.157 L 44.594,14.654 L 45.945,16.925 L 51.222,16.925 L 51.183,14.550 Z" },
    { muscle: "traps", d: "M 46.034,17.075 L 48.920,21.925 L 51.303,21.925 L 51.224,17.075 Z" },
    { muscle: "traps", d: "M 49.009,22.075 L 49.572,23.022 L 51.403,28.104 L 51.305,22.075 Z" },
    { muscle: "traps", d: "M 55.439,14.729 L 55.376,12.104 L 56.090,13.256 L 60.470,14.754 L 59.179,16.925 L 53.844,16.925 L 53.881,14.649 Z" },
    { muscle: "traps", d: "M 59.089,17.075 L 56.204,21.925 L 53.763,21.925 L 53.842,17.075 Z" },
    { muscle: "traps", d: "M 56.114,22.075 L 55.492,23.121 L 53.661,28.203 L 53.761,22.075 Z" },
    // The back view had no real rear-delt shape at all -- just a sliver
    // triangle tagged "shoulders" too small to read as its own region. Per
    // ImIceTry's own call (2026-09-14, "doesn't have to be perfect, just add
    // a line to cut off a bit of the lat"), the adjacent lats hexagon is
    // split with one straight diagonal cut (its own two original traced
    // vertices, not a new curve) so the rear-delt region actually has a
    // visible size, at the cost of a slightly smaller lats shape.
    { muscle: "rear delts", d: "M 44.144,15.285 L 39.888,20.286 L 39.426,22.749 L 41.263,21.510 Z" },
    { muscle: "lats", d: "M 44.144,15.285 L 41.263,21.510 L 44.025,20.355 L 45.663,23.400 L 49.103,23.400 Z" },
    { muscle: "rear delts", d: "M 42.201,16.586 L 40.626,18.152 L 39.736,20.156 L 43.992,15.155 Z" },
    { muscle: "lats", d: "M 45.771,23.600 L 45.872,23.789 L 47.009,29.286 L 47.023,30.400 L 51.080,30.400 L 51.053,28.314 L 49.185,23.600 Z" },
    { muscle: "lats", d: "M 47.026,30.600 L 47.086,35.145 L 51.156,36.255 L 51.082,30.600 Z" },
    { muscle: "rear delts", d: "M 62.863,16.686 L 64.438,18.251 L 65.328,20.255 L 61.073,15.254 Z" },
    { muscle: "rear delts", d: "M 60.921,15.384 L 65.176,20.385 L 65.290,22.849 L 63.801,21.609 Z" },
    { muscle: "lats", d: "M 60.921,15.384 L 63.801,21.609 L 61.039,20.454 L 59.455,23.400 L 56.022,23.400 Z" },
    { muscle: "lats", d: "M 59.347,23.600 L 59.192,23.888 L 58.055,29.385 L 58.042,30.400 L 53.986,30.400 L 54.012,28.413 L 55.918,23.600 Z" },
    { muscle: "lats", d: "M 58.039,30.600 L 57.979,35.245 L 53.908,36.354 L 53.983,30.600 Z" },
    { muscle: "triceps", d: "M 43.593,21.039 L 44.920,23.967 L 43.615,25.653 L 43.186,27.069 L 39.209,29.802 Z" },
    { muscle: "triceps", d: "M 43.459,20.972 L 39.075,29.735 L 38.871,25.461 L 39.407,23.674 L 41.242,21.927 Z" },
    { muscle: null, d: "M 40.716955,42.424835 l -1.5182,0.0863 -0.78184,-0.65295 -1.16168,2.1855 -0.78414,3.34805 0.49892,0.20949 0.54632,-2.2158 0.50597,0.24175 -0.29779,2.5019 0.62936,0.22875 0.35546,-2.50096 0.56242,0.16536 -0.16126,2.77057 0.77674,0.30455 0.19056,-2.87291 0.45724,-0.0289 0.22827,2.64778 0.66597,0.24774 -0.0359,-4.56685 0.33693,-0.20224 1.39227,1.65147 0.32017,-0.35115 -0.77444,-2.03749 z" },
    { muscle: "forearms", d: "M 40.775,29.006 L 42.870,27.644 L 42.187,29.635 L 42.603,34.383 L 40.799,42.081 L 39.814,42.253 Z" },
    { muscle: "forearms", d: "M 39.665,42.242 L 38.305,41.501 L 37.998,34.491 L 38.635,31.429 L 39.245,30.209 L 40.625,28.994 Z" },
    { muscle: "triceps", d: "M 61.376,21.213 L 60.056,24.145 L 61.330,26.199 L 61.657,27.251 L 65.780,29.966 Z" },
    { muscle: "triceps", d: "M 61.510,21.146 L 65.914,29.899 L 66.108,25.624 L 65.568,23.839 L 63.729,22.096 Z" },
    { muscle: null, d: "M 64.301385,42.592325 l 1.51839,0.0828 0.78033,-0.65476 1.16673,2.18281 0.79187,3.34623 -0.49843,0.21064 -0.55144,-2.21453 -0.50541,0.24292 0.30356,2.5012 -0.62882,0.23021 -0.36124,-2.50014 -0.56203,0.16666 0.16765,2.77019 -0.77603,0.30634 -0.19719,-2.87245 -0.45732,-0.0278 -0.22215,2.64829 -0.66539,0.24928 0.0254,-4.56692 -0.3374,-0.20146 -1.38845,1.65469 -0.32098,-0.35041 0.76973,-2.03928 z" },
    { muscle: "forearms", d: "M 65.204,42.420 L 63.925,29.007 L 61.764,27.798 L 62.786,29.733 L 62.397,34.555 L 64.219,42.248 Z" },
    { muscle: "forearms", d: "M 64.075,28.993 L 65.353,42.405 L 66.712,41.663 L 67.002,34.653 L 66.358,31.591 L 65.745,30.373 Z" },
    { muscle: null, d: "m 51.733705,14.788555 0.53876,25.33066 0.48967,-0.0297 0.65658,-25.3387 -0.28147,-0.84188 -1.25059,-4.9e-4 z" },
    { muscle: "lower back", d: "M 52.292,37.310 L 49.934,36.465 L 50.584,40.788 L 52.384,42.030 L 52.384,40.270 L 52.338,40.280 Z" },
    { muscle: "lower back", d: "M 49.798,36.490 L 46.901,35.460 L 45.502,39.420 L 50.448,40.812 Z" },
    { muscle: "lower back", d: "M 52.936,42.030 L 52.936,40.270 L 52.982,40.260 L 53.028,37.290 L 55.226,36.625 L 54.781,40.801 Z" },
    { muscle: "lower back", d: "M 55.364,36.643 L 55.862,36.470 L 58.014,35.720 L 59.247,39.450 L 54.919,40.819 Z" },
    { muscle: "glutes", d: "M 50.406,41.481 L 45.228,39.690 L 44.364,41.580 L 43.984,44.301 Z" },
    { muscle: "glutes", d: "M 50.462,41.619 L 44.040,44.439 L 44.914,50.520 L 47.546,51.030 L 51.764,49.090 L 52.315,49.480 L 52.315,42.880 Z" },
    { muscle: "glutes", d: "M 55.235,41.079 L 61.011,45.519 L 60.333,42.150 L 59.478,39.860 Z" },
    { muscle: "glutes", d: "M 55.152,41.201 L 52.885,42.880 L 52.885,49.480 L 53.617,49.090 L 57.521,50.760 L 60.200,50.600 L 60.928,45.641 Z" },
    { muscle: null, d: "m 51.176145,64.073985 -1.20605,3.01461 0.70738,0.26558 0.89754,3.51771 -0.55801,-4.01191 z m -5.08496,-3.15003 0.63355,1.8609 0.16813,2.03261 0.61314,1.93117 -0.90585,-0.0851 -0.28534,2.15982 z" },
    { muscle: null, d: "m 54.019305,64.073985 1.20605,3.01461 -0.70737,0.26558 -0.89755,3.51771 0.55802,-4.01191 z m 5.08496,-3.15003 -0.63355,1.8609 -0.16813,2.03261 -0.61313,1.93117 0.90584,-0.0851 0.28534,2.15982 z" },
    // Light split (2026-09-15, same "a handful, not a full fan" call as
    // hamstrings) -- single cut per shape, these were already small.
    // Left calf nudged -0.6 total on x (2026-09-16, ImIceTry's ask -- "move
    // the left calve to the left by 0.4", then "another 0.2"), matching cut
    // lines updated below too.
    { muscle: "calves", d: "M 50.558,67.512 L 51.494,72.509 L 51.247,75.532 Z" },
    { muscle: "calves", d: "M 50.558,67.512 L 51.247,75.532 L 51.173,76.825 L 49.211,76.825 Z" },
    { muscle: "calves", d: "M 50.260,67.512 L 48.913,76.825 L 46.916,76.825 Z" },
    { muscle: "calves", d: "M 50.260,67.512 L 46.916,76.825 L 46.278,74.263 L 47.341,67.088 Z" },
    { muscle: "calves", d: "M 47.003,77.175 L 51.154,77.175 L 50.671,85.598 Z" },
    { muscle: "calves", d: "M 47.003,77.175 L 50.671,85.598 L 49.256,86.233 Z" },
    { muscle: "calves", d: "M 54.609,67.512 L 53.672,72.509 L 53.919,75.532 Z" },
    { muscle: "calves", d: "M 54.609,67.512 L 53.919,75.532 L 53.993,76.825 L 55.956,76.825 Z" },
    { muscle: "calves", d: "M 54.906,67.512 L 56.254,76.825 L 58.250,76.825 Z" },
    { muscle: "calves", d: "M 54.906,67.512 L 58.250,76.825 L 58.888,74.263 L 57.825,67.088 Z" },
    { muscle: "calves", d: "M 54.013,77.175 L 58.163,77.175 L 55.909,86.233 Z" },
    { muscle: "calves", d: "M 54.013,77.175 L 55.909,86.233 L 54.496,85.598 Z" },
    { muscle: null, d: "M 50.933115,88.340995 l 0.85194,1.3581 0.37189,0.79238 -0.15588,1.21774 -0.76984,0.74446 -1.51185,0.12543 -1.1299,-0.29192 -0.24225,-0.95894 0.80765,-1.30405 -0.22562,-0.85987 0.29679,-0.84153 -0.0194,-1.81524 1.53568,-0.54817 z m -1.19598,0.4675 0.15943,1.25776 -0.6023,0.97431 m -0.54436,0.29544 1.06474,0.40084 1.55326,-0.65137 z" },
    // Light split (2026-09-15, ImIceTry's follow-up: "a handful of
    // triangles, not 39") -- 2 cuts per shape instead of a full fan to
    // every vertex, same unchanged outer silhouette.
    // Left hamstring nudged +0.7 total on x (2026-09-16, ImIceTry's ask --
    // "needs to move a little to the right", "a bit more", then "another
    // .1"), matching cut lines updated below too.
    { muscle: "hamstrings", d: "M 47.938,51.196 L 48.274,66.806 L 49.198,66.965 L 50.833,63.670 L 50.313,62.256 Z" },
    { muscle: "hamstrings", d: "M 47.938,51.196 L 50.313,62.256 L 52.313,56.213 L 52.132,51.567 L 52.044,49.769 L 51.529,49.498 Z" },
    { muscle: "hamstrings", d: "M 47.799,51.204 L 44.998,50.950 L 44.684,54.633 L 46.614,62.791 Z" },
    { muscle: "hamstrings", d: "M 47.799,51.204 L 46.614,62.791 L 46.710,64.547 L 47.177,66.663 L 48.101,66.814 Z" },
    { muscle: null, d: "M 54.262335,88.340995 l -0.85194,1.3581 -0.37189,0.79238 0.15589,1.21774 0.76983,0.74446 1.51186,0.12543 1.12989,-0.29192 0.24225,-0.95894 -0.80765,-1.30405 0.22563,-0.85987 -0.29679,-0.84153 0.0194,-1.81524 -1.53568,-0.54817 z m 1.19598,0.4675 -0.15943,1.25776 0.6023,0.97431 m 0.54436,0.29544 -1.06474,0.40084 -1.55326,-0.65137 z" },
    { muscle: "hamstrings", d: "M 57.208,51.196 L 56.872,66.806 L 55.948,66.965 L 54.313,63.670 L 54.833,62.256 Z" },
    { muscle: "hamstrings", d: "M 57.208,51.196 L 54.833,62.256 L 52.833,56.213 L 53.014,51.567 L 53.102,49.769 L 53.617,49.498 Z" },
    { muscle: "hamstrings", d: "M 57.347,51.204 L 60.148,50.950 L 60.462,54.633 L 58.532,62.791 Z" },
    { muscle: "hamstrings", d: "M 57.347,51.204 L 58.532,62.791 L 58.436,64.547 L 57.969,66.663 L 57.045,66.814 Z" },
  ],
};

// Score (0-1, staleness -- see records.py's muscle_group_scores, redesigned
// 2026-09-14) -> a color on the app's own established red/green scale
// (Phase 5.5's muted resting-banner green, the existing failure red).
// score is always a real number now (every muscle in the taxonomy gets one,
// even "never trained" = 0), so there's no null/no-data case to special-case
// here anymore -- that distinction lives in days_since_trained instead.
function muscleScoreColor(score) {
  const RED = [224, 80, 60]; // #e0503c
  const GREEN = [75, 155, 108]; // #4b9b6c
  const t = Math.max(0, Math.min(1, score));
  const rgb = RED.map((c, i) => Math.round(c + (GREEN[i] - c) * t));
  return `rgb(${rgb[0]}, ${rgb[1]}, ${rgb[2]})`;
}

// "today" / "yesterday" / "N days ago" / "Never trained". days is already a
// clean calendar-day integer from the backend (records.py, fixed 2026-09-16
// to diff calendar dates rather than floor raw elapsed hours/24 -- that
// used to show "Today" for a late-night session from the day before), not
// a continuous elapsed-time float -- no rounding needed here anymore.
function formatDaysSince(days) {
  if (days == null) return "Never trained";
  if (days <= 0) return "Today";
  if (days === 1) return "Yesterday";
  return `${days} days ago`;
}

// "+15%" / "-8%" / "0%" -- progress_pct_delta (records.py) is the same
// recent-vs-prior est-1RM ratio the Progress score is built from, just
// unclamped and expressed as a signed percentage instead of a raw kg
// figure (2026-09-16, switched from kg since a flat "+5kg" reads very
// differently across muscle groups with wildly different absolute loads).
function formatPctDelta(pct) {
  if (pct == null) return null;
  const rounded = Math.round(pct);
  if (rounded === 0) return "0%";
  return (rounded > 0 ? "+" : "") + rounded + "%";
}

// Plain-language framing for the "Recent trend" detail rows (2026-09-15,
// ImIceTry's feedback: the raw percentages alone didn't mean anything beyond
// "small number is probably bad"). Each row keeps its number but adds a
// short qualitative label next to it instead of leaving the number to
// speak for itself.

// strength = recent best est-1RM as a fraction of your own all-time best
// on the same exercise(s) -- 100% is literally a lifetime PR right now.
function strengthLabel(pct) {
  if (pct >= 95) return "at your all-time best";
  if (pct >= 85) return "near your best";
  if (pct >= 65) return "below your best";
  return "well below your best";
}

// intensity = average %1RM lifted recently (how heavy relative to your
// own max). Bands follow the standard NSCA %1RM training-zone continuum
// -- 85%+ strength/near-max, 70-84% hypertrophy, 50-69% endurance,
// under 50% light/technique work -- collapsed to 4 plain words.
function intensityLabel(pct) {
  if (pct >= 85) return "heavy";
  if (pct >= 70) return "moderately heavy";
  if (pct >= 50) return "moderate";
  return "light";
}

// progress -- leads with the same real percentage number already on the
// map itself, not the clamped 0-100% ratio it used to show here (where
// 50% meant "flat," not "half of something bad" -- exactly the kind of
// number ImIceTry flagged as ungraspable). 2 points is the noise floor
// below which a swing isn't worth calling improving/declining.
function progressLabel(pctDelta) {
  if (pctDelta == null) return "not enough history yet";
  if (Math.abs(pctDelta) < 2) return "holding steady vs last month";
  return pctDelta > 0 ? "improving vs last month" : "declining vs last month";
}

// Body-anchor point per muscle (2026-09-15) -- where each progress-label's
// leader line starts on the silhouette itself, computed from the muscle's
// own traced path geometry, right-side fragment only, since both sides
// carry identical data (see the one-off script used to derive these).
// labelY is assigned dynamically at render time, not fixed here: which
// muscles actually have a progress number varies (no prior-period data ==
// no label), and spacing a fixed slot per muscle regardless of whether it
// renders left big empty gaps wherever a muscle in between had nothing to
// show. Spreading only the labels that actually appear across the full
// height, in the same top-to-bottom order as their real anchors, both
// fills the space evenly and guarantees leader lines never cross (two
// lines sharing one column can only cross if their label order disagrees
// with their anchor order).
const PROGRESS_LABEL_ANCHORS = {
  front: {
    neck: [18.2, 13.7],
    "front delts": [21.0, 14.6],
    "side delts": [24.5, 19.5],
    chest: [21.9, 21.5],
    biceps: [25.7, 26.8],
    forearms: [27.4, 37.0],
    "upper abs": [20.5, 29.0],
    obliques: [21.5, 37.0],
    "lower abs": [18.0, 40.0],
    quadriceps: [21.8, 51.2],
    adductors: [19.8, 51.2],
  },
  back: {
    traps: [57.9, 17.6],
    "rear delts": [63.1, 19.1],
    lats: [59.9, 25.3],
    triceps: [63.1, 25.6],
    forearms: [64.4, 35.1],
    "lower back": [57.2, 38.3],
    glutes: [58.3, 45.3],
    hamstrings: [57.7, 59.0],
    calves: [57.1, 76.7],
  },
};

// The straight-line splits added to hamstrings/calves (2026-09-15, ImIceTry's
// ask to break up the flat blocky pieces) are drawn at the same
// stroke-width as every other border by default, which made them barely
// register next to a shape's own outer outline. These are the exact same
// cut coordinates already baked into the shapes above (not a separate
// guess), just re-drawn on top with a much heavier stroke so the facet
// lines ImIceTry asked for actually read as intentional, not accidental.
// Calves' own cut lines removed 2026-09-16 (ImIceTry's ask) -- hamstrings'
// stay, calves render with just their plain shape outlines now.
const BACK_CUT_LINES = [
  "M 47.938,51.196 L 50.313,62.256",
  "M 47.799,51.204 L 46.614,62.791",
  "M 57.208,51.196 L 54.833,62.256",
  "M 57.347,51.204 L 58.532,62.791",
];

function renderMuscleMapBody(view, scores) {
  const regions = MUSCLE_MAP_REGIONS[view];
  const viewBox = view === "front" ? FRONT_VIEWBOX : BACK_VIEWBOX;

  // Faint full-silhouette base layer (every region, including neutral
  // ones) drawn underneath so the gaps between muscles still read as skin
  // rather than raw background -- same technique the source library uses.
  const base = regions.map((r) => `<path d="${r.d}" fill="#3a4657" opacity="0.18"/>`).join("");

  const shapes = regions
    .map((r) => {
      if (!r.muscle) {
        return `<path d="${r.d}" fill="#232b38" stroke="#1a212c" stroke-width="0.1"/>`;
      }
      const data = scores[r.muscle];
      const fill = muscleScoreColor(data ? data.score : 0);
      const title = data
        ? `${r.muscle} — ${formatDaysSince(data.days_since_trained)}`
        : `${r.muscle} — no data`;
      return `<path d="${r.d}" fill="${fill}" stroke="#1a212c" stroke-width="0.1"
                data-muscle="${r.muscle}" class="muscle-region"><title>${title}</title></path>`;
    })
    .join("");

  // Callout-style progress labels ("+15%") -- sit in the open right margin
  // (not on top of the body, which is what made the first version
  // cramped/overlapping), each connected back to its real muscle by a
  // plain leader line. Skipped entirely when there's no prior-period data
  // to diff against (progress_pct_delta null), same "don't fabricate a
  // number" rule the rest of this screen already follows.
  const COLUMN_X = { front: 37, back: 74 }[view];
  const anchors = PROGRESS_LABEL_ANCHORS[view] || {};
  const visible = Object.entries(anchors)
    .map(([muscle, bodyAnchor]) => {
      const data = scores[muscle];
      if (!data || data.progress_pct_delta == null) return null;
      const rounded = Math.round(data.progress_pct_delta);
      // Split rather than one plain string (2026-09-16, ImIceTry's ask -- line
      // these up on the sign and the "%" instead of left-aligned raw text,
      // which reads unevenly once some rows are "+5%" and others "-27%").
      // Rendered as separate fixed-position tspans below.
      const sign = rounded > 0 ? "+" : rounded < 0 ? "-" : "";
      // Zero-padded to 2 digits (2026-09-16, ImIceTry's ask) -- most values
      // are 1-2 digits (see the muscle-scores printout this was tuned
      // against: 5.5%, 16.7%, -1.4%, etc.), and a bare "5" left a visible
      // gap before the fixed-position "%" that made rows look empty/
      // inconsistently sized next to a row showing "16". 3-digit values
      // (the rare machine-jump case) just overflow past the padding as-is.
      const digits = String(Math.abs(rounded)).padStart(2, "0");
      return { muscle, bodyAnchor, sign, digits };
    })
    .filter(Boolean)
    // Sorted by each muscle's real anchor position -- assigning evenly
    // spread labelY values in this same order is what guarantees no two
    // leader lines cross (they'd only cross if a lower-anchored muscle's
    // label ended up above a higher-anchored one's).
    .sort((a, b) => a.bodyAnchor[1] - b.bodyAnchor[1]);

  const TOP = 10;
  const BOTTOM = 85;
  // Three fixed x-positions per row instead of one plain left-aligned
  // string (2026-09-16, ImIceTry's ask) -- sign left-aligned at COLUMN_X,
  // digits right-aligned against a fixed edge (so "5" and "27" both end at
  // the same x regardless of digit count), "%" left-aligned right after
  // that same fixed edge. Each tspan sets its own explicit x/text-anchor,
  // so this doesn't depend on monospace font metrics to line up.
  // Back down to +4 (2026-09-16, ImIceTry's ask -- keep the sign and number
  // close together; a genuine 3-digit swing is rare enough in practice not
  // to design the common 2-digit case around).
  const SIGN_X = COLUMN_X;
  const DIGITS_RIGHT_X = COLUMN_X + 4;
  const SUFFIX_X = DIGITS_RIGHT_X + 0.3;
  // Muscle name sits above its own percentage row (2026-09-16, ImIceTry's
  // ask), in the same muted gray as the tap-through detail panel's stat
  // rows below (.muscle-map-detail-row / .meta both use --text-secondary)
  // so it reads as a label, not another value.
  const NAME_OFFSET_Y = -3.2;
  const callouts = visible
    .map(({ bodyAnchor, sign, digits, muscle }, i) => {
      const labelY = visible.length === 1 ? (TOP + BOTTOM) / 2 : TOP + (i * (BOTTOM - TOP)) / (visible.length - 1);
      const [ax, ay] = bodyAnchor;
      return `
        <line x1="${COLUMN_X - 1}" y1="${labelY}" x2="${ax}" y2="${ay}" stroke="#8b96a5" stroke-width="0.3"/>
        <text x="${SIGN_X}" y="${labelY + NAME_OFFSET_Y}" text-anchor="start" class="muscle-map-progress-muscle-label">${escapeHtml(muscle)}</text>
        <text y="${labelY}" dominant-baseline="middle" class="muscle-map-progress-label"
              ><tspan x="${SIGN_X}" text-anchor="start">${sign}</tspan
              ><tspan x="${DIGITS_RIGHT_X}" text-anchor="end">${digits}</tspan
              ><tspan x="${SUFFIX_X}" text-anchor="start">%</tspan></text>
      `;
    })
    .join("");

  const cutLines =
    view === "back"
      ? BACK_CUT_LINES.map((d) => `<path d="${d}" fill="none" stroke="#1a212c" stroke-width="0.4" style="pointer-events:none"/>`).join("")
      : "";

  return `<svg viewBox="${viewBox}" class="muscle-map-svg">${base}${shapes}${cutLines}${callouts}</svg>`;
}

let muscleMapView = "front";

// Weekly working sets per muscle (2026-09-30, ImIceTry's pick from the review
// feature list) -- the unit hypertrophy volume guidance is stated in, shown
// against the usual 10-20 sets/week range. Counting rules live in
// muscle_scores.weekly_hard_sets (warm-ups skipped, drop pair = 1 set,
// secondary movers 0.5). Lists every muscle trained at some point, zeros
// included, so a skipped muscle group shows up as a gap instead of just
// being absent; never-trained library-only muscles (neck, abductors...) are
// left out as noise. Renders nothing against a backend without sets_7d.
const WEEKLY_SETS_LOW = 10;
const WEEKLY_SETS_HIGH = 20;
function renderWeeklySets(scores) {
  const el = document.getElementById("weekly-sets");
  if (!el) return;
  const rows = Object.entries(scores)
    .filter(([, d]) => d.sets_7d != null && (d.sets_7d > 0 || d.days_since_trained != null))
    .sort((a, b) => b[1].sets_7d - a[1].sets_7d || a[0].localeCompare(b[0]));
  if (!rows.length) {
    el.innerHTML = "";
    return;
  }
  const fmt = (n) => (Number.isInteger(n) ? String(n) : n.toFixed(1));
  el.innerHTML = `
    <div class="section-header"><h2>Sets This Week</h2></div>
    <div class="meta weekly-sets-caption">Working sets in the last 7 days. ${WEEKLY_SETS_LOW}&ndash;${WEEKLY_SETS_HIGH} per muscle is the usual range for growth.</div>
    ${rows.map(([muscle, d]) => {
      const n = d.sets_7d;
      const level = n < WEEKLY_SETS_LOW ? "low" : n > WEEKLY_SETS_HIGH ? "high" : "ok";
      const pct = Math.min(100, (n / WEEKLY_SETS_HIGH) * 100);
      return `<div class="weekly-sets-row">
        <span class="weekly-sets-name">${escapeHtml(muscle)}</span>
        <span class="weekly-sets-track"><span class="weekly-sets-fill ${level}" style="width: ${pct}%"></span></span>
        <span class="weekly-sets-value ${level}">${fmt(n)}</span>
      </div>`;
    }).join("")}
  `;
}

async function renderMuscleMap() {
  const container = document.getElementById("muscle-map");
  if (!container) return;
  container.innerHTML = skeletonHtml(3);
  let scores = {};
  try {
    const data = await apiGet("/api/muscle-scores");
    scores = data.muscles;
    renderWeeklySets(scores);
  } catch (err) {
    container.innerHTML = "<div class='meta'>Can't load muscle stats right now (offline?).</div>";
    return;
  }

  const view = muscleMapView;
  container.innerHTML = `
    <div class="muscle-map-toggle">
      <button class="muscle-map-toggle-btn${view === "front" ? " active" : ""}" data-view="front">Front</button>
      <button class="muscle-map-toggle-btn${view === "back" ? " active" : ""}" data-view="back">Back</button>
    </div>
    <div class="muscle-map-body">${renderMuscleMapBody(view, scores)}</div>
    <div id="muscle-map-detail" class="muscle-map-detail"></div>
  `;

  container.querySelectorAll(".muscle-map-toggle-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      muscleMapView = btn.dataset.view;
      renderMuscleMap();
    });
  });

  container.querySelectorAll(".muscle-region").forEach((el) => {
    el.addEventListener("click", () => {
      const muscle = el.dataset.muscle;
      const data = scores[muscle];
      const detailEl = document.getElementById("muscle-map-detail");
      if (!data) {
        detailEl.innerHTML = `<div class="muscle-map-detail-title">${escapeHtml(muscle)}</div><div class="meta">No data for this muscle group.</div>`;
        return;
      }
      const lastLine = data.last_trained_exercise
        ? `${formatDaysSince(data.days_since_trained)} — ${escapeHtml(data.last_trained_exercise)}`
        : "Never trained";
      const strengthText =
        data.strength != null
          ? `${Math.round(data.strength * 100)}% — ${strengthLabel(data.strength * 100)}`
          : "—";
      const intensityText =
        data.intensity != null
          ? `${Math.round(data.intensity * 100)}% — ${intensityLabel(data.intensity * 100)}`
          : "—";
      const pctDelta = formatPctDelta(data.progress_pct_delta);
      const progressText = pctDelta != null ? `${pctDelta} — ${progressLabel(data.progress_pct_delta)}` : progressLabel(null);
      detailEl.innerHTML = `
        <div class="muscle-map-detail-title">${escapeHtml(muscle)}</div>
        <div class="muscle-map-detail-row"><span>Last trained</span><span>${lastLine}</span></div>
        <div class="muscle-map-detail-subhead">Recent trend</div>
        <div class="muscle-map-detail-row"><span>Strength</span><span>${strengthText}</span></div>
        <div class="muscle-map-detail-row"><span>Intensity</span><span>${intensityText}</span></div>
        <div class="muscle-map-detail-row"><span>Progress</span><span>${progressText}</span></div>
      `;
    });
  });
}
