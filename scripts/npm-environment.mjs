/** Normalize the legacy alias sometimes injected by the hosting environment. */
/** @param {Record<string, string | undefined>} original */
export function npmEnvironment(original) {
  const env = { ...original };
  let legacyCache;
  for (const key of Object.keys(env)) {
    if (key.toLowerCase() === "npm_config_cache_dir") {
      legacyCache ??= env[key];
      delete env[key];
    }
  }
  if (
    legacyCache &&
    !Object.keys(env).some(
      (key) => key.toLowerCase() === "npm_config_cache" && env[key],
    )
  ) {
    env.npm_config_cache = legacyCache;
  }
  return env;
}
