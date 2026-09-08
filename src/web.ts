import { createServer } from "node:http";
import { config } from "./config.js";
import { store } from "./store.js";
import type { Case } from "./types.js";

const STATUS_LABEL: Record<string, string> = {
  gathering: "Taking the brief",
  opening: "Opening the thread",
  awaiting_contact: "Waiting for them to text in",
  negotiating: "In conversation",
  needs_you: "Waiting on you",
  agreed: "Agreed",
  stalled: "Stalled",
  closed: "Closed",
};

const STATUS_TONE: Record<string, string> = {
  gathering: "muted",
  opening: "muted",
  awaiting_contact: "warn",
  negotiating: "live",
  needs_you: "warn",
  agreed: "good",
  stalled: "bad",
  closed: "muted",
};

const esc = (s: string) =>
  s.replace(/[&<>"']/g, (ch) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[ch]!,
  );

function page(c: Case): string {
  const tone = STATUS_TONE[c.status] ?? "muted";
  const turns = c.transcript
    .map((t) => {
      const mine = t.who === "powlo";
      const who = mine ? "powlo" : t.side === "principal" ? "you" : c.counterpartyName ?? "them";
      return `<div class="turn ${mine ? "out" : "in"} ${t.side}">
        <div class="who">${esc(who)}</div>
        <div class="bubble">${esc(t.text)}</div>
      </div>`;
    })
    .join("");

  return `<!doctype html><html><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>powlo · ${esc(c.headline)}</title>
<style>
  :root{color-scheme:dark;--bg:#0b0b0d;--card:#151519;--line:#26262d;--fg:#f2f2f4;--dim:#8b8b96;
        --live:#3b82f6;--good:#22c55e;--warn:#f59e0b;--bad:#ef4444;--muted:#6b7280}
  *{box-sizing:border-box}
  body{margin:0;background:var(--bg);color:var(--fg);
       font:15px/1.5 -apple-system,BlinkMacSystemFont,"SF Pro Text",system-ui,sans-serif;
       padding:20px;max-width:560px;margin-inline:auto}
  .head{display:flex;align-items:center;gap:10px;margin-bottom:4px}
  .dot{width:9px;height:9px;border-radius:50%;background:var(--${tone});flex:none}
  .dot.live{animation:pulse 1.6s ease-in-out infinite}
  @keyframes pulse{0%,100%{opacity:1}50%{opacity:.35}}
  .status{font-size:13px;font-weight:600;color:var(--${tone});letter-spacing:.02em}
  h1{font-size:21px;margin:0 0 14px;font-weight:650;letter-spacing:-.01em}
  .grid{display:grid;grid-template-columns:auto 1fr;gap:7px 14px;background:var(--card);
        border:1px solid var(--line);border-radius:12px;padding:14px;margin-bottom:18px}
  .k{color:var(--dim);font-size:13px}
  .v{font-size:13px}
  .sec{color:var(--dim);font-size:11px;text-transform:uppercase;letter-spacing:.09em;
       margin:0 0 10px;font-weight:600}
  .turn{margin-bottom:10px}
  .turn.principal .bubble{background:#1f2937}
  .turn.counterparty .bubble{background:#1c2a1e}
  .turn.out .bubble{background:var(--live);color:#fff}
  .who{font-size:10px;color:var(--dim);margin-bottom:3px;text-transform:uppercase;letter-spacing:.07em}
  .bubble{display:inline-block;padding:8px 12px;border-radius:15px;max-width:88%;
          white-space:pre-wrap;word-break:break-word}
  .turn.out{text-align:right}.turn.out .who{margin-right:2px}
  .outcome{background:#0f2417;border:1px solid #1f5136;border-radius:12px;padding:12px;
           margin-bottom:18px;font-size:14px}
  .foot{color:var(--dim);font-size:11px;margin-top:22px;text-align:center}
</style></head><body>
<div class="head"><span class="dot ${tone}"></span><span class="status">${esc(
    STATUS_LABEL[c.status] ?? c.status,
  )}</span></div>
<h1>${esc(c.headline)}</h1>
<div class="grid">
  <div class="k">Objective</div><div class="v">${esc(c.objective ?? "—")}</div>
  <div class="k">Other party</div><div class="v">${esc(
    c.counterpartyName ? `${c.counterpartyName} · ${c.counterparty ?? ""}` : c.counterparty ?? "—",
  )}</div>
  <div class="k">Floor</div><div class="v">${esc(c.floor ?? "—")}</div>
  <div class="k">Messages</div><div class="v">${c.transcript.length}</div>
</div>
${c.outcome ? `<div class="outcome"><strong>Outcome</strong><br>${esc(c.outcome)}</div>` : ""}
<p class="sec">Both threads</p>
${turns || '<p style="color:var(--dim)">Nothing yet.</p>'}
<div class="foot">powlo · case ${esc(c.id)}</div>
<script>setTimeout(()=>location.reload(),2500)</script>
</body></html>`;
}

export function startWeb() {
  const server = createServer((req, res) => {
    const url = new URL(req.url ?? "/", "http://x");
    const caseMatch = /^\/c\/([a-z0-9-]+)$/i.exec(url.pathname);

    if (caseMatch) {
      const c = store.get(caseMatch[1]!);
      if (!c) {
        res.writeHead(404, { "content-type": "text/plain" }).end("no such case");
        return;
      }
      res.writeHead(200, { "content-type": "text/html; charset=utf-8" }).end(page(c));
      return;
    }

    if (url.pathname === "/") {
      const list = store
        .all()
        .map((c) => `<li><a href="/c/${c.id}">${esc(c.headline)}</a> — ${c.status}</li>`)
        .join("");
      res
        .writeHead(200, { "content-type": "text/html; charset=utf-8" })
        .end(`<meta charset="utf-8"><title>powlo</title>
<body style="background:#0b0b0d;color:#f2f2f4;font-family:system-ui;padding:24px">
<h1>powlo</h1><ul>${list || "<li>no cases yet</li>"}</ul></body>`);
      return;
    }

    res.writeHead(404).end();
  });

  server.listen(config.port, () => {
    console.log(`[web] case dashboard on ${config.publicUrl}`);
  });

  return server;
}

export const caseUrl = (c: Case) => `${config.publicUrl}/c/${c.id}`;
