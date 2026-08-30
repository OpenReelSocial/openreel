/** Reads a required numeric environment variable, falling back to a default. */
export function readPort(envValue: string | undefined, fallback: number): number {
  if (envValue === undefined || envValue === '') return fallback

  const parsed = Number(envValue)
  if (!Number.isInteger(parsed) || parsed <= 0 || parsed > 65535) {
    throw new Error(`Invalid PORT: expected an integer in 1-65535, received "${envValue}"`)
  }
  return parsed
}
