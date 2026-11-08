// deliberately failing test: proves the GitHub check can go red. Branch is deleted right after.
console.log("FAIL on purpose");
process.exitCode = 1;
