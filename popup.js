// popup.js — Trinetra.net v7.0
"use strict";
const API = "https://YOUR-RAILWAY-URL.up.railway.app"; // Replace with your Railway URL
let results = null, pageUrl = "", rawText = "";  // rawText = full T&C page text for blockchain

// ──────────────────────────────────────────────────────────────
document.addEventListener("DOMContentLoaded", async () => {
  id("btnA").addEventListener("click",  () => analyze());
  id("btnA2").addEventListener("click", () => analyze());
  id("btnH").addEventListener("click",  () => hashStore());
  id("btnH2").addEventListener("click", () => hashStore());

  try {
    const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
    const tab  = tabs?.[0];
    if (!tab?.url) { showErr("Cannot access current tab."); return; }
    pageUrl = tab.url;
    if (pageUrl.startsWith("chrome://") || pageUrl.startsWith("chrome-extension://")) {
      showErr("Trinetra cannot analyze browser internal pages."); return;
    }
    const domain = pageUrl.replace(/^https?:\/\//, "").split("/")[0];
    setSite(tab.title || domain, pageUrl);
    analyze(tab);
  } catch(e) { showErr("Init error: " + e.message); }
});

function id(s) { return document.getElementById(s); }

function setSite(name, url) {
  ["siteName","siteName2"].forEach(i => { const e=id(i); if(e) e.textContent=(name||"").substring(0,50); });
  ["siteUrl","siteUrl2"].forEach(i   => { const e=id(i); if(e) e.textContent=(url||"").substring(0,55); });
}

// ──────────────────────────────────────────────────────────────
// ANALYSIS
// ──────────────────────────────────────────────────────────────
async function analyze(tabArg) {
  let tab = tabArg;
  if (!tab?.id) {
    const tabs = await chrome.tabs.query({ active:true, currentWindow:true });
    tab = tabs?.[0];
  }
  if (!tab) return;

  pageUrl = tab.url;
  showScan();
  setDot("scan");
  setScanLabel("Extracting full T&C text from page…", "Scanning DOM for legal content");
  id("btnA").disabled = true;

  try {
    // ── 1. Extract the FULL page text (for both analysis AND blockchain evidence)
    let extracted = "", hasTnC = false;
    try {
      const [res] = await chrome.scripting.executeScript({ target:{tabId:tab.id}, func:extractPage });
      if (res?.result) {
        extracted = res.result.text || "";
        hasTnC    = res.result.hasTnC || false;
      }
    } catch(e) { console.error("Extract:", e); }

    // Save full text NOW — this is what gets stored in blockchain as evidence
    rawText = extracted;

    if (hasTnC) { id("alert1").classList.add("show"); id("alert2").classList.add("show"); }

    if (!extracted || extracted.trim().length < 50) {
      showErr("No Terms & Conditions text detected.<br>Navigate to a T&C or Privacy Policy page.");
      return;
    }

    setScanLabel("AI classifying clauses…", "Cross-referencing RBI · GDPR · DPDP Act 2023 · CPA 2019");

    // ── 2. Live elapsed timer
    let elapsed = 0;
    const ticker = setInterval(() => {
      elapsed++;
      setScanLabel(`Analyzing clauses… (${elapsed}s)`,
        elapsed < 12 ? "Running zero-shot classifier on each clause…"
        : elapsed < 25 ? "Building individual clause summaries…"
        : "Almost done — generating legal citations…");
    }, 1000);

    // ── 3. Health check
    try {
      const hc = await fetch(`${API}/health`, {signal: AbortSignal.timeout(4000)});
      if (!hc.ok) throw new Error("unhealthy");
    } catch {
      clearInterval(ticker);
      throw new Error("Backend offline. Open CMD → run: python app.py");
    }

    // ── 4. Send FULL text (no 5000 char limit)
    const ctrl = new AbortController();
    const tid  = setTimeout(() => ctrl.abort(), 120000);
    let resp;
    try {
      resp = await fetch(`${API}/analyze`, {
        method:"POST",
        headers:{"Content-Type":"application/json"},
        body: JSON.stringify({ text: extracted, url: tab.url, title: tab.title || "" }),
        signal: ctrl.signal
      });
      clearTimeout(tid); clearInterval(ticker);
    } catch(err) {
      clearTimeout(tid); clearInterval(ticker);
      throw err.name === "AbortError"
        ? new Error("Analysis timed out (120s). Large page — try again.")
        : new Error("Backend unreachable. Run: python app.py");
    }

    if (!resp.ok) {
      const t = await resp.text().catch(()=>"");
      throw new Error(`Backend error ${resp.status}: ${t.substring(0,100)}`);
    }

    results = await resp.json();

    // ── 5. Push to sidebar
    try { await chrome.tabs.sendMessage(tab.id, {type:"TRINETRA_ANALYSIS", data:results}); } catch{}

    setScanLabel("Building report…", "Preparing per-clause summaries and legal citations");
    await new Promise(r => setTimeout(r, 400));

    showResults(results);
    setDot("on");
    id("btnH2").disabled = false;

  } catch(err) { showErr(err.message); setDot("err"); }
  id("btnA").disabled = false;
}

// ──────────────────────────────────────────────────────────────
// STATES
// ──────────────────────────────────────────────────────────────
function showScan() {
  id("scanState").style.display = "flex";
  id("resultsState").style.display = "none";
}
function showResults(data) {
  id("scanState").style.display = "none";
  id("resultsState").style.display = "block";
  renderArc(data);
  renderSummary(data);
  renderClauses(data);
}
function setScanLabel(l,s) { id("scanLbl").textContent=l; id("scanSub").textContent=s; }
function setDot(s) {
  ["sdot1","sdot2"].forEach(k => { const e=id(k); if(e) e.className="sdot "+s; });
}

// ──────────────────────────────────────────────────────────────
// SCORE ARC
// ──────────────────────────────────────────────────────────────
function renderArc(data) {
  const score  = data.risk_score || Math.round((data.risky_count/Math.max(data.total,1))*100);
  const risk   = data.overall_risk || "MEDIUM";
  const total  = data.total || 0;
  const risky  = data.risky_count || 0;
  const safe   = data.safe_count  || 0;
  const r=32, cx=46, cy=46;
  const circ  = 2*Math.PI*r;
  const offset = circ - (circ*score/100);
  const col    = risk==="HIGH" ? "#ff3b5c" : risk==="MEDIUM" ? "#ffb347" : "#00e5a0";
  const label  = risk==="HIGH" ? "⚠️ HIGH RISK" : risk==="MEDIUM" ? "⚡ MODERATE RISK" : "✅ LOW RISK";
  const sub    = risk==="HIGH"
    ? `${risky} of ${total} clauses significantly harm your rights.`
    : risk==="MEDIUM"
    ? `${risky} clauses need your attention before agreeing.`
    : "Document appears relatively fair to users.";

  id("arcWrap").innerHTML = `
    <svg width="92" height="92" viewBox="0 0 92 92" style="flex-shrink:0">
      <circle class="arc-track" cx="${cx}" cy="${cy}" r="${r}"/>
      <circle class="arc-fill" cx="${cx}" cy="${cy}" r="${r}"
        stroke="${col}" stroke-dasharray="${circ}" stroke-dashoffset="${circ}" id="arcFill"/>
      <text class="arc-num" x="${cx}" y="${cy-4}" fill="${col}">${score}</text>
      <text class="arc-denom" x="${cx}" y="${cy+12}">/100</text>
    </svg>
    <div class="score-info">
      <div class="verdict ${risk}">${label}</div>
      <div class="risk-strip"><div class="risk-strip-fill" id="rstrip" style="background:${col}"></div></div>
      <div class="verdict-sub">${sub}</div>
      <div class="score-stats">
        <div class="ss p"><strong>${total}</strong>Clauses</div>
        <div class="ss r"><strong>${risky}</strong>Risky</div>
        <div class="ss g"><strong>${safe}</strong>Safe</div>
      </div>
    </div>`;

  setTimeout(() => {
    const af = id("arcFill"); if(af) af.style.strokeDashoffset = offset;
    const rs = id("rstrip");  if(rs) rs.style.width = score+"%";
  }, 150);
}

// ──────────────────────────────────────────────────────────────
// PLAIN ENGLISH SUMMARY CARD
// ──────────────────────────────────────────────────────────────
function renderSummary(data) {
  const pts = buildSummaryPoints(data.clauses||[], data.overall_risk, data.risk_score||0);
  id("sumCard").innerHTML = `
    <div class="sum-head">🧠 What this document means for you</div>
    ${pts.map(p=>`
      <div class="sum-row">
        <span class="sum-ico">${p.icon}</span>
        <span class="sum-body">${p.html}</span>
      </div>`).join("")}`;
}

// ──────────────────────────────────────────────────────────────
// CLAUSE CARDS — per-clause individual summaries
// ──────────────────────────────────────────────────────────────
function renderClauses(data) {
  const list    = id("clauseList");
  const secLbl  = id("clauseSec");
  const clauses = data.clauses || [];
  list.innerHTML = "";

  if (secLbl) {
    secLbl.childNodes[0].nodeValue = `Clause-by-Clause Analysis — ${clauses.length} clauses · tap to expand `;
  }

  clauses.forEach((cl, i) => {
    const label   = cl.labels?.[0] || "neutral";
    const score   = cl.scores?.[0] || 0;
    const cls     = riskCls(label);
    const conf    = Math.round(score * 100);
    const rs      = cl.risk_score || 0;
    const col     = rs>=70 ? "#ff3b5c" : rs>=40 ? "#ffb347" : "#00e5a0";
    const legal   = cl.legal || {};
    const refs    = legal.references || [];
    const verdict = legal.overall_verdict || "LEGAL";
    const sum     = cl.summary || {};                  // ← per-clause individual summary from backend
    const pos     = cl.position_pct || 0;
    const posLbl  = pos>=70 ? "⚠️ Bottom" : pos>=40 ? "📍 Middle" : "📍 Top";
    const icon    = lIcon(label);
    const hidden  = !!cl.is_hidden_risk;

    // ① WHAT IT SAYS — the most important visible line
    // Uses backend per-clause summary.what_it_says if available,
    // falls back to plain_english, then raw text
    const whatItSays = sum.what_it_says || cl.plain_english || cl.text || "";

    const refsHtml = refs.slice(0,3).map(ref => {
      const vc = ref.verdict==="ILLEGAL"?"#ff3b5c":ref.verdict==="QUESTIONABLE"?"#ffb347":"#00e5a0";
      return `<div class="ref-row">
        <div class="ref-hdr" onclick="tRef(this)">
          <span class="ref-auth">${esc((ref.authority||"").split(" ").slice(0,3).join(" "))}</span>
          <span class="ref-verd" style="color:${vc}">${ref.verdict||"LEGAL"} ▾</span>
        </div>
        <div class="ref-body">
          <div class="ref-reg">${esc(ref.regulation||"")} <span style="color:var(--t3);font-weight:400">§${esc(ref.section||"")}</span></div>
          <div class="ref-jur">${esc(ref.jurisdiction||"")}</div>
          <div class="ref-sum">${esc(ref.summary||"")}</div>
          <div class="ref-you">👤 <strong>For you:</strong> ${esc(ref.plain_english||"")}</div>
          ${ref.url?`<a class="ref-link" href="${esc(ref.url)}" target="_blank">↗ Official source</a>`:""}
        </div>
      </div>`;
    }).join("");

    const vc2 = verdict==="ILLEGAL"?"#ff3b5c":verdict==="QUESTIONABLE"?"#ffb347":verdict==="REQUIRES_DISCLOSURE"?"#a594ff":"#00e5a0";

    const el = document.createElement("div");
    el.className = `cc ${cls}`;
    el.style.animationDelay = (i*0.055)+"s";
    el.innerHTML = `
      <!-- ALWAYS VISIBLE ─────────────────────── -->
      <div class="cc-top" id="ct${i}">
        <div class="dotw"><div class="dot"></div><div class="dot-ring"></div></div>
        <div class="cc-main">
          <div class="cc-tags">
            <span class="cc-tag ${cls}">${icon} ${label.toUpperCase()}</span>
            ${hidden?'<span class="cc-hidden">⚠️ HIDDEN</span>':""}
            <span class="cc-pos">${posLbl}</span>
          </div>

          <!-- ① What this clause actually says — plain English, always visible -->
          <div class="cc-what">${esc(whatItSays)}</div>

          <div class="rbar-row">
            <div class="rbar-track">
              <div class="rbar-fill" id="rf${i}" style="background:${col}"></div>
            </div>
            <span class="rbar-num" style="color:${col}">${rs}/100</span>
            <span class="rbar-conf">${conf}% conf</span>
          </div>
        </div>
        <div class="cc-chevron" id="chev${i}">▾</div>
      </div>

      <!-- FULL-WIDTH TAP HINT ─────────────────── -->
      <div class="cc-hint" id="ch${i}">
        <span class="cc-hint-txt">👆 Tap for full analysis — impact · your rights · what to do</span>
        <span class="cc-hint-arr" id="ha${i}">▼</span>
      </div>

      <!-- EXPANDABLE BODY ─────────────────────── -->
      <div class="cc-body" id="cb${i}">

        <!-- ② WHY THIS MATTERS -->
        <div class="esec why">
          <div class="elbl">⚡ Why this matters</div>
          <div class="ebox">${esc(sum.why_it_matters||"")}</div>
        </div>

        <!-- ③ YOUR LEGAL RIGHTS -->
        <div class="esec rights">
          <div class="elbl">⚖️ Your legal rights</div>
          <div class="ebox">${esc(sum.your_rights||"")}</div>
        </div>

        <!-- ④ WHAT YOU SHOULD DO -->
        <div class="esec action">
          <div class="elbl">🛠 What you should do</div>
          <div class="ebox">${esc(sum.action||"")}</div>
        </div>

        <!-- ⑤ ORIGINAL CLAUSE TEXT — verbatim from the T&C page -->
        <div class="esec origbox">
          <div class="elbl">📄 Original clause text</div>
          <div class="ebox">"${esc((cl.text||"").substring(0,340))}${(cl.text||"").length>340?"…":""}"</div>
        </div>

        <!-- ⑥ LEGAL REGULATIONS -->
        ${refs.length?`
          <div class="esec lawsec">
            <div class="elbl">📚 Applicable laws &amp; regulations</div>
            ${refsHtml}
            <div class="verd-foot">Legal verdict: <b style="color:${vc2}">${esc(sum.verdict_label||verdict)}</b></div>
          </div>`:""}

      </div>`;

    list.appendChild(el);

    // Click toggle — BOTH header and hint bar open/close
    const toggle = () => {
      const body = id(`cb${i}`), chev = id(`chev${i}`), ha = id(`ha${i}`);
      const open = body.classList.contains("open");
      body.classList.toggle("open", !open);
      chev.classList.toggle("open", !open);
      if(ha) ha.classList.toggle("open", !open);
      if(!open) setTimeout(() => { const rf=id(`rf${i}`); if(rf) rf.style.width=rs+"%"; }, 40);
    };
    id(`ct${i}`).addEventListener("click", toggle);
    id(`ch${i}`).addEventListener("click", toggle);
  });
}

// Global for legal ref accordion (called via inline onclick)
function tRef(hdr) { const b=hdr.nextElementSibling; if(b) b.classList.toggle("open"); }

// ──────────────────────────────────────────────────────────────
// HASH & STORE — with raw page text as legal evidence
// ──────────────────────────────────────────────────────────────
async function hashStore() {
  ["btnH","btnH2"].forEach(k => { const b=id(k); if(b) b.disabled=true; });
  try {
    const resp = await fetch(`${API}/hash`, {
      method:"POST",
      headers:{"Content-Type":"application/json"},
      body: JSON.stringify({
        url:      pageUrl,
        analysis: results,
        raw_text: rawText  // ← FULL T&C text from the page — legal evidence
      })
    });
    if (!resp.ok) throw new Error(`Hash error ${resp.status}`);
    const data = await resp.json();
    renderChainPanel(data);
    showToast("✓ T&C text + analysis stored as tamper-proof blockchain evidence!");
  } catch(err) {
    showToast("❌ " + err.message);
    ["btnH","btnH2"].forEach(k => { const b=id(k); if(b) b.disabled=false; });
  }
}

function renderChainPanel(data) {
  const old = id("chainPanel"); if(old) old.remove();

  const list  = id("clauseList");
  const panel = document.createElement("div");
  panel.id    = "chainPanel";
  panel.className = "chain-panel";

  const ts     = new Date(data.timestamp*1000).toLocaleString("en-IN",{dateStyle:"medium",timeStyle:"short"});
  const prev   = data.prev_hash || "";
  const isGen  = prev === "0".repeat(64) || !prev;
  const risk   = data.overall_risk || results?.overall_risk || "—";
  const rc     = risk==="HIGH"?"#ff3b5c":risk==="MEDIUM"?"#ffb347":"#00e5a0";
  const rawKb  = rawText ? (rawText.length/1024).toFixed(1) : "0";
  const rawHash = data.raw_text_hash || "";

  panel.innerHTML = `
    <div class="chain-head">
      🔗 Blockchain Evidence Record
      <span class="chain-stored">STORED</span>
    </div>
    <div class="chain-sub">
      Immutable SHA-256 proof of what this T&amp;C said at this exact moment.
      If the company changes their terms, this record proves what the original said.
    </div>

    <div class="fp-lbl">Block SHA-256 Fingerprint</div>
    <div class="hash-box" id="hashBox">
      ${data.sha256_hash||"—"}
      <span class="chint" id="chint">📋 copy</span>
    </div>

    <div class="cgrid">
      <div><div class="cg-k">Block ID</div><div class="cg-v p">#${data.block_id}</div></div>
      <div><div class="cg-k">Chain Length</div><div class="cg-v p">${data.total_entries} blocks</div></div>
      <div><div class="cg-k">Algorithm</div><div class="cg-v">SHA-256</div></div>
      <div><div class="cg-k">Stored At</div><div class="cg-v" style="font-size:9px">${ts}</div></div>
      <div><div class="cg-k">Risk Level</div><div class="cg-v" style="color:${rc}">${risk}</div></div>
      <div><div class="cg-k">Clauses Stored</div><div class="cg-v g">${results?.total||0}</div></div>
    </div>

    <!-- RAW TEXT EVIDENCE — this is what makes it useful as legal proof -->
    <div class="raw-ev">
      <div class="raw-ev-head">📜 Raw T&amp;C Page Text — Legal Evidence</div>
      <div class="raw-ev-hash">${rawHash || "(not stored — re-hash to include)"}</div>
      <div class="raw-ev-desc">
        <strong style="color:var(--g)">${rawKb} KB of verbatim T&amp;C text</strong> stored in this block.
        SHA-256 of the actual page text above is the tamper-proof fingerprint —
        if Flipkart (or any company) edits their terms later, this hash will no longer match,
        proving what the document said when you agreed.
      </div>
    </div>

    <div class="prev-box">
      <span class="prev-lbl">⛓ Previous Block Hash</span>
      ${isGen ? '<span style="color:var(--g)">Genesis — this is the first block in the chain</span>' : prev}
    </div>

    <div class="cbtns">
      <button class="cbtn" id="copyBtn">📋 Copy Hash</button>
      <button class="cbtn" id="verBtn">🛡 Verify Block</button>
    </div>
    <div class="vres" id="vres"></div>

    <div class="led-head">📒 All Stored Evidence Records</div>
    <div id="ledgerList"><div style="font-family:var(--fm);font-size:10px;color:var(--t3);padding:5px 0">Loading…</div></div>`;

  list.insertBefore(panel, list.firstChild);

  // Copy hash
  const doCopy = async () => {
    try { await navigator.clipboard.writeText(data.sha256_hash); } catch{}
    const h=id("chint"), b=id("copyBtn");
    if(h){h.textContent="✓ done";h.style.color="var(--g)";}
    if(b){b.classList.add("ok");b.textContent="✓ Copied!";}
    setTimeout(()=>{
      if(h){h.textContent="📋 copy";h.style.color="var(--t3)";}
      if(b){b.classList.remove("ok");b.textContent="📋 Copy Hash";}
    },2200);
  };
  id("hashBox").addEventListener("click", doCopy);
  id("copyBtn").addEventListener("click", doCopy);

  // Verify
  id("verBtn").addEventListener("click", async () => {
    const btn=id("verBtn"), res=id("vres");
    btn.textContent="🔄 Verifying…"; btn.disabled=true;
    try {
      const r  = await fetch(`${API}/verify/${data.block_id}`);
      const v  = await r.json();
      res.style.display = "block";
      if(v.valid) {
        res.className = "vres ok";
        res.innerHTML = `✅ VALID — Block integrity confirmed<br>
          <span style="font-size:10px;color:var(--t3)">Raw text stored: ${v.raw_text_stored?"Yes ✅":"No ⚠️"} · ${v.raw_text_kb||0}KB</span>`;
        btn.classList.add("ok"); btn.textContent="✅ Verified";
      } else {
        res.className = "vres bad";
        res.textContent="🚨 TAMPERED — Hash mismatch! Data was modified.";
        btn.classList.add("bad"); btn.textContent="🚨 Tampered";
      }
    } catch(e) {
      res.style.display="block"; res.className="vres bad";
      res.textContent="❌ "+e.message;
      btn.textContent="🛡 Verify"; btn.disabled=false;
    }
  });

  loadLedger();
}

async function loadLedger() {
  const el = id("ledgerList"); if(!el) return;
  try {
    const r    = await fetch(`${API}/ledger`);
    const data = await r.json();
    const raw  = Array.isArray(data) ? data : (data.entries||[]);
    const list = raw.slice().reverse();
    if(!list.length) {
      el.innerHTML='<div style="font-family:var(--fm);font-size:10px;color:var(--t3)">No entries yet.</div>';
      return;
    }
    el.innerHTML = list.slice(0,8).map(e => {
      const domain = (e.url||"").replace(/^https?:\/\//,"").split("/")[0].substring(0,26);
      const risk   = e.overall_risk||"—";
      const rc     = risk==="HIGH"?"#ff3b5c":risk==="MEDIUM"?"#ffb347":"#00e5a0";
      const n      = e.clauses_count||e.clauses_analyzed||0;
      const kb     = e.raw_text_kb||0;
      return `<div class="led-row">
        <span class="led-id">#${e.block_id}</span>
        <span class="led-domain">${domain||"—"}</span>
        <span class="led-risk" style="color:${rc};border-color:${rc}44;background:${rc}11">${risk}</span>
        <span class="led-meta">${n}c · ${kb}KB</span>
      </div>`;
    }).join("") + (list.length>8 ? `<div style="font-family:var(--fm);font-size:9px;color:var(--t3);text-align:center;padding:4px">+${list.length-8} more entries</div>` : "");
  } catch(e) {
    if(el) el.innerHTML='<div style="font-family:var(--fm);font-size:10px;color:var(--t3)">Could not load ledger.</div>';
  }
}

// ──────────────────────────────────────────────────────────────
// ERROR
// ──────────────────────────────────────────────────────────────
function showErr(msg) {
  id("scanState").style.display="flex";
  id("resultsState").style.display="none";
  id("scanZone").innerHTML=`<div class="empty"><div class="eico">⚠️</div>
    <p style="color:var(--r);margin-bottom:8px">${msg}</p>
    <p>Backend must be running:<br><code>python app.py</code></p></div>`;
  id("btnA").disabled=false;
  setDot("err");
}

// ──────────────────────────────────────────────────────────────
// SUMMARY POINTS (plain English overview card)
// ──────────────────────────────────────────────────────────────
function buildSummaryPoints(clauses, overallRisk, riskScore) {
  const pts     = [];
  const labels  = clauses.map(c=>c.labels?.[0]);
  const risky   = clauses.filter(c=>c.is_risky);
  const hidden  = clauses.filter(c=>c.is_hidden_risk);
  const score   = riskScore||0;
  const vc      = overallRisk==="HIGH"?"#ff3b5c":overallRisk==="MEDIUM"?"#ffb347":"#00e5a0";
  const ve      = overallRisk==="HIGH"?"🔴":overallRisk==="MEDIUM"?"🟡":"🟢";

  pts.push({icon:ve, html:
    overallRisk==="HIGH"
      ? `${ve} Risk score <strong style="color:${vc}">${score}/100 — HIGH.</strong> ${risky.length} of ${clauses.length} clauses significantly favour the company over you.`
      : overallRisk==="MEDIUM"
      ? `${ve} Risk score <strong style="color:${vc}">${score}/100 — MEDIUM.</strong> ${risky.length} clause${risky.length!==1?"s":""} need your attention before agreeing.`
      : `${ve} Risk score <strong style="color:${vc}">${score}/100 — LOW.</strong> No major violations found. Read carefully before agreeing.`
  });

  if(hidden.length>0)
    pts.push({icon:"⚠️", html:`<strong style="color:#ff3b5c">${hidden.length} dangerous clause${hidden.length>1?"s":""} buried in the final section</strong> — a deliberate tactic to hide unfavourable terms from users who don't read to the end. These include: ${hidden.slice(0,3).map(c=>c.labels?.[0]).join(", ")}.`});

  if(labels.includes("termination clause"))
    pts.push({icon:"⚡", html:`<strong>Account Termination:</strong> They can close your account without warning. CPA 2019 §2(9) requires paid-service providers to give reasonable notice before termination. File at <strong>consumerhelpline.gov.in</strong> (1800-11-4000) if terminated unfairly.`});
  if(labels.includes("auto-renewal"))
    pts.push({icon:"💳", html:`<strong>Auto-Renewal:</strong> Your card is charged automatically without asking. RBI e-Mandate Circular 2021 requires a pre-debit notification <strong>at least 24 hours before</strong> every recurring charge. Dispute via your bank if this is violated.`});
  if(labels.includes("privacy breach"))
    pts.push({icon:"👁️", html:`<strong>Data Privacy:</strong> Your personal data is collected and may be shared with third parties. DPDP Act 2023 §6 requires explicit named consent. You have the <strong>right to request deletion of your data</strong> under §12.`});
  if(labels.includes("theft"))
    pts.push({icon:"🚨", html:`<strong>Content Ownership:</strong> They claim a broad, permanent license over your content. Copyright Act 1957 §17 keeps you as the original author — but this clause may give them <strong>perpetual commercial rights</strong> even after you delete your account.`});
  if(labels.includes("arbitration"))
    pts.push({icon:"⚖️", html:`<strong>Dispute Resolution:</strong> They want to take away your right to sue in court. CPA 2019 §100 explicitly preserves your right to file in Indian consumer courts <strong>regardless of any arbitration clause</strong>.`});
  if(labels.includes("indemnification"))
    pts.push({icon:"💸", html:`<strong>Indemnification:</strong> You agree to pay the company's legal costs. Indian Contract Act §23 voids clauses that are unconscionable or against public policy — <strong>courts regularly strike down overbroad indemnity clauses</strong>.`});

  if(pts.length<=1)
    pts.push({icon:"📋", html: overallRisk==="HIGH"
      ?"Multiple clauses heavily favour the company. Consider whether this service is worth these terms."
      :"No major red flags. Standard terms — verify auto-renewal and data-sharing sections before agreeing."});
  return pts;
}

// ──────────────────────────────────────────────────────────────
// HELPERS
// ──────────────────────────────────────────────────────────────
function riskCls(label) {
  const high = ["risky","termination clause","privacy breach","theft","auto-renewal","arbitration","indemnification"];
  const low  = ["consumer-friendly","refund clause"];
  return high.includes(label)?"high":low.includes(label)?"low":"med";
}
function lIcon(label) {
  return {"termination clause":"⚡","auto-renewal":"💳","privacy breach":"👁️",
          "theft":"🚨","arbitration":"⚖️","indemnification":"💸"}[label]||"⚠️";
}
function esc(t) {
  return (t||"").replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;");
}
function showToast(msg) {
  const t=id("toast"); t.textContent=msg; t.classList.add("show");
  setTimeout(()=>t.classList.remove("show"),3500);
}

// ──────────────────────────────────────────────────────────────
// PAGE EXTRACTOR (runs inside page context via chrome.scripting)
// ──────────────────────────────────────────────────────────────
function extractPage() {
  const kw = ["terms","conditions","privacy","agree","consent","i have read","accept"];
  const hasTnC = Array.from(document.querySelectorAll('input[type="checkbox"],button,a,label'))
    .some(el=>kw.some(k=>(el.innerText||el.value||el.getAttribute("aria-label")||"").toLowerCase().includes(k)));

  const selectors = [
    '[class*="terms"]','[class*="tos"]','[class*="privacy"]',
    '[id*="terms"]','[id*="tos"]','[id*="privacy"]',
    '[class*="legal"]','[class*="agreement"]','[class*="policy"]',
    'article','main','[role="main"]','.content','#content','body'
  ];
  for(const sel of selectors) {
    try {
      const el = document.querySelector(sel);
      if(el && el.innerText.trim().length>500)
        return {text: el.innerText.trim(), hasTnC};
    } catch{}
  }
  const paras = Array.from(document.querySelectorAll("p,li,h2,h3"))
    .map(e=>e.innerText.trim()).filter(t=>t.length>40).join("\n\n");
  return {text: paras||(document.body?.innerText||""), hasTnC};
}
