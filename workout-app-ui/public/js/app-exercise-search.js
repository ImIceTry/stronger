// ---------- exercise search: forgiving matching + ranking by use (2026-10-03) ----------
//
// Replaces the old strict `name LIKE %typed%` / `.includes(typed)` matching
// (ImIceTry: "crunches" and "crunch mac" both missed "Crunch (Machine)", and
// results came out alphabetical no matter how often he'd done them).
//
// Matching, best tier first:
//   0  the whole name equals the query (ignoring case/punctuation)
//   1  every typed word is the start of some word in the name, any order --
//      case, parentheses, hyphens and a plural "s"/"es" are ignored, so
//      "crunches" and "crunch mac" both find "Crunch (Machine)"
//   2  every typed word appears somewhere inside the name (the old
//      substring behavior, kept so "ench" still finds "Bench Press")
//   3  typo fallback, ONLY used when nothing matched above: a typed word of
//      4+ letters may be one edit (wrong/missing/extra letter, or two
//      swapped) away from a name word, so "curnch" still finds "Crunch"
// Inside a tier, exercises ImIceTry has actually done come first, ranked by
// how recently and how often (never-done library entries last), then A-Z.
// With nothing typed it returns his most recently/often done exercises.

function normalizeExerciseText(s) {
  return String(s || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

// Crude plural trimming -- only has to make "crunches"/"crunch" and
// "curls"/"curl" meet, not be real linguistics. Prefix matching covers the rest.
function stemExerciseWord(w) {
  if (w.length <= 3) return w;
  if (w.length > 4 && w.endsWith("ies")) return w.slice(0, -3) + "y";
  if (/(ch|sh|s|x|z)es$/.test(w)) return w.slice(0, -2);
  if (w.endsWith("s") && !w.endsWith("ss")) return w.slice(0, -1);
  return w;
}

// True when a and b differ by at most one substitution, insertion, deletion
// or swap of two neighbouring letters.
function withinOneEdit(a, b) {
  if (a === b) return true;
  const la = a.length;
  const lb = b.length;
  if (Math.abs(la - lb) > 1) return false;
  let i = 0;
  while (i < la && i < lb && a[i] === b[i]) i++;
  if (la === lb) {
    if (a.slice(i + 1) === b.slice(i + 1)) return true; // one substituted letter
    return a[i] === b[i + 1] && a[i + 1] === b[i] && a.slice(i + 2) === b.slice(i + 2); // swapped pair
  }
  return la < lb ? a.slice(i) === b.slice(i + 1) : a.slice(i + 1) === b.slice(i); // one missing/extra letter
}

// Bigger = more worth showing first. Never done -> 0. Done: a base point
// plus a bonus for how often (log, so 40 sessions isn't 40x better than 1)
// plus a bonus that fades over about three weeks since the last session.
function exerciseUsageScore(e, now) {
  const times = e.times_performed || 0;
  if (times <= 0) return 0;
  let recency = 0;
  if (e.last_performed) {
    const t = new Date(String(e.last_performed).replace(" ", "T")).getTime();
    if (!Number.isNaN(t)) recency = 2 * Math.exp(-Math.max(0, now - t) / (21 * 86400000));
  }
  return 1 + Math.log2(1 + times) + recency;
}

function rankExercises(query, exercises, limit) {
  limit = limit || 20;
  const now = Date.now();
  const q = normalizeExerciseText(query);
  const byScore = (a, b) => (b.score - a.score) || a.e.name.localeCompare(b.e.name);

  if (!q) {
    return exercises
      .map((e) => ({ e, score: exerciseUsageScore(e, now) }))
      .filter((x) => x.score > 0)
      .sort(byScore)
      .slice(0, limit)
      .map((x) => x.e);
  }

  const qWords = q.split(" ");
  const qStems = qWords.map(stemExerciseWord);
  const prepared = exercises.map((e) => {
    const norm = normalizeExerciseText(e.name);
    return { e, norm, stems: norm.split(" ").map(stemExerciseWord), score: exerciseUsageScore(e, now) };
  });

  const tiers = [[], [], [], []];
  for (const p of prepared) {
    if (p.norm === q) {
      tiers[0].push(p);
    } else if (qStems.every((qs) => p.stems.some((ns) => ns.startsWith(qs)))) {
      if (p.norm.startsWith(q)) p.score += 1; // typed the beginning of the name
      tiers[1].push(p);
    } else if (qWords.every((w) => p.norm.includes(w))) {
      tiers[2].push(p);
    }
  }
  if (!tiers[0].length && !tiers[1].length && !tiers[2].length) {
    for (const p of prepared) {
      const close = qStems.every((qs) => p.stems.some((ns) =>
        ns.startsWith(qs) || (qs.length >= 4 && (withinOneEdit(qs, ns) || withinOneEdit(qs, ns.slice(0, qs.length))))));
      if (close) tiers[3].push(p);
    }
  }

  const out = [];
  for (const tier of tiers) {
    tier.sort(byScore);
    for (const p of tier) {
      out.push(p.e);
      if (out.length >= limit) return out;
    }
  }
  return out;
}

// Shared by every exercise search box. Reuses the list the Exercises tab
// already caches (it carries times_performed/last_performed, and the cache is
// cleared whenever a workout is saved), so searching costs no request per key.
async function loadAllExercisesCached() {
  if (!allExercisesCache) {
    const data = await apiGet("/api/exercises/all");
    allExercisesCache = data.exercises;
  }
  return allExercisesCache;
}
