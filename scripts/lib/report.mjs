// Pass/fail lines with timing for the black-box checks (smoke, e2e-upload).

const color = process.stdout.isTTY
  ? (code, text) => `\u001b[${code}m${text}\u001b[0m`
  : (_code, text) => text

export function createReport() {
  let failures = 0

  /**
   * Runs one check and prints its outcome. `fn` returns an optional detail
   * string; throwing fails the check. Returns the detail, or undefined on
   * failure, so dependent checks can be skipped.
   */
  async function check(name, fn) {
    const started = performance.now()
    try {
      const result = await fn()
      const ms = Math.round(performance.now() - started)
      console.log(`${color(32, 'PASS')} ${name} (${ms} ms)${result ? ` — ${result}` : ''}`)
      return result ?? ''
    } catch (error) {
      const ms = Math.round(performance.now() - started)
      failures += 1
      console.log(`${color(31, 'FAIL')} ${name} (${ms} ms) — ${error.message}`)
      return undefined
    }
  }

  function warn(name, message) {
    console.log(`${color(33, 'WARN')} ${name} — ${message}`)
  }

  function skip(name, message) {
    failures += 1
    console.log(`${color(31, 'FAIL')} ${name} — skipped: ${message}`)
  }

  return {
    check,
    warn,
    skip,
    get failures() {
      return failures
    },
  }
}
