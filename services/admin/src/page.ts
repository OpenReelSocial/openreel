import type { StatusReport } from './checks.ts'

/** Detail strings originate from network responses, so they are escaped. */
function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

const STYLES = `
  :root {
    color-scheme: light dark;
    --bg: #fbfbfa;
    --panel: #ffffff;
    --line: #e4e4e1;
    --ink: #1a1a18;
    --muted: #6b6b66;
    --up: #1f8a4c;
    --down: #c02a2a;
  }
  @media (prefers-color-scheme: dark) {
    :root {
      --bg: #131312;
      --panel: #1c1c1a;
      --line: #2e2e2b;
      --ink: #f0efec;
      --muted: #9a9a93;
      --up: #46c07a;
      --down: #f0685f;
    }
  }
  * { box-sizing: border-box; }
  body {
    margin: 0;
    padding: 3rem 1.25rem;
    background: var(--bg);
    color: var(--ink);
    font: 15px/1.5 ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif;
    display: flex;
    justify-content: center;
  }
  main { width: 100%; max-width: 42rem; }
  header { margin-bottom: 1.75rem; }
  h1 {
    margin: 0 0 .35rem;
    font-size: .8125rem;
    font-weight: 600;
    letter-spacing: .08em;
    text-transform: uppercase;
    color: var(--muted);
  }
  .banner { font-size: 1.5rem; font-weight: 600; letter-spacing: -.02em; }
  .banner[data-all-up='true'] { color: var(--up); }
  .banner[data-all-up='false'] { color: var(--down); }
  ul {
    margin: 0;
    padding: 0;
    list-style: none;
    background: var(--panel);
    border: 1px solid var(--line);
    border-radius: 10px;
    overflow: hidden;
  }
  li {
    display: grid;
    grid-template-columns: auto 1fr auto;
    gap: .875rem;
    align-items: center;
    padding: .9375rem 1.125rem;
    border-top: 1px solid var(--line);
  }
  li:first-child { border-top: 0; }
  .dot { width: .5rem; height: .5rem; border-radius: 50%; }
  [data-status='up'] .dot { background: var(--up); }
  [data-status='down'] .dot { background: var(--down); }
  .name { font-weight: 550; }
  .role { color: var(--muted); font-size: .8125rem; }
  .meta {
    text-align: right;
    font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
    font-size: .75rem;
    color: var(--muted);
    white-space: nowrap;
  }
  [data-status='down'] .meta strong { color: var(--down); }
  footer { margin-top: 1.25rem; color: var(--muted); font-size: .75rem; }
  a { color: inherit; }
`

/** Renders the status page. Self-contained: no build step, no assets, no client JS. */
export function renderStatusPage(report: StatusReport, refreshSeconds: number): string {
  const down = report.results.filter((r) => r.status === 'down')
  const banner = report.allUp
    ? 'All services operational'
    : `${down.length} of ${report.results.length} services down`

  const rows = report.results
    .map(
      (r) => `      <li data-status="${r.status}">
        <span class="dot" aria-hidden="true"></span>
        <span>
          <div class="name">${escapeHtml(r.name)}</div>
          <div class="role">${escapeHtml(r.role)}</div>
        </span>
        <span class="meta"><strong>${escapeHtml(r.detail)}</strong> &middot; ${r.latencyMs}ms</span>
      </li>`,
    )
    .join('\n')

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta http-equiv="refresh" content="${refreshSeconds}">
  <title>OpenReel status${report.allUp ? '' : ' - degraded'}</title>
  <style>${STYLES}</style>
</head>
<body>
  <main>
    <header>
      <h1>OpenReel &middot; local development</h1>
      <div class="banner" data-all-up="${String(report.allUp)}">${banner}</div>
    </header>
    <ul>
${rows}
    </ul>
    <footer>
      Checked ${escapeHtml(report.checkedAt)} &middot; refreshes every ${refreshSeconds}s &middot;
      <a href="/api/status">JSON</a>
    </footer>
  </main>
</body>
</html>
`
}
