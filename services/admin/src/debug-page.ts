/**
 * The debug portal: a live view of what the backend is doing, for local
 * development and demos. Static HTML; the script reads two endpoints:
 *
 * - `/debug/api/queries`: every SQL statement services run, as server-sent
 *   events (services must run with DEBUG_QUERY_TAP=1);
 * - `/debug/api/snapshot`: pipeline state, polled every two seconds.
 *
 * Everything from the server is inserted with textContent, never as HTML.
 */
export function renderDebugPage(databaseConfigured: boolean): string {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>OpenReel · Debug</title>
<style>${STYLES}</style>
</head>
<body>
<header>
  <div class="title">
    <span class="logo">●</span>
    <div>
      <h1>OpenReel live pipeline</h1>
      <p class="sub">Every database call the backend makes, as it happens. <a href="/">Service status</a></p>
    </div>
  </div>
  <div id="services" class="services"></div>
</header>
${
  databaseConfigured
    ? ''
    : '<p class="notice">The admin service has no DATABASE_URL, so there is nothing to show. Set it and restart.</p>'
}
<section id="tiles" class="tiles"></section>
<main>
  <section class="panel stream-panel">
    <div class="panel-head">
      <h2>SQL stream</h2>
      <div class="controls">
        <span id="filters"></span>
        <button id="pause" type="button">Pause</button>
        <button id="clear" type="button">Clear</button>
      </div>
    </div>
    <p id="stream-hint" class="hint">Waiting for queries. Services only report them when run with DEBUG_QUERY_TAP=1 (on by default in the local Compose stack).</p>
    <ol id="stream" class="stream"></ol>
  </section>
  <div class="side">
    <section class="panel">
      <div class="panel-head"><h2>Most viewed</h2><span class="hint">video_post_stats</span></div>
      <ol id="most-viewed" class="bars"></ol>
    </section>
    <section class="panel">
      <div class="panel-head"><h2>Latest watch events</h2><span class="hint">watch_event</span></div>
      <ol id="watches" class="rows"></ol>
    </section>
    <section class="panel">
      <div class="panel-head"><h2>Transcode jobs</h2><span class="hint">video_media</span></div>
      <ol id="jobs" class="rows"></ol>
    </section>
  </div>
</main>
<script>${SCRIPT}</script>
</body>
</html>`
}

const STYLES = `
  :root {
    --bg: #0b0c0e;
    --panel: #121418;
    --line: #23262d;
    --ink: #e8e9ec;
    --muted: #868b96;
    --appview: #5aa9ff;
    --feedgen: #c38bff;
    --media: #ffb454;
    --other: #8fd18f;
    --hot: #46d39a;
    --bad: #ff6b6b;
    --mono: ui-monospace, "SF Mono", Menlo, Consolas, monospace;
  }
  * { box-sizing: border-box; }
  body {
    margin: 0;
    padding: 1.5rem;
    background: var(--bg);
    color: var(--ink);
    font: 14px/1.45 ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif;
  }
  a { color: var(--muted); }
  header { display: flex; flex-wrap: wrap; gap: 1rem; justify-content: space-between; align-items: center; margin-bottom: 1.25rem; }
  .title { display: flex; gap: .75rem; align-items: center; }
  .logo { color: var(--hot); font-size: 1.4rem; animation: breathe 2.4s ease-in-out infinite; }
  @keyframes breathe { 50% { opacity: .35; } }
  h1 { margin: 0; font-size: 1.15rem; letter-spacing: -.01em; }
  .sub { margin: .1rem 0 0; color: var(--muted); font-size: .85rem; }
  h2 { margin: 0; font-size: .75rem; letter-spacing: .08em; text-transform: uppercase; color: var(--muted); }
  .notice { padding: .75rem 1rem; border: 1px solid var(--bad); border-radius: 8px; color: var(--bad); }
  .hint { color: var(--muted); font-size: .8rem; margin: 0; }

  .services { display: flex; gap: .5rem; flex-wrap: wrap; }
  .svc {
    display: flex; align-items: center; gap: .5rem;
    padding: .4rem .75rem; border: 1px solid var(--line); border-radius: 999px;
    background: var(--panel); font-family: var(--mono); font-size: .8rem;
  }
  .svc .dot { width: .55rem; height: .55rem; border-radius: 50%; background: var(--c); opacity: .25; transition: opacity .6s, box-shadow .6s; }
  .svc.ping .dot { opacity: 1; box-shadow: 0 0 10px var(--c); transition: none; }
  .svc .rate { color: var(--muted); }

  .tiles { display: grid; grid-template-columns: repeat(auto-fit, minmax(9.5rem, 1fr)); gap: .75rem; margin-bottom: 1rem; }
  .tile { background: var(--panel); border: 1px solid var(--line); border-radius: 10px; padding: .75rem .9rem; }
  .tile .value { font-size: 1.6rem; font-weight: 600; font-variant-numeric: tabular-nums; letter-spacing: -.02em; }
  .tile .label { color: var(--muted); font-size: .78rem; }
  .tile.bump .value { animation: bump .8s ease-out; }
  @keyframes bump { 0% { color: var(--hot); transform: translateY(-2px); } }

  main { display: grid; grid-template-columns: minmax(0, 1.6fr) minmax(0, 1fr); gap: 1rem; align-items: start; }
  @media (max-width: 960px) { main { grid-template-columns: 1fr; } }
  .side { display: grid; gap: 1rem; }
  .panel { background: var(--panel); border: 1px solid var(--line); border-radius: 10px; padding: .9rem 1rem; }
  .panel-head { display: flex; justify-content: space-between; align-items: center; gap: .75rem; margin-bottom: .7rem; flex-wrap: wrap; }
  .controls { display: flex; gap: .4rem; align-items: center; flex-wrap: wrap; }
  button, .chip {
    font: inherit; font-size: .78rem; color: var(--ink); background: transparent;
    border: 1px solid var(--line); border-radius: 6px; padding: .2rem .55rem; cursor: pointer;
  }
  .chip { border-color: var(--c); color: var(--c); }
  .chip.off { opacity: .35; }
  button[aria-pressed="true"] { border-color: var(--media); color: var(--media); }

  .stream { list-style: none; margin: 0; padding: 0; height: calc(100vh - 17rem); min-height: 24rem; overflow-y: auto; font-family: var(--mono); font-size: .78rem; }
  .q { border-left: 3px solid var(--c); padding: .4rem .6rem; margin-bottom: .35rem; background: #0e1013; border-radius: 0 6px 6px 0; animation: enter .5s ease-out; }
  @keyframes enter { from { background: #1b2a22; transform: translateX(-4px); } }
  .q .meta { display: flex; gap: .6rem; color: var(--muted); margin-bottom: .2rem; }
  .q .svc-name { color: var(--c); font-weight: 600; }
  .q .ms.slow { color: var(--media); }
  .q .count { color: var(--hot); }
  .q .sql { white-space: pre-wrap; word-break: break-word; }
  .q .kw { color: var(--c); font-weight: 600; }
  .q .params { color: var(--muted); margin-top: .2rem; word-break: break-all; }
  .q.error { border-left-color: var(--bad); }
  .q .err { color: var(--bad); }

  .bars, .rows { list-style: none; margin: 0; padding: 0; display: grid; gap: .45rem; }
  .bar { position: relative; padding: .35rem .55rem; border-radius: 6px; overflow: hidden; }
  .bar .fill { position: absolute; inset: 0; width: var(--w); background: linear-gradient(90deg, #1d3b2f, #1a2e27); transition: width .8s ease; z-index: 0; }
  .bar > span { position: relative; z-index: 1; }
  .bar .n { float: right; font-variant-numeric: tabular-nums; font-weight: 600; }
  .row { font-size: .82rem; padding: .3rem 0; border-bottom: 1px solid var(--line); }
  .row:last-child { border-bottom: 0; }
  .row .muted { color: var(--muted); }
  .row.new { animation: enter 1.2s ease-out; }
  .pill { font-family: var(--mono); font-size: .72rem; padding: .05rem .4rem; border-radius: 4px; border: 1px solid currentColor; }
  .pill.ready { color: var(--hot); } .pill.pending { color: var(--muted); }
  .pill.processing { color: var(--media); } .pill.failed { color: var(--bad); }
  .empty { color: var(--muted); font-size: .82rem; }
`

const SCRIPT = `
(() => {
  const SERVICES = { appview: 'var(--appview)', feedgen: 'var(--feedgen)', media: 'var(--media)' }
  const color = (s) => SERVICES[s] || 'var(--other)'
  const KEYWORDS = /\\b(select|insert into|update|delete from|from|where|join|inner join|left join|on conflict|do update set|do nothing|values|returning|order by|group by|limit|offset|and|or|as|set|with|for update|skip locked|count|distinct)\\b/gi
  const $ = (id) => document.getElementById(id)
  const el = (tag, cls, text) => {
    const node = document.createElement(tag)
    if (cls) node.className = cls
    if (text !== undefined) node.textContent = text
    return node
  }

  // Service activity lights and per-minute rates.
  const seen = {}
  const hidden = new Set()
  function service(name) {
    if (seen[name]) return seen[name]
    const chip = el('span', 'svc')
    chip.style.setProperty('--c', color(name))
    const rate = el('span', 'rate', '0/min')
    chip.append(el('span', 'dot'), el('span', '', name), rate)
    $('services').append(chip)
    const filter = el('button', 'chip', name)
    filter.type = 'button'
    filter.style.setProperty('--c', color(name))
    filter.onclick = () => {
      hidden.has(name) ? hidden.delete(name) : hidden.add(name)
      filter.classList.toggle('off', hidden.has(name))
      for (const item of $('stream').children) item.hidden = hidden.has(item.dataset.service)
    }
    $('filters').append(filter)
    return (seen[name] = { chip, rate, times: [] })
  }
  function updateRate(s) {
    const cutoff = Date.now() - 60000
    s.times = s.times.filter((t) => t > cutoff)
    s.rate.textContent = s.times.length + '/min'
  }
  setInterval(() => Object.values(seen).forEach(updateRate), 1000)

  function highlight(target, sql) {
    let last = 0
    for (const match of sql.matchAll(KEYWORDS)) {
      target.append(sql.slice(last, match.index))
      target.append(el('span', 'kw', match[0]))
      last = match.index + match[0].length
    }
    target.append(sql.slice(last))
  }

  // SQL stream. Identical consecutive statements from one service (polling,
  // cursor saves) collapse into one entry with a count.
  let paused = false
  let previous = null
  const MAX_ITEMS = 300
  function addQuery(q) {
    const s = service(q.service)
    // Count by when the query ran, so the backlog a new page receives counts too.
    s.times.push(Date.parse(q.at) || Date.now())
    updateRate(s)
    s.chip.classList.add('ping')
    setTimeout(() => s.chip.classList.remove('ping'), 120)
    if (paused) return
    $('stream-hint').hidden = true

    if (previous && previous.sql === q.sql && previous.service === q.service && !q.error) {
      previous.count += 1
      previous.countNode.textContent = '×' + previous.count
      previous.msNode.textContent = q.durationMs + ' ms'
      previous.paramsNode.textContent = q.params.length ? 'params: ' + q.params.join(', ') : ''
      return
    }

    const item = el('li', 'q' + (q.error ? ' error' : ''))
    item.dataset.service = q.service
    item.style.setProperty('--c', color(q.service))
    item.hidden = hidden.has(q.service)
    const meta = el('div', 'meta')
    const ms = el('span', 'ms' + (q.durationMs > 20 ? ' slow' : ''), q.durationMs + ' ms')
    const count = el('span', 'count', '')
    meta.append(el('span', 'svc-name', q.service), el('span', '', new Date(q.at).toLocaleTimeString()), ms, count)
    const sqlNode = el('div', 'sql')
    highlight(sqlNode, q.sql.replace(/\\s+/g, ' ').trim())
    const params = el('div', 'params', q.params.length ? 'params: ' + q.params.join(', ') : '')
    item.append(meta, sqlNode, params)
    if (q.error) item.append(el('div', 'err', q.error))
    $('stream').prepend(item)
    while ($('stream').children.length > MAX_ITEMS) $('stream').lastElementChild.remove()
    previous = { sql: q.sql, service: q.service, count: 1, countNode: count, msNode: ms, paramsNode: params }
  }

  $('pause').onclick = (event) => {
    paused = !paused
    event.target.setAttribute('aria-pressed', String(paused))
    event.target.textContent = paused ? 'Resume' : 'Pause'
  }
  $('clear').onclick = () => { $('stream').replaceChildren(); previous = null }

  const source = new EventSource('/debug/api/queries')
  source.onmessage = (event) => addQuery(JSON.parse(event.data))

  // Pipeline snapshot.
  const tileValues = {}
  function tile(key, label, value) {
    let node = document.querySelector('[data-tile="' + key + '"]')
    if (!node) {
      node = el('div', 'tile')
      node.dataset.tile = key
      node.append(el('div', 'value'), el('div', 'label', label))
      $('tiles').append(node)
    }
    const text = String(value)
    if (tileValues[key] !== undefined && tileValues[key] !== text) {
      node.classList.remove('bump'); void node.offsetWidth; node.classList.add('bump')
    }
    tileValues[key] = text
    node.firstChild.textContent = text
  }

  const ago = (iso) => {
    const s = Math.max(0, Math.round((Date.now() - new Date(iso)) / 1000))
    return s < 60 ? s + 's ago' : s < 3600 ? Math.round(s / 60) + 'm ago' : Math.round(s / 3600) + 'h ago'
  }
  const short = (text, n) => !text ? '' : text.length > n ? text.slice(0, n - 1) + '…' : text
  const post = (caption, uri) => caption ? '“' + short(caption, 40) + '”' : uri ? uri.split('/').pop() : '(unindexed post)'
  const who = (handle, did) => handle ? '@' + handle : short(did, 22)

  let knownWatches = new Set()
  function render(snap) {
    const c = snap.counts || {}
    tile('posts', 'video posts', c.posts ?? 0)
    tile('ready', 'playable (transcoded)', snap.media.ready ?? 0)
    tile('queue', 'transcodes queued', (snap.media.pending ?? 0) + (snap.media.processing ?? 0))
    tile('watches', 'watch events', c.watchEvents ?? 0)
    tile('viewers', 'viewers sharing', c.viewers ?? 0)
    const jet = snap.cursors.find((x) => x.name.includes('jetstream'))
    tile('lag', 'last firehose event', jet ? ago(jet.eventAt) : 'none')

    const top = snap.mostViewed[0] ? Number(snap.mostViewed[0].view_count) : 0
    $('most-viewed').replaceChildren(...(snap.mostViewed.length ? snap.mostViewed.map((r) => {
      const item = el('li', 'bar')
      item.style.setProperty('--w', (top ? (Number(r.view_count) / top) * 100 : 0) + '%')
      const completion = r.avg_completion_rate == null ? '' : ' · ' + Math.round(r.avg_completion_rate * 100) + '% avg watched'
      item.append(el('span', 'fill'), el('span', 'n', r.view_count), el('span', '', post(r.caption, r.uri)), el('span', 'muted', ' ' + who(r.handle, '') + completion))
      return item
    }) : [el('li', 'empty', 'No views yet. Turn on Share Watch History in the app and watch something.')]))

    const fresh = new Set(snap.recentWatches.map((w) => w.uri))
    $('watches').replaceChildren(...(snap.recentWatches.length ? snap.recentWatches.map((w) => {
      const item = el('li', 'row' + (knownWatches.size && !knownWatches.has(w.uri) ? ' new' : ''))
      const pct = w.completion_rate == null ? '' : ' · ' + Math.round(w.completion_rate * 100) + '%'
      const loops = w.rewatch_count ? ' · looped ' + w.rewatch_count + '×' : ''
      item.append(
        el('span', '', who(w.viewer, w.actor_did) + ' watched ' + post(w.caption, null)),
        el('div', 'muted', (w.watch_duration_ms / 1000).toFixed(1) + 's' + pct + loops + ' · indexed ' + ago(w.indexed_at)),
      )
      return item
    }) : [el('li', 'empty', 'None yet.')]))
    knownWatches = fresh

    $('jobs').replaceChildren(...(snap.recentJobs.length ? snap.recentJobs.map((j) => {
      const item = el('li', 'row')
      item.append(el('span', 'pill ' + j.status, j.status), el('span', '', ' ' + short(j.video_cid, 24)))
      item.append(el('div', 'muted', 'attempt ' + j.attempts + ' · ' + ago(j.updated_at) + (j.last_error ? ' · ' + short(j.last_error, 80) : '')))
      return item
    }) : [el('li', 'empty', 'No uploads yet.')]))
  }

  async function poll() {
    try {
      const res = await fetch('/debug/api/snapshot')
      if (res.ok) render(await res.json())
    } catch {}
    setTimeout(poll, 2000)
  }
  poll()
})()
`
