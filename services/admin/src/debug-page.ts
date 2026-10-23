/**
 * The debug system map: OpenReel's servers, drawn by who owns the data, with
 * each request, firehose event, and transcode job replayed step by step. For
 * local development and demos. Static HTML; the script reads two endpoints:
 *
 * - `/debug/api/stream`: assembled traces and background counts, as
 *   server-sent events (services must run with DEBUG_QUERY_TAP=1);
 * - `/debug/api/snapshot`: row counts for the tables on the map, polled.
 *
 * Everything from the server is inserted with textContent, never as HTML.
 */
export function renderDebugPage(databaseConfigured: boolean): string {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>OpenReel · Where your data goes</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=IBM+Plex+Mono:wght@400;500&family=IBM+Plex+Sans+Condensed:wght@500;600&family=IBM+Plex+Sans:wght@400;500;600&display=swap" rel="stylesheet">
<style>${STYLES}</style>
</head>
<body>
<div class="page">
  <header>
    <h1>Where your data goes
      <small>Requests between OpenReel's servers and the data each one touches.</small>
    </h1>
    <p class="where"><a href="/">Service status</a></p>
  </header>
${
  databaseConfigured
    ? ''
    : '  <p class="notice">The admin service has no DATABASE_URL, so there is nothing to show. Set it and restart.</p>\n'
}
  <div class="layout">
    <div>
${MAP}
      <div class="player">
        <div class="controls" role="group" aria-label="Replay">
          <button id="back" type="button" aria-label="Back one step" title="Back one step (←)" aria-keyshortcuts="ArrowLeft"><svg viewBox="0 0 16 16" aria-hidden="true"><path d="M3 3v10M13 3 5 8l8 5z"/></svg></button>
          <button id="play" class="live" type="button" aria-label="Pause" title="Pause (Space)" aria-keyshortcuts="Space"><svg viewBox="0 0 16 16" aria-hidden="true"><path class="pause" d="M4 3h3v10H4zM9 3h3v10H9z"/><path class="play" d="M4 2.5v11L13 8z"/></svg></button>
          <button id="forward" type="button" aria-label="Forward one step" title="Forward one step (→)" aria-keyshortcuts="ArrowRight"><svg viewBox="0 0 16 16" aria-hidden="true"><path d="M13 3v10M3 3l8 5-8 5z"/></svg></button>
          <span id="queue" class="queue"></span>
          <span class="keys">Space · ← →</span>
        </div>
        <div id="caption" class="caption" aria-live="polite">
          <p class="idle">Waiting for activity. Open the app and scroll the feed, like a video, or post one.</p>
        </div>
      </div>
      <p class="key">
        <span><svg viewBox="0 0 28 6"><path d="M0,3 H28" stroke="#3d4fd6" stroke-width="2.5"/></svg>Reported by our services</span>
        <span><svg viewBox="0 0 28 6"><path d="M0,3 H28" stroke="#3d4fd6" stroke-width="2.5" stroke-dasharray="5 4"/></svg>Inferred from a later event</span>
        <span><svg viewBox="0 0 28 6"><path d="M0,3 H28" stroke="#9aa3ad" stroke-width="1.25" stroke-dasharray="4 4"/></svg>Happens, but we can't see it</span>
      </p>
    </div>

    <aside>
      <div class="aside-head">
        <h2>Activity</h2>
        <span>Newest first</span>
      </div>
      <p id="background" class="background"></p>
      <ol id="traces"></ol>
    </aside>
  </div>
</div>
<script>${SCRIPT}</script>
</body>
</html>`
}

const MAP = `      <svg id="map" viewBox="0 0 1000 600" role="img" aria-label="Map of OpenReel's servers and the requests between them">
        <defs>
          <marker id="arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
            <path d="M0,1 L9,5 L0,9" fill="none" stroke="context-stroke" stroke-width="1.5"/>
          </marker>
        </defs>
        <g class="zone yours">
          <rect x="180" y="30" width="260" height="370" rx="10"/>
          <text class="tab" x="196" y="54">Owned by you</text>
          <text class="tab-note" x="196" y="388">Moves with you to any AT Protocol app</text>
        </g>
        <g class="zone openreel">
          <rect x="650" y="30" width="330" height="545" rx="10"/>
          <text class="tab" x="666" y="54">Run by OpenReel</text>
          <text class="tab-note" x="964" y="54" text-anchor="end">A copy, rebuilt from the relay</text>
        </g>
        <g class="zone delivery">
          <rect x="20" y="430" width="610" height="145" rx="10"/>
          <text class="tab" x="36" y="454">Video delivery</text>
        </g>
        <g id="edges"></g>
        <g class="node" id="n-client">
          <rect x="20" y="170" width="130" height="80" rx="6"/>
          <text class="title" x="34" y="196">Your phone</text>
          <text class="tech" x="34" y="214">OpenReel iOS</text>
        </g>
        <g class="node" id="n-pds">
          <rect x="200" y="70" width="220" height="150" rx="6"/>
          <text class="title" x="214" y="96">Your data server</text>
          <text class="tech" x="214" y="114">PDS</text>
          <text class="line" x="214" y="146">Posts, likes, views <tspan>records</tspan></text>
          <text class="line" x="214" y="168">Original videos <tspan>blobs</tspan></text>
          <text class="line" x="214" y="190">Signed by your key</text>
        </g>
        <g class="node" id="n-plc">
          <rect x="200" y="270" width="220" height="80" rx="6"/>
          <text class="title" x="214" y="296">Identity directory</text>
          <text class="tech" x="214" y="314">PLC · your DID → your server</text>
        </g>
        <g class="node" id="n-relay">
          <rect x="465" y="105" width="160" height="80" rx="6"/>
          <text class="title" x="479" y="131">Relay</text>
          <text class="tech" x="479" y="149">Jetstream</text>
          <text class="line" x="479" y="171">Broadcasts changes</text>
        </g>
        <g class="node" id="n-appview">
          <rect x="670" y="70" width="140" height="75" rx="6"/>
          <text class="title" x="684" y="96">Index &amp; API</text>
          <text class="tech" x="684" y="114">AppView</text>
        </g>
        <g class="node" id="n-feedgen">
          <rect x="830" y="70" width="130" height="75" rx="6"/>
          <text class="title" x="844" y="96">Feed ranker</text>
          <text class="tech" x="844" y="114">feedgen</text>
        </g>
        <g class="node" id="n-postgres">
          <rect x="670" y="185" width="290" height="245" rx="6"/>
          <text class="title" x="684" y="211">Index database</text>
          <text class="tech" x="684" y="229">Postgres</text>
          <g id="tables"></g>
        </g>
        <g class="node" id="n-media">
          <rect x="670" y="470" width="290" height="85" rx="6"/>
          <text class="title" x="684" y="496">Transcoder</text>
          <text class="tech" x="684" y="514">media · ffmpeg → HLS</text>
          <text class="line" x="684" y="538">Cuts videos into streamable pieces</text>
        </g>
        <g class="node" id="n-store">
          <rect x="420" y="470" width="190" height="85" rx="6"/>
          <text class="title" x="434" y="496">Video files</text>
          <text class="tech" id="store-kind" x="434" y="514">S3 or local disk</text>
          <text class="line" x="434" y="538">HLS playlists and segments</text>
        </g>
        <g class="node" id="n-cdn">
          <rect x="40" y="470" width="170" height="85" rx="6"/>
          <text class="title" x="54" y="496">Video CDN</text>
          <text class="tech" x="54" y="514">CloudFront or nginx</text>
        </g>
        <g id="overlay"></g>
      </svg>`

const STYLES = `
  :root {
    --paper: #fbfcfd;
    --ink: #18202b;
    --muted: #677180;
    --faint: #9aa3ad;
    --rule: #dde2e7;
    --yours: #0f7b6c;
    --openreel: #3d4fd6;
    --delivery: #b4307a;
    --relay: #8a6a12;
    --bad: #c2410c;
    --sans: 'IBM Plex Sans', system-ui, sans-serif;
    --cond: 'IBM Plex Sans Condensed', 'IBM Plex Sans', system-ui, sans-serif;
    --mono: 'IBM Plex Mono', ui-monospace, Menlo, monospace;
  }
  * { box-sizing: border-box; }
  html { background: var(--paper); color: var(--ink); }
  body { margin: 0; font: 15px/1.5 var(--sans); }
  a { color: var(--muted); }

  .page { max-width: 1520px; margin: 0 auto; padding: 28px 32px 32px; }
  header { display: flex; justify-content: space-between; align-items: baseline; gap: 24px; flex-wrap: wrap; margin-bottom: 18px; }
  h1 { font: 600 28px/1.1 var(--cond); margin: 0; letter-spacing: -0.01em; }
  h1 small { display: block; font: 400 15px/1.4 var(--sans); color: var(--muted); margin-top: 6px; letter-spacing: 0; }
  .where { font-size: 13px; margin: 0; }
  .notice { padding: 10px 14px; border: 1px solid var(--bad); color: var(--bad); }

  .layout { display: grid; grid-template-columns: minmax(0, 1fr) 440px; gap: 32px; align-items: start; }
  @media (max-width: 1150px) { .layout { grid-template-columns: 1fr; } }

  /* Map */
  svg { width: 100%; height: auto; display: block; overflow: visible; }
  .zone .tab { font: 600 13px var(--cond); }
  .zone .tab-note { font: 400 12px var(--sans); fill: var(--muted); }
  .yours rect { fill: color-mix(in srgb, var(--yours) 6%, transparent); stroke: color-mix(in srgb, var(--yours) 45%, transparent); }
  .openreel rect { fill: color-mix(in srgb, var(--openreel) 5%, transparent); stroke: color-mix(in srgb, var(--openreel) 40%, transparent); }
  .delivery rect { fill: color-mix(in srgb, var(--delivery) 5%, transparent); stroke: color-mix(in srgb, var(--delivery) 40%, transparent); }
  .yours .tab { fill: var(--yours); } .openreel .tab { fill: var(--openreel); } .delivery .tab { fill: var(--delivery); }

  .node > rect { fill: #fff; stroke: var(--ink); stroke-width: 1.25; }
  .node .title { font: 600 15px var(--cond); fill: var(--ink); }
  .node .tech { font: 11.5px var(--mono); fill: var(--muted); }
  .node .line { font: 12.5px var(--sans); fill: var(--ink); }
  .node .line tspan { font-family: var(--mono); font-size: 11.5px; fill: var(--muted); }
  .node.lit > rect { stroke-width: 2.25; stroke: var(--c); }

  .table-row text { font: 12.5px var(--mono); fill: var(--ink); }
  .table-row .gloss { font: 12.5px var(--sans); fill: var(--muted); }
  .table-row .n { font: 500 13px var(--mono); text-anchor: end; font-variant-numeric: tabular-nums; }
  .table-row rect { fill: transparent; stroke: none; }
  .table-row.read rect { stroke: var(--openreel); stroke-width: 1.25; }
  .table-row.write rect { fill: color-mix(in srgb, var(--openreel) 16%, transparent); }
  .table-row.changed .n { fill: var(--openreel); }

  .edge path { fill: none; stroke: var(--faint); stroke-width: 1.25; }
  .edge.unobserved path { stroke-dasharray: 4 4; }
  .edge text { font: 11.5px var(--mono); fill: var(--muted); }
  .edge.done path { stroke: var(--c); stroke-width: 1.75; opacity: 0.4; }
  .edge.lit path { stroke: var(--c); stroke-width: 2.75; opacity: 1; }
  .edge.inferred path { stroke-dasharray: 5 4; }
  .edge.lit text { fill: var(--c); }
  .pulse { fill: var(--c); }

  /* Player */
  .player { margin-top: 14px; border-top: 1px solid var(--rule); padding-top: 12px; }
  .controls { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
  button { font: inherit; color: inherit; background: none; border: 0; padding: 0; text-align: left; cursor: pointer; }
  button:focus-visible { outline: 2px solid var(--openreel); outline-offset: 2px; }
  .controls > button { width: 36px; height: 36px; display: grid; place-items: center; border: 1px solid var(--rule); border-radius: 4px; background: #fff; color: var(--ink); }
  .controls > button:hover { border-color: var(--faint); }
  .controls > button:disabled { color: var(--faint); cursor: default; border-color: var(--rule); }
  .controls svg { width: 16px; height: 16px; fill: currentColor; stroke: currentColor; stroke-width: 1.5; stroke-linejoin: round; }
  #play .play, #play.live .pause { display: inline; }
  #play .pause, #play.live .play { display: none; }
  .live-dot { display: inline-block; width: 8px; height: 8px; border-radius: 50%; background: var(--yours); margin-right: 6px; }
  .queue { font-size: 13px; color: var(--muted); margin-left: 8px; }
  .keys { margin-left: auto; font: 12px var(--mono); color: var(--faint); }
  .caption { min-height: 76px; margin-top: 12px; display: grid; grid-template-columns: 110px minmax(0, 1fr); gap: 2px 16px; align-items: baseline; }
  .caption .idle { grid-column: 1 / -1; margin: 0; color: var(--muted); }
  .caption .count { font: 12px var(--mono); color: var(--muted); }
  .caption .now { font: 600 21px/1.25 var(--cond); }
  .caption .action { font: 12px var(--mono); color: var(--c); }
  .caption .detail { font: 13px var(--mono); color: var(--c); word-break: break-word; }
  .caption .raw-toggle { grid-column: 2; justify-self: start; font-size: 12.5px; color: var(--muted); text-decoration: underline; margin-top: 4px; }
  .caption pre { grid-column: 1 / -1; margin: 6px 0 0; padding: 8px 10px; background: #fff; border: 1px solid var(--rule); font: 11.5px/1.5 var(--mono); white-space: pre-wrap; word-break: break-all; max-height: 220px; overflow: auto; }
  .caption.error .now { color: var(--bad); }

  .key { display: flex; gap: 22px; flex-wrap: wrap; margin: 12px 0 0; font-size: 13px; color: var(--muted); }
  .key span { display: inline-flex; align-items: center; gap: 8px; }
  .key svg { width: 28px; height: 6px; }

  /* Activity */
  aside { min-width: 0; }
  .aside-head { display: flex; justify-content: space-between; align-items: baseline; gap: 12px; }
  h2 { font: 600 18px var(--cond); margin: 0; }
  .aside-head span { font-size: 13px; color: var(--muted); }
  .background { margin: 4px 0 12px; font-size: 13px; color: var(--muted); }
  .background b { font: 500 12.5px var(--mono); color: var(--ink); font-variant-numeric: tabular-nums; }

  #traces { list-style: none; margin: 0; padding: 0; border-top: 1px solid var(--rule); max-height: calc(100vh - 170px); overflow-y: auto; }
  .trace { border-bottom: 1px solid var(--rule); }
  .trace.current { background: color-mix(in srgb, var(--openreel) 5%, transparent); }
  .trace-head { width: 100%; display: grid; grid-template-columns: 64px minmax(0, 1fr) auto; gap: 2px 10px; padding: 9px 6px 9px 0; align-items: baseline; }
  .trace-head time, .trace-head .total { font: 12px var(--mono); color: var(--muted); font-variant-numeric: tabular-nums; }
  .trigger { font: 13.5px var(--mono); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .trigger b { font-weight: 500; }
  .trace.failed .trigger { color: var(--bad); }
  .who, .data { grid-column: 2 / 4; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .who { font-size: 13px; color: var(--muted); }
  .data { font: 12px var(--mono); }
  .data .k { color: var(--muted); }
  .data .k.w { color: var(--openreel); }

  .spans { display: none; padding: 0 0 10px; }
  .trace.current .spans { display: block; }
  .span { width: 100%; display: grid; grid-template-columns: 44px minmax(0, 1fr) 64px 52px; gap: 8px; align-items: center; padding: 5px 4px; border-radius: 3px; }
  .span:hover { background: #eef1f4; }
  .span.current { background: #fff; box-shadow: inset 3px 0 0 var(--c); }
  .span .action { font: 11px var(--mono); color: var(--muted); align-self: start; padding-top: 2px; }
  .span .action.write { color: var(--c); font-weight: 500; }
  .span .what { display: grid; min-width: 0; }
  .span .purpose { font-size: 13.5px; line-height: 1.35; }
  .span .purpose.unlabelled { color: var(--muted); font-style: italic; }
  .span .detail { font: 11.5px var(--mono); color: var(--c); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .span .bar { position: relative; height: 8px; background: #edf0f3; border-radius: 1px; }
  .span .bar i { position: absolute; top: 0; bottom: 0; min-width: 2px; background: var(--c); border-radius: 1px; }
  .span .ms { font: 11.5px var(--mono); text-align: right; color: var(--muted); font-variant-numeric: tabular-nums; }
  .span.inferred .purpose, .span.inferred .detail, .span.inferred .action { color: var(--faint); }
  .span.inferred .bar { background: none; }
  .span.offmap .detail { text-decoration: underline dotted; }
  .span.error .purpose, .span.error .detail { color: var(--bad); }

  @media (prefers-reduced-motion: reduce) { .pulse { display: none; } }
`

// Browser code. Written without template literals or the dollar-brace
// sequence so it can sit inside this TypeScript template string.
const SCRIPT = String.raw`
(() => {
  // -------------------------------------------------------------------------
  // Topology. Edges are keyed "from>to"; an event lights whichever edge its
  // endpoints name. A new service needs a node in the SVG and edges here.
  // -------------------------------------------------------------------------
  const ZONE_OF = {
    client: 'var(--ink)',
    pds: 'var(--yours)', plc: 'var(--yours)',
    relay: 'var(--relay)',
    appview: 'var(--openreel)', feedgen: 'var(--openreel)', postgres: 'var(--openreel)', media: 'var(--openreel)',
    store: 'var(--delivery)', cdn: 'var(--delivery)',
  }
  const EDGES = {
    'client>pds': { d: 'M150,205 H175 V140 H200' },
    'pds>relay': { d: 'M420,140 H465' },
    'relay>appview': { d: 'M625,140 H640 V105 H670' },
    'client>appview': { d: 'M85,170 V12 H790 V70', labels: [[300, 8, 'feeds, profiles']] },
    'appview>feedgen': { d: 'M810,107 H830' },
    'appview>postgres': { d: 'M740,145 V185' },
    'feedgen>postgres': { d: 'M895,145 V185' },
    'media>postgres': { d: 'M815,470 V430' },
    'media>pds': { d: 'M670,495 H640 V205 H420', labels: [[470, 221, 'download original']] },
    'appview>plc': { d: 'M690,145 V160 H640 V322 H420' },
    'media>plc': { d: 'M670,505 H640 V322 H420', labels: [[470, 338, 'identity lookups']] },
    'media>store': { d: 'M670,530 H610' },
    'pds>plc': { d: 'M310,220 V270', unobserved: true },
    'store>cdn': { d: 'M420,512 H210', unobserved: true },
    'cdn>client': { d: 'M60,470 V250', unobserved: true, labels: [[68, 350, 'playback,'], [68, 364, 'not seen live']] },
  }
  const TABLES = [
    ['actor', 'people'],
    ['video_post', 'videos'],
    ['video_like', 'likes'],
    ['watch_event', 'views'],
    ['video_post_stats', 'counts per video'],
    ['video_media', 'transcode jobs'],
  ]
  const STEP_HOLD_MS = 900
  const MAX_TRACES = 200

  const SVG = 'http://www.w3.org/2000/svg'
  const $ = (id) => document.getElementById(id)
  const el = (tag, cls, text) => {
    const node = document.createElement(tag)
    if (cls) node.className = cls
    if (text !== undefined) node.textContent = text
    return node
  }
  const svgEl = (tag, attrs) => {
    const node = document.createElementNS(SVG, tag)
    for (const k in attrs) node.setAttribute(k, attrs[k])
    return node
  }
  const reduceMotion = matchMedia('(prefers-reduced-motion: reduce)').matches
  const edgeId = (key) => 'e-' + key.replace('>', '-')
  const short = (nsid) => (nsid || '').replace(/^social\.openreel\./, '')
  const shortPath = (path) => short(path.replace(/^\/xrpc\//, '').replace(/\?.*$/, ''))
  const plural = (n, word) => n + ' ' + word + (n === 1 ? '' : 's')
  const mb = (bytes) => (bytes / 1e6).toFixed(1) + ' MB'
  const fmtMs = (ms) =>
    ms >= 60000 ? (ms / 60000).toFixed(1) + ' min'
    : ms >= 1000 ? (ms / 1000).toFixed(1) + ' s'
    : ms < 10 ? ms.toFixed(1) + ' ms'
    : Math.round(ms) + ' ms'
  const shortId = (id) => (id.length > 16 ? id.slice(0, 10) + '…' + id.slice(-4) : id)
  const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

  for (const key in EDGES) {
    const edge = EDGES[key]
    const g = svgEl('g', { class: 'edge' + (edge.unobserved ? ' unobserved' : ''), id: edgeId(key) })
    g.append(svgEl('path', { d: edge.d, 'marker-end': 'url(#arrow)' }))
    for (const [x, y, text] of edge.labels || []) {
      const t = svgEl('text', { x, y })
      t.textContent = text
      g.append(t)
    }
    $('edges').append(g)
  }

  const counts = {}
  TABLES.forEach(([name, gloss], i) => {
    const y = 250 + i * 28
    const row = svgEl('g', { class: 'table-row', 'data-table': name })
    row.append(svgEl('rect', { x: 678, y, width: 274, height: 24, rx: 3 }))
    const label = svgEl('text', { x: 686, y: y + 16 })
    label.textContent = name
    const glossText = svgEl('text', { class: 'gloss', x: 820, y: y + 16 })
    glossText.textContent = gloss
    const count = svgEl('text', { class: 'n', x: 944, y: y + 16 })
    count.textContent = '–'
    counts[name] = { row, count, n: undefined }
    row.append(label, glossText, count)
    $('tables').append(row)
  })

  // -------------------------------------------------------------------------
  // Events to steps. Each step says what it was for (the label written where
  // the call is made), whether it read or wrote, and which way data moved.
  // -------------------------------------------------------------------------
  function stepsOf(e) {
    const t = Date.parse(e.at)
    const base = { t, ms: e.ms, event: e, purpose: e.purpose, error: e.error }
    switch (e.kind) {
      case 'firehose': {
        const start = t - e.relayMs
        const what = e.event === 'commit' ? e.op + ' ' + short(e.collection) : e.event
        const steps = []
        if (e.event === 'commit') {
          // The write reached the PDS before the commit; its timing is unknown.
          steps.push({ ...base, t: start, ms: 0, from: 'client', to: 'pds', hops: ['client>pds'], action: 'write', inferred: true,
            purpose: 'Client wrote record to PDS (inferred)', detail: 'client → pds · ' + short(e.collection), error: undefined })
        }
        steps.push({ ...base, t: start, ms: e.relayMs, from: 'pds', to: e.service, hops: ['pds>relay', 'relay>' + e.service], action: 'event',
          purpose: 'Receive ' + e.event + ' event from Jetstream', detail: 'pds → relay → ' + e.service + ' · ' + what, error: undefined })
        return steps
      }
      case 'request':
        // A call from another of our services is drawn by the caller's call.
        if (e.from) return []
        return [{ ...base, from: 'client', to: e.service, hops: ['client>' + e.service], action: 'call',
          purpose: 'Serve ' + shortPath(e.path) + (e.path.startsWith('/xrpc/') ? ' (XRPC)' : ''),
          detail: 'client → ' + e.service + ' · ' + e.method + ' ' + shortPath(e.path) + ' · ' + e.status }]
      case 'call': {
        const extra = (e.bytes ? ' · ' + mb(e.bytes) : '') + (e.status && e.status >= 300 ? ' · ' + e.status : '')
        return [{ ...base, from: e.service, to: e.target, hops: [e.service + '>' + e.target], action: 'call',
          detail: e.service + ' → ' + e.target + ' · ' + e.method + ' ' + shortPath(e.path) + extra }]
      }
      case 'sql': {
        const rows = e.rows === undefined ? '' : ' · ' + plural(e.rows, 'row')
        if (e.op === 'select') {
          return [{ ...base, from: e.service, to: 'postgres', hops: [e.service + '>postgres'], action: 'read', reads: e.reads,
            detail: e.service + ' ← ' + (e.reads.join(', ') || 'postgres') + rows }]
        }
        if (e.writes) {
          const from = e.reads.length ? ' (from ' + e.reads.join(', ') + ')' : ''
          return [{ ...base, from: e.service, to: 'postgres', hops: [e.service + '>postgres'], action: 'write', writes: e.writes, reads: e.reads,
            detail: e.service + ' → ' + e.writes + from + ' · ' + e.op + rows }]
        }
        return [{ ...base, from: e.service, to: 'postgres', hops: [e.service + '>postgres'], action: 'sql', reads: e.reads,
          detail: e.service + ' · ' + e.op + rows }]
      }
      case 'store':
        $('store-kind').textContent = e.target === 's3' ? 'S3' : 'local disk'
        return [{ ...base, from: e.service, to: 'store', hops: [e.service + '>store'], action: 'write',
          detail: e.service + ' → ' + e.target + (e.objects ? ' · ' + e.objects + ' files' : '') + (e.bytes ? ', ' + mb(e.bytes) : '') }]
      case 'work':
        return [{ ...base, from: e.service, to: e.service, hops: [], action: 'work', detail: e.service + ' · ' + e.what }]
      default:
        return []
    }
  }

  function isRoot(e) {
    return e.kind === 'firehose' || e.kind === 'job' || (e.kind === 'request' && !e.from)
  }

  function headOf(root, handle) {
    const who = handle ? '@' + handle : root.did
    switch (root.kind) {
      case 'firehose':
        return root.event === 'commit'
          ? { verb: root.op, what: short(root.collection), who }
          : { verb: root.event, what: 'update', who }
      case 'job':
        return { verb: root.name, what: shortId(root.subject), who }
      case 'request':
        return { verb: root.method, what: shortPath(root.path), who: 'HTTP ' + root.status + (root.client ? ' · User-Agent: ' + root.client : '') }
      default:
        return { verb: root.kind, what: '', who: '' }
    }
  }

  function build(raw) {
    const root = raw.events.find(isRoot) || raw.events[0]
    const steps = raw.events.flatMap(stepsOf)
      .map((step, i) => ({ ...step, order: i }))
      .sort((a, b) => a.t - b.t || a.order - b.order)
    const t0 = Math.min(...steps.map((s) => s.t))
    const t1 = Math.max(...steps.map((s) => s.t + s.ms))
    const reads = new Set()
    const writes = new Set()
    for (const s of steps) {
      if (s.event.kind === 'sql') {
        for (const r of s.reads || []) reads.add(r)
        if (s.writes) writes.add(s.writes)
      }
      if (s.event.kind === 'store') writes.add(s.event.target === 's3' ? 'S3' : 'disk')
    }
    return {
      id: raw.id, root, steps, t0, total: Math.max(t1 - t0, 0.1),
      at: new Date(Date.parse(root.at)),
      head: headOf(root, raw.handle),
      reads: [...reads], writes: [...writes],
      failed: raw.events.some((e) => e.error),
    }
  }

  // -------------------------------------------------------------------------
  // Map drawing.
  // -------------------------------------------------------------------------
  function clearMap() {
    for (const n of document.querySelectorAll('#map .lit, #map .done, #map .inferred, #map .read, #map .write')) {
      n.classList.remove('lit', 'done', 'inferred', 'read', 'write')
    }
    $('overlay').replaceChildren()
  }

  function lightHop(key, color, cls, inferred) {
    const edge = $(edgeId(key))
    if (!edge) return
    edge.style.setProperty('--c', color)
    edge.classList.add(cls)
    if (inferred) edge.classList.add('inferred')
  }

  function lightStep(step, cls, hops) {
    const color = ZONE_OF[step.to] || 'var(--ink)'
    for (const key of hops || step.hops) lightHop(key, color, cls, step.inferred)
    if (cls !== 'lit') return
    const node = $('n-' + step.to)
    if (node) {
      node.style.setProperty('--c', color)
      node.classList.add('lit')
    }
    for (const t of step.reads || []) counts[t] && counts[t].row.classList.add('read')
    if (step.writes && counts[step.writes]) counts[step.writes].row.classList.add('write')
  }

  // Moves a dot along one edge. Real steps take milliseconds; the dot takes
  // long enough to follow.
  function travel(key, color, token) {
    const edge = $(edgeId(key))
    if (!edge || reduceMotion) return Promise.resolve(true)
    const path = edge.querySelector('path')
    const length = path.getTotalLength()
    const dot = svgEl('circle', { class: 'pulse', r: 5 })
    dot.style.setProperty('--c', color)
    $('overlay').append(dot)
    const duration = Math.min(1100, 350 + length * 1.1)
    const start = performance.now()
    return new Promise((resolve) => {
      function frame(now) {
        if (token !== drawToken) {
          dot.remove()
          return resolve(false)
        }
        const t = Math.min(1, (now - start) / duration)
        const eased = t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2
        const p = path.getPointAtLength(eased * length)
        dot.setAttribute('cx', p.x)
        dot.setAttribute('cy', p.y)
        if (t < 1) requestAnimationFrame(frame)
        else {
          dot.remove()
          resolve(true)
        }
      }
      requestAnimationFrame(frame)
    })
  }

  let drawToken = 0
  async function draw(trace, index, animate) {
    const token = ++drawToken
    clearMap()
    trace.steps.slice(0, index).forEach((step) => lightStep(step, 'done'))
    const step = trace.steps[index]
    if (!animate) {
      lightStep(step, 'lit')
      return
    }
    const color = ZONE_OF[step.to] || 'var(--ink)'
    for (const key of step.hops) {
      if (!(await travel(key, color, token))) return
      lightHop(key, color, 'lit', step.inferred)
    }
    if (token === drawToken) lightStep(step, 'lit')
  }

  // -------------------------------------------------------------------------
  // Activity list.
  // -------------------------------------------------------------------------
  const traces = []
  let pos = { ti: -1, si: -1 }

  function renderTrace(trace) {
    const item = el('li', 'trace' + (trace.failed ? ' failed' : ''))
    const head = el('button', 'trace-head')
    head.type = 'button'
    const trigger = el('span', 'trigger')
    trigger.append(el('b', '', trace.head.verb), ' ' + trace.head.what)
    const data = el('span', 'data')
    if (trace.reads.length) data.append(el('span', 'k', 'read '), trace.reads.join(', '))
    if (trace.reads.length && trace.writes.length) data.append('   ')
    if (trace.writes.length) data.append(el('span', 'k w', 'wrote '), trace.writes.join(', '))
    head.append(
      el('time', '', trace.at.toLocaleTimeString([], { hour12: false })),
      trigger,
      el('span', 'total', fmtMs(trace.total)),
      el('span', 'who', trace.head.who || ''),
    )
    if (trace.reads.length || trace.writes.length) head.append(data)
    head.onclick = () => {
      pause()
      go(traces.indexOf(trace), 0, true)
    }

    const list = el('div', 'spans')
    trace.rows = trace.steps.map((step, i) => {
      const onMap = step.hops.every((key) => key in EDGES)
      const row = el('button', 'span' + (step.inferred ? ' inferred' : '') + (onMap ? '' : ' offmap') + (step.error ? ' error' : ''))
      row.type = 'button'
      row.style.setProperty('--c', ZONE_OF[step.to] || 'var(--ink)')
      const what = el('span', 'what')
      what.append(
        el('span', 'purpose' + (step.purpose ? '' : ' unlabelled'), step.purpose || 'Unlabelled call site'),
        el('span', 'detail', step.detail + (step.error ? ' · failed: ' + step.error : '')),
      )
      if (!onMap) what.title = 'No edge for this hop on the map yet'
      const bar = el('span', 'bar')
      if (!step.inferred) {
        const fill = el('i')
        fill.style.left = ((step.t - trace.t0) / trace.total) * 100 + '%'
        fill.style.width = (step.ms / trace.total) * 100 + '%'
        bar.append(fill)
      }
      row.append(el('span', 'action ' + step.action, step.action), what, bar, el('span', 'ms', step.inferred ? '' : fmtMs(step.ms)))
      row.onclick = () => {
        pause()
        go(traces.indexOf(trace), i, true)
      }
      list.append(row)
      return row
    })
    item.append(head, list)
    trace.item = item
    return item
  }

  const background = new Map()
  function renderBackground() {
    const top = [...background.values()].sort((a, b) => b.count - a.count).slice(0, 3)
    const p = $('background')
    p.replaceChildren()
    if (!top.length) return
    p.append('Not drawn: ')
    top.forEach((b, i) => {
      if (i) p.append(' · ')
      p.append(b.label + ' (' + b.service + ') ', el('b', '', b.count + '×'))
    })
  }

  // -------------------------------------------------------------------------
  // Player. Live by default: each new trace plays as it arrives, interrupting
  // the one on screen. Back, forward, or picking a step pauses on that step;
  // play goes live again from the newest trace. Position is (trace, step);
  // stepping past a trace's last step moves to the next newer trace.
  // -------------------------------------------------------------------------
  let live = true
  let playId = 0
  let rawOpen = false

  function renderPosition() {
    for (const t of traces) t.item.classList.remove('current')
    const trace = traces[pos.ti]
    if (trace) {
      trace.item.classList.add('current')
      trace.rows.forEach((row, i) => row.classList.toggle('current', i === pos.si))
      trace.rows[pos.si].scrollIntoView({ block: 'nearest' })
    }
    renderCaption()
    renderControls()
  }

  function renderCaption() {
    const box = $('caption')
    box.replaceChildren()
    box.className = 'caption'
    const trace = traces[pos.ti]
    if (!trace) {
      box.append(el('p', 'idle', 'Waiting for activity. Open the app and scroll the feed, like a video, or post one.'))
      return
    }
    const step = trace.steps[pos.si]
    box.className = 'caption' + (step.error ? ' error' : '')
    box.style.setProperty('--c', ZONE_OF[step.to] || 'var(--ink)')
    box.append(
      el('span', 'count', 'Step ' + (pos.si + 1) + ' of ' + trace.steps.length),
      el('span', 'now', step.purpose || 'Unlabelled call site'),
      el('span', 'action', step.action + (step.inferred ? ', inferred' : '')),
      el('span', 'detail', step.detail + (step.inferred ? '' : ' · ' + fmtMs(step.ms)) + (step.error ? ' · failed: ' + step.error : '')),
    )
    const toggle = el('button', 'raw-toggle', rawOpen ? 'Hide the raw event' : 'Show the raw event')
    toggle.type = 'button'
    toggle.onclick = () => {
      rawOpen = !rawOpen
      renderCaption()
    }
    box.append(toggle)
    if (rawOpen) box.append(el('pre', '', JSON.stringify(step.event, null, 2)))
  }

  function renderControls() {
    const button = $('play')
    button.classList.toggle('live', live)
    button.setAttribute('aria-label', live ? 'Pause' : 'Go live')
    button.title = live ? 'Pause (Space)' : 'Go live (Space)'
    $('back').disabled = pos.ti < 0 || (pos.ti === 0 && pos.si === 0)
    $('forward').disabled = !canForward()
    const status = $('queue')
    status.replaceChildren()
    if (live) {
      status.append(el('span', 'live-dot'), 'Live')
      return
    }
    const behind = pos.ti < 0 ? traces.length : traces.length - 1 - pos.ti
    status.append('Paused' + (behind > 0 ? ' · ' + plural(behind, 'newer trace') : ''))
  }

  function canForward() {
    if (pos.ti < 0) return traces.length > 0
    return pos.si < traces[pos.ti].steps.length - 1 || pos.ti < traces.length - 1
  }

  function go(ti, si, animate) {
    if (!traces[ti]) return Promise.resolve()
    pos = { ti, si }
    renderPosition()
    return draw(traces[ti], si, animate)
  }

  // Plays one trace from its first step, unless something newer takes over.
  async function playTrace(ti) {
    const me = ++playId
    const trace = traces[ti]
    for (let si = 0; si < trace.steps.length; si++) {
      await go(ti, si, true)
      if (me !== playId) return
      if (si < trace.steps.length - 1) await wait(STEP_HOLD_MS)
      if (me !== playId) return
    }
  }

  function forward() {
    if (pos.ti < 0) go(0, 0, true)
    else if (pos.si < traces[pos.ti].steps.length - 1) go(pos.ti, pos.si + 1, true)
    else if (pos.ti < traces.length - 1) go(pos.ti + 1, 0, true)
  }

  function back() {
    if (pos.si > 0) go(pos.ti, pos.si - 1, false)
    else if (pos.ti > 0) go(pos.ti - 1, traces[pos.ti - 1].steps.length - 1, false)
  }

  function goLive() {
    live = true
    renderControls()
    if (traces.length) playTrace(traces.length - 1)
  }

  function pause() {
    live = false
    playId++
    renderControls()
  }

  $('play').onclick = () => (live ? pause() : goLive())
  $('back').onclick = () => {
    pause()
    back()
  }
  $('forward').onclick = () => {
    pause()
    forward()
  }
  document.addEventListener('keydown', (event) => {
    if (event.metaKey || event.ctrlKey || event.altKey) return
    if (event.key === ' ') $('play').click()
    else if (event.key === 'ArrowLeft') $('back').click()
    else if (event.key === 'ArrowRight') $('forward').click()
    else return
    event.preventDefault()
  })

  // -------------------------------------------------------------------------
  // Data. The server sends its backlog, then 'ready', then traces as they
  // finish. The backlog is listed but not played.
  // -------------------------------------------------------------------------
  let caughtUp = false
  function receive(raw) {
    const trace = build(raw)
    if (!trace.steps.length) return
    traces.push(trace)
    $('traces').prepend(renderTrace(trace))
    if (traces.length > MAX_TRACES) {
      traces.shift().item.remove()
      pos.ti -= 1
      if (pos.ti < 0) pos = { ti: -1, si: -1 }
    }
    if (caughtUp && live) playTrace(traces.length - 1)
    else renderControls()
  }

  function connect() {
    const source = new EventSource('/debug/api/stream')
    source.onmessage = (message) => {
      const data = JSON.parse(message.data)
      if (data.type === 'trace') receive(data.trace)
      else if (data.type === 'ready') caughtUp = true
      else if (data.type === 'background') {
        background.set(data.service + ' ' + data.label, data)
        renderBackground()
      }
    }
    source.onerror = () => {
      // EventSource reconnects on its own and the server resends its backlog.
      source.close()
      setTimeout(() => {
        traces.splice(0).forEach((t) => t.item.remove())
        pos = { ti: -1, si: -1 }
        caughtUp = false
        background.clear()
        connect()
      }, 3000)
    }
  }

  async function poll() {
    try {
      const res = await fetch('/debug/api/snapshot')
      if (res.ok) {
        const snapshot = await res.json()
        for (const name in counts) {
          const c = counts[name]
          const n = snapshot.tables[name]
          if (n === undefined) continue
          c.row.classList.toggle('changed', c.n !== undefined && n !== c.n)
          c.n = n
          c.count.textContent = n
        }
      }
    } catch {
      // Try again on the next tick.
    }
    setTimeout(poll, 3000)
  }

  renderCaption()
  renderControls()
  connect()
  poll()
})()
`
