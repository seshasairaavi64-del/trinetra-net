// content.js — Trinetra.net v5.0
// Fully automatic — detects T&C pages, auto-analyzes, no clicking needed

(function () {
  if (window.__trinetraActive) return;
  window.__trinetraActive = true;

  // ── YOUR RAILWAY URL — update this whenever you create a new Railway account ──
  // Step 1: Go to railway.app → your project → Settings → Networking → copy domain
  // Step 2: Paste it below (keep the https:// at the start)
  const API_BASE = "https://web-production-64028.up.railway.app";
  let analysisData  = null;
  let rawPageText   = "";   // stores the full T&C text for blockchain evidence
  let sidebarOpen   = false;
  let isAnalyzing   = false;

  // ── Detect if this is a T&C / Privacy page ─────────────────────────────────
  // Aggressive detection — checks URL, title, headings, AND body text
  function isTnCPage() {
    const url   = window.location.href.toLowerCase();
    const title = document.title.toLowerCase();

    const urlSignals = [
      "terms","privacy","policy","legal","tos","eula","agreement",
      "conditions","gdpr","consent","cookies","disclaimer","rules",
      "user-agreement","service-agreement","acceptable-use"
    ];
    const txtSignals = [
      "terms of service","terms and conditions","privacy policy",
      "user agreement","terms of use","end user license","cookie policy",
      "data policy","acceptable use","we collect","by using this service",
      "by accessing","you agree to","these terms","this agreement",
      "last updated","effective date","governing law","arbitration",
      "limitation of liability","intellectual property","termination"
    ];

    // URL match (fastest)
    if (urlSignals.some(s => url.includes(s))) return true;
    // Title match
    if (txtSignals.some(s => title.includes(s))) return true;

    // Scan first 1000 chars of body text
    const bodySnippet = (document.body?.innerText || "").substring(0, 1000).toLowerCase();
    if (txtSignals.some(s => bodySnippet.includes(s))) return true;

    // Check h1/h2 headings on the page
    const headings = Array.from(document.querySelectorAll("h1,h2"))
      .map(h => h.innerText.toLowerCase()).join(" ");
    if (txtSignals.some(s => headings.includes(s))) return true;

    return false;
  }

  // ── Detect accept checkbox / agree button on page ──────────────────────────
  function detectAcceptElement() {
    const kw = ["i agree","i accept","accept terms","agree to","terms and conditions","privacy policy","i have read","accept all"];
    const els = Array.from(document.querySelectorAll('input[type="checkbox"], button, a, label, span'));
    return els.find(el => {
      const txt = (el.innerText || el.value || el.getAttribute("aria-label") || "").toLowerCase().trim();
      return kw.some(k => txt.includes(k));
    });
  }

  // ── Intercept checkbox click (warn before accept) ──────────────────────────
  function watchAcceptButton() {
    const el = detectAcceptElement();
    if (!el) return;

    el.addEventListener("click", function(e) {
      if (!analysisData) return; // Analysis not done yet — let it through
      if (analysisData.overall_risk !== "HIGH") return; // Low risk — let through

      // HIGH risk — intercept and warn
      e.preventDefault();
      e.stopPropagation();
      showWarningModal();
    }, true);
  }

  // ── Inject styles ──────────────────────────────────────────────────────────
  const style = document.createElement("style");
  style.textContent = `
    #trinetra-root * { box-sizing: border-box; font-family: 'Segoe UI', -apple-system, sans-serif; }

    /* ── FAB Button ── */
    #tri-fab {
      position: fixed; bottom: 24px; right: 24px;
      width: 52px; height: 52px;
      background: linear-gradient(135deg, #6c5fff, #9b5de5);
      border-radius: 16px; display: flex; align-items: center;
      justify-content: center; font-size: 24px; cursor: pointer;
      z-index: 2147483640;
      box-shadow: 0 4px 24px rgba(108,95,255,0.5);
      transition: right 0.4s cubic-bezier(0.34,1.56,0.64,1), transform 0.2s;
    }
    #tri-fab:hover { transform: scale(1.08); }
    #tri-fab.sidebar-open { right: 390px; }
    #tri-fab-badge {
      position: absolute; top: -5px; right: -5px;
      min-width: 20px; height: 20px; background: #ff3b5c;
      border-radius: 10px; font-size: 10px; font-weight: 700;
      color: #fff; display: none; align-items: center;
      justify-content: center; padding: 0 4px;
      border: 2px solid #07080f;
    }
    #tri-fab-badge.show { display: flex; }
    #tri-fab-status {
      position: absolute; bottom: -3px; right: -3px;
      width: 12px; height: 12px; border-radius: 50%;
      background: #44466a; border: 2px solid #07080f; transition: background 0.3s;
    }
    #tri-fab-status.scanning { background: #6c5fff; animation: fss 0.8s ease-in-out infinite; }
    #tri-fab-status.done     { background: #00dba0; }
    #tri-fab-status.risky    { background: #ff3b5c; animation: fss 1.5s ease-in-out infinite; }
    @keyframes fss { 0%,100%{opacity:1} 50%{opacity:0.25} }
    #tri-fab-label {
      position: fixed; bottom: 84px; right: 24px;
      background: #0f1020; border: 1px solid rgba(108,95,255,0.35);
      border-radius: 10px; padding: 7px 13px; font-size: 11px; color: #9496b0;
      white-space: nowrap; z-index: 2147483640; opacity: 0;
      transition: opacity 0.3s; pointer-events: none;
    }
    #tri-fab-label.show { opacity: 1; }
    #tri-fab-label.sidebar-open { right: 390px; }
    @keyframes fabAppear {
      from { opacity:0; transform: scale(0.5) translateY(20px); }
      to   { opacity:1; transform: scale(1) translateY(0); }
    }
    #tri-fab { animation: fabAppear 0.5s cubic-bezier(0.34,1.56,0.64,1) both; }

    /* ── Sidebar ── */
    #tri-sidebar {
      position: fixed; top: 0; right: -380px; width: 368px; height: 100vh;
      background: #07080f;
      border-left: 1px solid rgba(108,95,255,0.2);
      box-shadow: -8px 0 40px rgba(0,0,0,0.6);
      z-index: 2147483639; display: flex; flex-direction: column;
      transition: right 0.38s cubic-bezier(0.4,0,0.2,1); overflow: hidden;
    }
    #tri-sidebar.open { right: 0; }

    /* Header */
    .tri-hdr {
      padding: 14px 16px 12px; flex-shrink: 0;
      background: linear-gradient(180deg, rgba(108,95,255,0.1) 0%, transparent 100%);
      border-bottom: 1px solid rgba(108,95,255,0.12);
      display: flex; align-items: center; gap: 11px; position: relative;
    }
    .tri-hdr::before {
      content: ''; position: absolute; top: 0; left: 0; right: 0; height: 2px;
      background: linear-gradient(90deg, transparent, #6c5fff 40%, #00d4ff 70%, transparent);
      opacity: 0.7;
    }
    .tri-logo-sm {
      width: 36px; height: 36px; border-radius: 10px; flex-shrink: 0;
      background: linear-gradient(135deg, #6c5fff, #9b5de5);
      display: flex; align-items: center; justify-content: center; font-size: 18px;
      box-shadow: 0 0 16px rgba(108,95,255,0.35);
    }
    .tri-hdr-text { flex: 1; min-width: 0; }
    .tri-hdr-name {
      font-size: 15px; font-weight: 700; letter-spacing: -0.01em;
      background: linear-gradient(90deg, #fff 0%, #a594ff 60%, #00d4ff 100%);
      -webkit-background-clip: text; -webkit-text-fill-color: transparent;
    }
    .tri-hdr-sub { font-size: 9px; color: #44466a; letter-spacing: 0.14em; margin-top: 1px; font-family: 'Consolas', monospace; }
    .tri-close {
      background: none; border: none; color: #44466a; font-size: 18px;
      cursor: pointer; padding: 5px; border-radius: 7px; line-height: 1;
      transition: color 0.2s, background 0.2s;
    }
    .tri-close:hover { color: #f0f1ff; background: rgba(255,255,255,0.07); }

    /* Site strip */
    .tri-site {
      padding: 9px 16px; background: rgba(255,255,255,0.02);
      border-bottom: 1px solid #0f1020; font-size: 11px;
      color: #44466a; display: flex; align-items: center; gap: 7px; flex-shrink: 0;
    }
    .tri-site span { color: #8f90b0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }

    /* ── SCORE SECTION ── */
    .tri-score-section {
      padding: 14px 16px 12px; flex-shrink: 0;
      border-bottom: 1px solid #0f1020;
    }
    .tri-score-row {
      display: flex; align-items: center; justify-content: space-between; margin-bottom: 8px;
    }
    .tri-score-label { font-size: 11px; color: #44466a; }
    .tri-score-num {
      font-size: 15px; font-weight: 800; font-family: 'Consolas', monospace;
    }
    .tri-score-num.HIGH   { color: #ff3b5c; }
    .tri-score-num.MEDIUM { color: #ffb347; }
    .tri-score-num.LOW    { color: #00dba0; }
    .tri-track {
      height: 6px; background: #131428; border-radius: 3px;
      overflow: hidden; margin-bottom: 12px;
    }
    .tri-fill {
      height: 100%; border-radius: 3px;
      background: linear-gradient(90deg, #00dba0 0%, #ffb347 50%, #ff3b5c 100%);
      transition: width 1.2s cubic-bezier(0.4,0,0.2,1);
    }
    .tri-stats { display: flex; gap: 8px; }
    .tri-stat {
      flex: 1; background: #0b0c18; border-radius: 10px;
      padding: 10px 8px; text-align: center;
      border: 1px solid #181a30;
    }
    .tri-stat .n { font-size: 22px; font-weight: 800; font-family: 'Consolas', monospace; line-height: 1; }
    .tri-stat .l { font-size: 9px; color: #44466a; margin-top: 3px; text-transform: uppercase; letter-spacing: 0.07em; }
    .tri-stat.t .n { color: #6c5fff; }
    .tri-stat.r .n { color: #ff3b5c; }
    .tri-stat.s .n { color: #00dba0; }

    /* Summary section removed */

    /* ── CLAUSE LIST ── */
    .tri-clauses { flex: 1; overflow-y: auto; padding: 10px 12px 90px; }
    .tri-clauses::-webkit-scrollbar { width: 3px; }
    .tri-clauses::-webkit-scrollbar-thumb { background: #6c5fff; border-radius: 2px; }

    /* ── CLAUSE CARDS — color-coded so dangerous vs safe is instantly obvious ── */
    .tri-card {
      border-radius: 12px; margin-bottom: 9px; overflow: hidden;
      animation: cardSlide 0.38s cubic-bezier(0.34,1.56,0.64,1) both;
      transition: transform 0.15s;
    }
    .tri-card:hover { transform: translateX(-2px); }
    @keyframes cardSlide { from{opacity:0;transform:translateX(18px)} to{opacity:1;transform:translateX(0)} }

    /* DANGEROUS — red-tinted card */
    .tri-card.red {
      background: #160810; border: 1px solid rgba(255,59,92,0.28);
      border-left: 4px solid #ff3b5c;
    }
    /* WATCH OUT — amber-tinted card */
    .tri-card.amber {
      background: #150e05; border: 1px solid rgba(255,179,71,0.25);
      border-left: 4px solid #ffb347;
    }
    /* SAFE/POSITIVE — green-tinted card — clearly different */
    .tri-card.green {
      background: #031410; border: 1px solid rgba(0,219,160,0.25);
      border-left: 4px solid #00dba0;
    }
    .tri-card.green:hover { box-shadow: 0 4px 20px rgba(0,219,160,0.12); }
    /* NEUTRAL — light blue / sky blue card */
    .tri-card.blue {
      background: #050d18; border: 1px solid rgba(0,180,255,0.25);
      border-left: 4px solid #00b4ff;
    }
    .tri-card.blue:hover  { box-shadow: 0 4px 20px rgba(0,180,255,0.14); }

    .tri-icon {
      width: 30px; height: 30px; border-radius: 8px; flex-shrink: 0;
      display: flex; align-items: center; justify-content: center; font-size: 14px;
    }
    .tri-icon.red   { background: rgba(255,59,92,0.15); }
    .tri-icon.amber { background: rgba(255,179,71,0.15); }
    .tri-icon.green { background: rgba(0,219,160,0.15); }
    .tri-icon.blue  { background: rgba(0,180,255,0.15); }

    .tri-label { font-size: 9.5px; font-weight: 800; text-transform: uppercase; letter-spacing: 0.05em; }
    .tri-label.red   { color: #ff3b5c; }
    .tri-label.amber { color: #ffb347; }
    .tri-label.green { color: #00dba0; }
    .tri-label.blue  { color: #00b4ff; }

    /* ── FOOTER ── */
    .tri-footer {
      position: absolute; bottom: 0; left: 0; right: 0;
      padding: 11px 14px;
      background: linear-gradient(0deg, #07080f 85%, transparent);
      display: flex; gap: 8px;
    }
    .tri-btn {
      flex: 1; padding: 10px; border-radius: 9px;
      font-size: 12px; font-weight: 700; cursor: pointer;
      transition: all 0.2s; display: flex; align-items: center;
      justify-content: center; gap: 6px; border: none;
    }
    .tri-btn-primary {
      background: linear-gradient(135deg, #6c5fff, #9b5de5); color: #fff;
      box-shadow: 0 4px 16px rgba(108,95,255,0.3);
    }
    .tri-btn-primary:hover { transform: translateY(-1px); box-shadow: 0 6px 24px rgba(108,95,255,0.4); }
    .tri-btn-outline { background: rgba(0,219,160,0.09); color: #00dba0; border: 1px solid rgba(0,219,160,0.25); }
    .tri-btn-outline:hover { background: rgba(0,219,160,0.15); }
    .tri-btn:disabled { opacity: 0.28; cursor: not-allowed; transform: none !important; }

    /* ── TOAST ── */
    .tri-toast {
      position: fixed; bottom: 90px; right: 28px; width: 300px;
      background: #0d0e1f; border: 1px solid rgba(108,95,255,0.3);
      border-radius: 14px; padding: 13px 14px; z-index: 2147483638;
      box-shadow: 0 8px 40px rgba(0,0,0,0.7);
      animation: toastIn 0.4s cubic-bezier(0.34,1.56,0.64,1) both;
      cursor: pointer; overflow: hidden;
    }
    .tri-toast.sidebar-open { right: 396px; }
    @keyframes toastIn  { from{opacity:0;transform:translateY(20px) scale(0.95)} to{opacity:1;transform:none} }
    @keyframes toastOut { to  {opacity:0;transform:translateY(10px) scale(0.96)} }
    .tri-toast.out { animation: toastOut 0.3s ease forwards; }
    .tri-toast-hdr { display: flex; align-items: center; gap: 9px; margin-bottom: 7px; }
    .tri-toast-icon {
      width: 30px; height: 30px; border-radius: 8px;
      display: flex; align-items: center; justify-content: center; font-size: 15px; flex-shrink: 0;
    }
    .tri-toast-icon.HIGH   { background: rgba(255,59,92,0.15); }
    .tri-toast-icon.MEDIUM { background: rgba(255,179,71,0.15); }
    .tri-toast-icon.LOW    { background: rgba(0,219,160,0.15); }
    .tri-toast-title { font-size: 12px; font-weight: 700; color: #f0f1ff; flex: 1; }
    .tri-toast-x { background: none; border: none; color: #44466a; font-size: 16px; cursor: pointer; padding: 0; }
    .tri-toast-body { font-size: 11px; color: #8f90b0; line-height: 1.55; margin-bottom: 8px; }
    .tri-toast-problem { font-size: 10px; color: #ff8099; padding: 6px 9px; background: rgba(255,59,92,0.07); border-left: 2px solid #ff3b5c; border-radius: 0 6px 6px 0; margin-bottom: 5px; }
    .tri-toast-solution { font-size: 10px; color: #9afce0; padding: 6px 9px; background: rgba(0,219,160,0.07); border-left: 2px solid #00dba0; border-radius: 0 6px 6px 0; margin-bottom: 8px; }
    .tri-toast-footer { display: flex; align-items: center; justify-content: space-between; }
    .tri-toast-reg { font-size: 9px; font-family: 'Consolas', monospace; color: #6c5fff; background: rgba(108,95,255,0.1); border: 1px solid rgba(108,95,255,0.2); padding: 2px 8px; border-radius: 20px; }
    .tri-toast-cta { font-size: 10px; font-weight: 700; color: #6c5fff; background: none; border: none; cursor: pointer; text-decoration: underline; }
    .tri-toast-bar { position: absolute; bottom: 0; left: 0; height: 2px; background: linear-gradient(90deg, #6c5fff, #9b5de5); border-radius: 0 0 14px 14px; animation: drainBar linear forwards; }
    @keyframes drainBar { from{width:100%} to{width:0%} }

    /* ── WARNING MODAL ── */
    #tri-modal-overlay {
      position: fixed; inset: 0; background: rgba(0,0,0,0.75);
      z-index: 2147483641; display: none; align-items: center;
      justify-content: center; backdrop-filter: blur(4px);
    }
    #tri-modal-overlay.show { display: flex; }
    #tri-modal {
      background: #0b0c1a; border: 1px solid rgba(255,59,92,0.35);
      border-radius: 18px; padding: 28px 24px; max-width: 360px; width: 90%;
      box-shadow: 0 20px 80px rgba(0,0,0,0.8);
      animation: modalIn 0.4s cubic-bezier(0.34,1.56,0.64,1) both;
    }
    @keyframes modalIn { from{opacity:0;transform:scale(0.88)} to{opacity:1;transform:scale(1)} }
    .tri-modal-icon { font-size: 36px; text-align: center; margin-bottom: 10px; }
    .tri-modal-title { font-size: 18px; font-weight: 800; color: #ff3b5c; text-align: center; margin-bottom: 8px; }
    .tri-modal-sub { font-size: 12.5px; color: #8f90b0; text-align: center; line-height: 1.6; margin-bottom: 16px; }
    .tri-modal-risk { background: rgba(255,59,92,0.07); border: 1px solid rgba(255,59,92,0.2); border-radius: 10px; padding: 11px 13px; margin-bottom: 16px; font-size: 12px; color: #ff8099; line-height: 1.65; }
    .tri-modal-btns { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; }
    .tri-modal-btn { padding: 11px; border-radius: 10px; font-size: 13px; font-weight: 700; cursor: pointer; transition: all 0.2s; }
    .tri-modal-review { background: linear-gradient(135deg, #6c5fff, #9b5de5); color: #fff; border: none; box-shadow: 0 4px 16px rgba(108,95,255,0.3); }
    .tri-modal-review:hover { transform: translateY(-1px); }
    .tri-modal-proceed { background: transparent; color: #44466a; border: 1px solid #1c1e38; }
    .tri-modal-proceed:hover { color: #f0f1ff; border-color: #44466a; }

    /* ── INLINE HIGHLIGHT ── */
    .tri-hl {
      background: rgba(255,59,92,0.12);
      border-bottom: 2px solid #ff3b5c;
      border-radius: 3px;
      cursor: pointer;
      transition: background 0.2s, box-shadow 0.2s;
      position: relative;
    }
    .tri-hl:hover {
      background: rgba(255,59,92,0.28);
      box-shadow: 0 0 0 2px rgba(255,59,92,0.2);
    }
    .tri-hl:hover::after {
      content: "👆 Click — see analysis";
      position: absolute;
      top: -26px; left: 50%; transform: translateX(-50%);
      background: #ff3b5c; color: #fff;
      font-size: 10px; font-weight: 700; white-space: nowrap;
      padding: 2px 8px; border-radius: 6px;
      pointer-events: none; z-index: 2147483640;
      font-family: "Segoe UI", sans-serif;
    }
    .tri-hl.amber { background: rgba(255,179,71,0.12); border-bottom-color: #ffb347; }
    .tri-hl.amber:hover { background: rgba(255,179,71,0.28); box-shadow: 0 0 0 2px rgba(255,179,71,0.2); }
    .tri-hl.amber:hover::after { background: #ffb347; color: #000; }
    .tri-hl.green { background: rgba(0,219,160,0.1); border-bottom-color: #00dba0; }
    .tri-hl.green:hover { background: rgba(0,219,160,0.25); box-shadow: 0 0 0 2px rgba(0,219,160,0.2); }
    .tri-hl.green:hover::after { background: #00dba0; color: #000; }
    .tri-hl.blue  {
      background: rgba(0,180,255,0.08);
      border-bottom: 2px solid #00b4ff;
      border-radius: 3px; cursor: pointer;
      transition: background 0.2s, box-shadow 0.2s;
    }
    .tri-hl.blue:hover {
      background: rgba(0,180,255,0.22);
      box-shadow: 0 0 0 2px rgba(0,180,255,0.18);
    }
    .tri-hl.blue:hover::after {
      content: "💡 Neutral clause — click to see analysis";
      position: absolute; top: -28px; left: 50%; transform: translateX(-50%);
      background: #00b4ff; color: #000;
      font-size: 10px; font-weight: 700; white-space: nowrap;
      padding: 3px 9px; border-radius: 6px; pointer-events: none;
      z-index: 2147483640; font-family: "Segoe UI", sans-serif;
    }
    /* Consumer-friendly green highlight */
    .tri-hl.green:hover::after {
      content: "✅ Consumer-friendly — click to see analysis";
      background: #00dba0; color: #000;
    }

    /* ── BLOCKCHAIN PANEL (minimal, inside clauses scroll area) ── */
    .tri-chain-panel {
      background: rgba(108,95,255,0.06); border: 1px solid rgba(108,95,255,0.2);
      border-radius: 12px; padding: 13px; margin-bottom: 10px;
    }
    .tri-chain-title {
      font-size: 9px; font-family: 'Consolas', monospace;
      color: #6c5fff; text-transform: uppercase; letter-spacing: 0.14em;
      margin-bottom: 10px; display: flex; align-items: center; gap: 6px;
    }
    .tri-chain-title::after { content: ''; flex: 1; height: 1px; background: rgba(108,95,255,0.2); }
    .tri-hash-box {
      background: #020305; border: 1px solid #131428;
      border-radius: 8px; padding: 9px 11px; font-family: 'Consolas', monospace;
      font-size: 8.5px; color: #6c5fff; word-break: break-all;
      line-height: 1.9; margin-bottom: 9px; cursor: pointer; position: relative;
      transition: border-color 0.2s;
    }
    .tri-hash-box:hover { border-color: #6c5fff; }
    .tri-chain-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 7px; margin-bottom: 9px; }
    .tri-chain-item { background: rgba(255,255,255,0.02); border: 1px solid #131428; border-radius: 7px; padding: 7px 9px; }
    .tri-chain-item .ci-label { font-size: 8.5px; color: #44466a; font-family: 'Consolas', monospace; text-transform: uppercase; letter-spacing: 0.06em; margin-bottom: 2px; }
    .tri-chain-item .ci-val { font-size: 11px; color: #f0f1ff; font-weight: 600; font-family: 'Consolas', monospace; word-break: break-all; }
    .tri-chain-item .ci-val.green { color: #00dba0; }
    .tri-chain-item .ci-val.purple { color: #a594ff; }
    .tri-verify-btn { width: 100%; padding: 8px; border-radius: 8px; background: transparent; color: #6c5fff; border: 1px solid rgba(108,95,255,0.3); font-size: 11px; font-weight: 700; cursor: pointer; transition: all 0.2s; margin-bottom: 6px; }
    .tri-verify-btn:hover { background: rgba(108,95,255,0.08); border-color: #6c5fff; }
    .tri-verify-result { font-size: 11px; text-align: center; padding: 8px; border-radius: 7px; margin-top: 6px; display: none; }
    .tri-verify-result.valid   { color: #00dba0; background: rgba(0,219,160,0.08); border: 1px solid rgba(0,219,160,0.2); }
    .tri-verify-result.invalid { color: #ff3b5c; background: rgba(255,59,92,0.08); border: 1px solid rgba(255,59,92,0.2); }
    .tri-ledger-entry {
      background: #0a0b15; border: 1px solid #131428;
      border-radius: 8px; padding: 8px 10px; margin-bottom: 5px;
      font-size: 9.5px; font-family: 'Consolas', monospace;
      display: flex; align-items: center; gap: 8px;
    }
    .tri-ledger-entry .le-id    { color: #a594ff; font-weight: 700; flex-shrink: 0; }
    .tri-ledger-entry .le-url   { color: #44466a; flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .tri-ledger-entry .le-risk  { font-size: 8px; font-weight: 700; padding: 1px 6px; border-radius: 20px; border: 1px solid; flex-shrink: 0; }
    .tri-ledger-entry .le-risk.HIGH   { color: #ff3b5c; border-color: rgba(255,59,92,0.3); background: rgba(255,59,92,0.08); }
    .tri-ledger-entry .le-risk.MEDIUM { color: #ffb347; border-color: rgba(255,179,71,0.3); background: rgba(255,179,71,0.08); }
    .tri-ledger-entry .le-risk.LOW    { color: #00dba0; border-color: rgba(0,219,160,0.3); background: rgba(0,219,160,0.08); }
  `;
  document.head.appendChild(style);


  // ── Real-world problem/solution database ───────────────────────────────────
  const REAL_WORLD = {
    "termination clause": {
      problem:  "🌍 Real Case: In 2021, thousands of Paytm users had accounts frozen without notice, losing access to wallet balances. In 2018, Google+ users lost all data when the service shut down abruptly with minimal warning.",
      solution: "✅ Your Right: Under RBI PPI guidelines and CPA 2019, paid service providers MUST give 30-day notice + refund outstanding balance. File complaint at consumer.gov.in or RBI Ombudsman.",
      reg:      "RBI/2021-22 + CPA 2019 §2(46)"
    },
    "privacy breach": {
      problem:  "🌍 Real Case: In 2023, a major Indian edtech leaked 2M+ student records. WhatsApp faced €225M GDPR fine for opaque data sharing. Cambridge Analytica harvested 87M Facebook profiles without clear consent.",
      solution: "✅ Your Right: DPDP Act 2023 gives you the right to know exactly what data is collected, demand deletion within 72 hours, and receive ₹250 crore compensation for wilful breaches.",
      reg:      "DPDP Act 2023 §6 + IT Act §43A"
    },
    "auto-renewal": {
      problem:  "🌍 Real Case: Amazon Prime users reported unexpected yearly charges after free trials. Indian streaming apps faced CCPA notices for hiding auto-renewal terms in fine print. US FTC fined companies $billions for dark patterns.",
      solution: "✅ Your Right: RBI mandates pre-debit SMS/email 24hrs before any auto-charge. You can raise a chargeback with your bank within 30 days for unauthorized auto-renewals. File at pgportal.gov.in.",
      reg:      "RBI e-Mandate Circular 2021"
    },
    "theft": {
      problem:  "🌍 Real Case: Instagram's 2012 T&C update claimed rights to sell user photos — massive backlash forced a reversal. Fiverr and similar platforms have faced lawsuits over overly broad IP clauses stripping freelancer rights.",
      solution: "✅ Your Right: Under Copyright Act 1957 §17, YOU are the first owner of your creative work. Platforms can only use it under specific, limited licenses — not claim ownership. Challenge any broad assignment clause.",
      reg:      "Copyright Act 1957 §17 + §57"
    },
    "refund clause": {
      problem:  "🌍 Real Case: MakeMyTrip and OYO faced consumer court orders to refund non-refundable tickets during COVID. Courts consistently ruled that blanket no-refund policies for defective services are unenforceable.",
      solution: "✅ Your Right: CPA 2019 §2(9) guarantees the right to seek redressal for deficient services regardless of no-refund clauses. Consumer courts have 90-day resolution mandate. File at edaakhil.nic.in.",
      reg:      "CPA 2019 §2(9) + NCDRC precedent"
    },
    "risky": {
      problem:  "🌍 Real Case: Uber's T&C 'sole discretion' clauses were challenged in multiple countries. Courts in UK and India have struck down sweeping indemnity and liability waiver clauses as unfair contract terms.",
      solution: "✅ Your Right: Indian Contract Act 1872 §23 voids contracts against public policy. CPA 2019 §2(46) explicitly lists unfair contract terms as actionable. Courts can strike down unconscionable clauses.",
      reg:      "ICA 1872 §23 + CPA 2019 §2(46)"
    },
    "consumer-friendly": {
      problem:  "✅ This clause appears to be in your favor.",
      solution: "✅ This is a positive sign. The company has included consumer-protective language. Verify it's not offset by other restrictive clauses elsewhere in the document.",
      reg:      "CPA 2019 — Compliant"
    },
    "neutral": {
      problem:  "📋 Standard legal boilerplate — low risk.",
      solution: "✅ This clause is routine contract language. No major consumer concern identified under current Indian law.",
      reg:      "ICA 1872 §10 — Standard"
    },
    "arbitration": {
      problem:  "⚖️ You cannot join class-action lawsuits or go to court. Uber, Amazon and Byju's used these clauses — Indian courts have started striking them down.",
      solution: "✅ Under CPA 2019 §100, Indian consumers can still file in consumer courts. In the EU, GDPR disputes go to data protection authorities regardless of this clause.",
      reg:      "CPA 2019 §100 · Arbitration Act 1996 §7"
    },
    "indemnification": {
      problem:  "💸 You become the company's legal shield. Zomato and Ola riders faced clauses making them liable for customer claims — platforms used this to avoid paying damages.",
      solution: "✅ Indian Contract Act §23 voids clauses that are unconscionable. If a company tries to enforce this against you, file in consumer court — these clauses are often struck down.",
      reg:      "Indian Contract Act 1872 §23 · CPA 2019"
    }
  };

  // ── Build UI ───────────────────────────────────────────────────────────────
  const root = document.createElement("div");
  root.id = "trinetra-root";
  document.body.appendChild(root);

  const fab = document.createElement("div");
  fab.id = "tri-fab";
  fab.innerHTML = `👁️<div id="tri-fab-badge"></div><div id="tri-fab-status"></div>`;
  root.appendChild(fab);

  const fabLabel = document.createElement("div");
  fabLabel.id = "tri-fab-label";
  root.appendChild(fabLabel);

  const sidebar = document.createElement("div");
  sidebar.id = "tri-sidebar";
  sidebar.innerHTML = `
    <div class="tri-hdr">
      <div class="tri-logo-sm">👁️</div>
      <div class="tri-hdr-text">
        <div class="tri-hdr-name">Trinetra.net</div>
        <div class="tri-hdr-sub">LEGAL INTELLIGENCE ENGINE</div>
      </div>
      <button class="tri-close" id="tri-close-btn">✕</button>
    </div>

    <div class="tri-site">🌐 <span id="tri-site-name">${document.title.substring(0,55)}</span></div>

    <!-- SCORE -->
    <div class="tri-score-section">
      <div class="tri-score-row">
        <span class="tri-score-label">Overall Risk Score</span>
        <span class="tri-score-num" id="tri-meter-val">Analyzing…</span>
      </div>
      <div class="tri-track"><div class="tri-fill" id="tri-fill" style="width:0%"></div></div>
      <div class="tri-stats" id="tri-stats" style="display:none">
        <div class="tri-stat t"><div class="n" id="ts-total">0</div><div class="l">Clauses</div></div>
        <div class="tri-stat r"><div class="n" id="ts-risky">0</div><div class="l">Risky</div></div>
        <div class="tri-stat s"><div class="n" id="ts-safe">0</div><div class="l">Safe</div></div>
      </div>
    </div>

    <!-- CLAUSE LIST -->
    <div class="tri-clauses" id="tri-clauses">
      <div style="text-align:center;padding:40px 16px;color:#44466a;font-size:12px">
        <div style="font-size:36px;margin-bottom:12px">👁️</div>
        <div style="color:#8f90b0;margin-bottom:4px">Trinetra is scanning this page…</div>
      </div>
    </div>

    <!-- FOOTER: only 2 buttons -->
    <div class="tri-footer">
      <button class="tri-btn tri-btn-primary" id="tri-btn-reanalyze">🔄 Re-Analyze</button>
      <button class="tri-btn tri-btn-outline" id="tri-btn-hash" disabled>✅ Stored</button>
    </div>
  `;
  root.appendChild(sidebar);

  const modal = document.createElement("div");
  modal.id = "tri-modal-overlay";
  modal.innerHTML = `
    <div id="tri-modal">
      <div class="tri-modal-icon">⚠️</div>
      <div class="tri-modal-title">High Risk Document</div>
      <div class="tri-modal-sub">Trinetra found serious clauses.<br>Are you sure you want to agree?</div>
      <div class="tri-modal-risk" id="tri-modal-risk-list"></div>
      <div class="tri-modal-btns">
        <button class="tri-modal-btn tri-modal-review" id="tri-modal-review">👁️ Review First</button>
        <button class="tri-modal-btn tri-modal-proceed" id="tri-modal-proceed">Proceed Anyway</button>
      </div>
    </div>
  `;
  root.appendChild(modal);

  // ── Events ─────────────────────────────────────────────────────────────────
  fab.addEventListener("click", toggleSidebar);
  document.getElementById("tri-close-btn").addEventListener("click", () => setSidebar(false));
  document.getElementById("tri-btn-reanalyze").addEventListener("click", startAnalysis);
  document.getElementById("tri-btn-hash").addEventListener("click", doHash);
  document.getElementById("tri-modal-review").addEventListener("click", () => {
    modal.classList.remove("show");
    setSidebar(true);
  });
  document.getElementById("tri-modal-proceed").addEventListener("click", () => {
    modal.classList.remove("show");
    // Actually click the original element
    const el = detectAcceptElement();
    if (el) el.click();
  });

  function toggleSidebar() { setSidebar(!sidebarOpen); }
  function setSidebar(open) {
    sidebarOpen = open;
    sidebar.classList.toggle("open", open);

    // Move FAB and fab-label to the LEFT of sidebar when it opens
    // so they never overlap the sidebar content
    fab.classList.toggle("sidebar-open", open);
    fabLabel.classList.toggle("sidebar-open", open);

    // Also shift any visible toasts
    document.querySelectorAll(".tri-toast").forEach(t => {
      t.style.right = open ? "396px" : "28px";
    });
  }

  // ── FAB label helper ───────────────────────────────────────────────────────
  function setFabLabel(text, duration = 3000) {
    fabLabel.textContent = text;
    fabLabel.classList.add("show");
    if (duration) setTimeout(() => fabLabel.classList.remove("show"), duration);
  }

  // ── Auto-start ─────────────────────────────────────────────────────────────
  function autoStart() {
    if (!isTnCPage()) return;
    setSidebar(true);
    setFabStatus("scanning");
    setFabLabel("T&C detected — auto-analyzing now…", 0);
    fab.classList.add("pulse");
    setTimeout(() => startAnalysis(), 800);
  }

  // Background service worker URL trigger
  try {
    chrome.runtime.onMessage.addListener((msg) => {
      if (msg.type === "TNC_PAGE_DETECTED" && !isAnalyzing && !analysisData) {
        setSidebar(true);
        setFabStatus("scanning");
        fab.classList.add("pulse");
        setTimeout(() => startAnalysis(), 800);
      }
    });
  } catch(e) {}

  // ── Main analysis ──────────────────────────────────────────────────────────
  async function startAnalysis() {
    if (isAnalyzing) return;
    isAnalyzing = true;
    fab.classList.add("pulse");
    setFabStatus("scanning");
    setFabLabel("Scanning full T&C document…", 0);
    document.getElementById("tri-btn-reanalyze").disabled = true;
    setSidebar(true);

    updateSidebarScanning();

    try {
      // Extract full page text — this is the evidence stored in blockchain
      const text   = extractText();
      rawPageText  = text;   // save for doHash
      const hasTnC = !!detectAcceptElement();

      if (!text || text.length < 80) {
        setFabLabel("No T&C text found", 3000);
        setFabStatus("");
        fab.classList.remove("pulse");
        isAnalyzing = false;
        updateSidebarEmpty();
        return;
      }

      setFabLabel("AI analyzing full document…", 0);

      // Health check — verifies Railway backend is running
      try {
        const hRes = await fetch(`${API_BASE}/health`, {
          signal: AbortSignal.timeout(8000)   // 8s — Railway free tier may have cold start
        });
        if (!hRes.ok) throw new Error(`Server returned ${hRes.status}`);
      } catch(e) {
        // Give helpful Railway-specific error message
        if (e.name === "TimeoutError" || e.message.includes("fetch")) {
          throw new Error("Server is starting up — please wait 30 seconds and try again. Railway free tier sleeps after inactivity.");
        }
        throw new Error("Server unreachable: " + e.message.substring(0, 60));
      }

      // Use SSE streaming — shows live results as each clause is found
      const data = await analyzeWithStream(text, location.href, document.title);
      analysisData = data;

      // Update FAB
      setFabBadge(data.risky_count);
      setFabStatus(data.overall_risk === "HIGH" ? "risky" : "done");

      const hiddenMsg  = data.hidden_risks > 0
        ? ` · ⚠️ ${data.hidden_risks} HIDDEN at bottom!`
        : "";
      const docKb = data.doc_length ? ` · ${Math.round(data.doc_length/1024)}KB scanned` : "";
      setFabLabel(`${data.overall_risk} Risk — ${data.risky_count}/${data.total} risky${hiddenMsg}${docKb}`, 8000);
      fab.classList.remove("pulse");

      // Show hidden risk banner if any
      if (data.hidden_risks > 0) {
        const banner = document.createElement("div");
        banner.style.cssText = `
          position:fixed;top:0;left:0;right:360px;
          background:linear-gradient(90deg,rgba(255,77,109,0.15),rgba(255,77,109,0.05));
          border-bottom:1px solid rgba(255,77,109,0.4);
          padding:10px 20px;font-family:'DM Sans',sans-serif;
          font-size:12px;color:#ff8fa0;z-index:2147483637;
          display:flex;align-items:center;gap:10px;
          animation:toastIn 0.4s ease both;
        `;
        banner.innerHTML = `
          <span style="font-size:16px">⚠️</span>
          <span><strong>${data.hidden_risks} high-risk clause${data.hidden_risks > 1 ? "s" : ""} found buried in the bottom section</strong> of this document — the most dangerous part companies hide. Click 👁️ to review.</span>
          <button onclick="this.parentElement.remove()" style="margin-left:auto;background:none;border:none;color:#ff8fa0;font-size:18px;cursor:pointer">✕</button>
        `;
        document.body.appendChild(banner);
        setTimeout(() => banner.remove(), 12000);
      }

      // Update sidebar stats + summary
      updateSidebarStats(data);
      highlightPage(data);
      showToastsSequential(data);
      watchAcceptButton();

      if (data.overall_risk === "HIGH" || data.hidden_risks > 0) setSidebar(true);
      document.getElementById("tri-btn-hash").disabled = false;

      // Auto-hash after analysis — no manual clicking needed
      setTimeout(() => doHash(), 1200);

    } catch(err) {
      console.error("Trinetra:", err);
      setFabLabel("Error: " + err.message.substring(0, 40), 5000);
      setFabStatus("");
      fab.classList.remove("pulse");
      updateSidebarError(err.message);
    }

    isAnalyzing = false;
    document.getElementById("tri-btn-reanalyze").disabled = false;
  }

  // ── Extract FULL page text — NO character limit ──────────────────────────
  function extractText() {
    // Priority 1: T&C specific containers
    const specific = [
      '[class*="terms"]','[class*="tos"]','[class*="privacy"]',
      '[id*="terms"]','[id*="tos"]','[id*="privacy"]',
      '[class*="legal"]','[class*="agreement"]','[class*="policy"]',
      '[class*="document"]','[class*="content-body"]','[class*="page-content"]'
    ];
    for (const sel of specific) {
      try {
        const el = document.querySelector(sel);
        if (el && el.innerText.trim().length > 500)
          return cleanText(el.innerText.trim());
      } catch(e) {}
    }

    // Priority 2: Semantic containers
    const semantic = ['article','main','[role="main"]','#main-content','.main-content','.content','#content'];
    for (const sel of semantic) {
      try {
        const el = document.querySelector(sel);
        if (el && el.innerText.trim().length > 500)
          return cleanText(el.innerText.trim());
      } catch(e) {}
    }

    // Priority 3: Gather ALL paragraphs, list items, headings from entire page
    // This ensures bottom-of-page content is included
    const allParas = Array.from(document.querySelectorAll("p, li, h1, h2, h3, h4, h5, dt, dd, blockquote"))
      .filter(el => !el.closest("#trinetra-root"))   // skip our own UI
      .map(el => el.innerText.trim())
      .filter(t => t.length > 20)
      .join("\n\n");

    if (allParas.length > 500) return cleanText(allParas);

    // Last resort: entire body
    return cleanText(document.body?.innerText || "");
  }

  function cleanText(text) {
    return text
      .replace(/\t/g, " ")
      .replace(/[ ]{3,}/g, "  ")
      .replace(/\n{4,}/g, "\n\n\n")
      .trim();
    // NO .substring() — the full document is sent to backend
  }

  // ── Reliable analysis fetch — simple POST, animated waiting UI ──────────────
  // (SSE/ReadableStream is blocked in Chrome extension content scripts)
  async function analyzeWithStream(text, url, title) {
    const kb = Math.round(text.length / 1024);
    let elapsed = 0;

    // Animated scanning UI while waiting
    const clauseList = document.getElementById("tri-clauses");
    clauseList.innerHTML = `
      <div class="tri-sec-label" style="padding:4px 4px 8px">Full Document Scan</div>
      <div id="tri-live-progress" style="
        padding:12px 14px;background:#0d0e1f;border:1px solid #1c1e38;
        border-radius:10px;font-size:11px;color:#9899ba;font-family:'DM Mono',monospace;
        line-height:1.8;
      ">
        <div id="tri-scan-step">&#9679; Reading ${kb}KB document…</div>
        <div style="height:4px;background:#1c1e38;border-radius:2px;margin-top:10px;overflow:hidden">
          <div id="tri-scan-bar" style="height:100%;width:0%;background:linear-gradient(90deg,#7c73ff,#a855f7);border-radius:2px;transition:width 0.5s ease"></div>
        </div>
        <div id="tri-scan-elapsed" style="font-size:9px;color:#5a5c7a;margin-top:6px">0s elapsed</div>
      </div>
    `;

    // Pulse the progress bar and update elapsed time while waiting
    const steps = [
      [1,  "&#9679; Splitting document into sections…", 15],
      [3,  "&#9679; Extracting high-value clauses…", 30],
      [6,  "&#9679; AI classifying clauses (top section)…", 50],
      [12, "&#9679; AI classifying clauses (middle section)…", 65],
      [20, "&#9679; AI classifying clauses (bottom section)…", 80],
      [28, "&#9679; Cross-referencing legal regulations…", 92],
    ];
    const ticker = setInterval(() => {
      elapsed++;
      const el = document.getElementById("tri-scan-elapsed");
      if (el) el.textContent = `${elapsed}s elapsed…`;
      const step = steps.filter(s => s[0] <= elapsed).pop();
      if (step) {
        const stepEl = document.getElementById("tri-scan-step");
        const barEl  = document.getElementById("tri-scan-bar");
        if (stepEl) stepEl.innerHTML = step[1];
        if (barEl)  barEl.style.width = step[2] + "%";
      }
      setFabLabel(`Analyzing… ${elapsed}s`, 0);
    }, 1000);

    try {
      const controller = new AbortController();
      const timeoutId  = setTimeout(() => controller.abort(), 120000);

      const response = await fetch(`${API_BASE}/analyze`, {
        method:  "POST",
        headers: { "Content-Type": "application/json" },
        body:    JSON.stringify({ text, url, title }),
        signal:  controller.signal
      });

      clearTimeout(timeoutId);
      clearInterval(ticker);

      if (!response.ok) {
        const errText = await response.text().catch(() => "");
        throw new Error(`Server error ${response.status}: ${errText.substring(0, 80)}`);
      }

      const data = await response.json();

      // Animate bar to 100%
      const barEl = document.getElementById("tri-scan-bar");
      if (barEl) barEl.style.width = "100%";
      await new Promise(r => setTimeout(r, 300));

      return data;

    } catch(err) {
      clearInterval(ticker);
      if (err.name === "AbortError")
        throw new Error("Timed out after 120s. Document may be very large — try re-analyzing.");
      throw err;
    }
  }

  // ── Render one clause card ────────────────────────────────────────────────
  function renderLiveCard(clause, idx) {
    const clauseList = document.getElementById("tri-clauses");
    const label  = clause.labels[0] || "neutral";
    const color  = getColor(label);
    const icon   = getIcon(label);
    const rs     = clause.risk_score || 0;
    const conf   = Math.round((clause.scores[0] || 0) * 100);
    const pos    = clause.position_pct || 0;
    const sum    = clause.summary || {};
    const refs   = (clause.legal?.references || []).slice(0, 2);

    const hex = color === "red"   ? "#ff3b5c"
                : color === "amber" ? "#ffb347"
                : color === "blue"  ? "#00b4ff"
                : "#00dba0";  // green
    const posLabel = pos >= 70 ? "⚠️ Bottom" : pos >= 40 ? "📍 Middle" : "📍 Top";

    // ① What this clause says — show immediately, no click needed
    const whatItSays = sum.what_it_says || clause.plain_english || clause.text || "";

    const refHtml = refs.map(r => `
      <div style="padding:8px 10px;background:rgba(108,95,255,0.06);border:1px solid rgba(108,95,255,0.14);border-radius:8px;margin-bottom:5px">
        <div style="font-size:10px;font-weight:700;color:#a594ff;margin-bottom:2px">${escH(r.regulation||"")} §${escH(r.section||"")}</div>
        <div style="font-size:10.5px;color:#8f90b0;line-height:1.6">${escH(r.plain_english || r.summary || "")}</div>
      </div>`).join("");

    const verdictCol = (sum.verdict_label||"").includes("ILLEGAL") ? "#ff3b5c"
                     : (sum.verdict_label||"").includes("QUESTION") ? "#ffb347" : "#00dba0";

    const card = document.createElement("div");
    card.className = `tri-card ${color}`;
    card.id = `tricard-${idx}`;
    card.style.animationDelay = (idx * 0.05) + "s";

    card.innerHTML = `
      <!-- VISIBLE TOP — always shown ──────────────────── -->
      <div style="padding:12px 13px 10px;display:flex;align-items:flex-start;gap:10px">
        <div class="tri-icon ${color}" style="margin-top:2px">${icon}</div>
        <div style="flex:1;min-width:0">

          <div style="display:flex;align-items:center;gap:6px;margin-bottom:6px;flex-wrap:wrap">
            <span class="tri-label ${color}">${label.toUpperCase()}</span>
            ${clause.is_hidden_risk
              ? `<span style="font-size:8px;background:rgba(255,59,92,0.14);color:#ff3b5c;border:1px solid rgba(255,59,92,0.3);padding:1px 7px;border-radius:20px">⚠️ HIDDEN</span>`
              : ""}
            <span style="font-size:8px;color:#44466a;margin-left:auto">${posLabel}</span>
            <span style="font-size:8px;color:#6c5fff;font-family:'Consolas',monospace;
              background:rgba(108,95,255,0.1);border:1px solid rgba(108,95,255,0.25);
              padding:1px 7px;border-radius:20px;cursor:pointer;flex-shrink:0"
              title="Click card to find this text on the page">
              📍 on page
            </span>
          </div>

          <!-- Plain-English summary — always visible, no click needed -->
          <div style="font-size:12px;font-weight:600;color:#f0f1ff;line-height:1.6;margin-bottom:9px">
            ${escH(whatItSays)}
          </div>

          <!-- Risk bar -->
          <div style="display:flex;align-items:center;gap:7px">
            <div style="flex:1;height:3px;background:rgba(255,255,255,0.07);border-radius:2px;overflow:hidden">
              <div style="width:${rs}%;height:100%;background:${hex};border-radius:2px;transition:width 0.7s ease"></div>
            </div>
            <span style="font-size:9.5px;font-family:'Consolas',monospace;font-weight:700;color:${hex};flex-shrink:0">${rs}/100</span>
          </div>

        </div>
      </div>

      <!-- TAP BAR — full width, obvious ──────────────── -->
      <div id="ttoggle-${idx}" style="display:flex;align-items:center;justify-content:space-between;
        padding:8px 13px;cursor:pointer;user-select:none;
        background:${color==="red"?"rgba(255,59,92,0.07)":color==="amber"?"rgba(255,179,71,0.07)":color==="blue"?"rgba(0,180,255,0.06)":"rgba(0,219,160,0.06)"};
        border-top:1px solid ${hex}33;transition:background 0.2s">
        <span style="font-size:10px;color:${hex};font-family:'Consolas',monospace;font-weight:700;letter-spacing:0.04em">
          🔍 Why it matters · Your rights · What to do
        </span>
        <span id="tarrow-${idx}" style="font-size:12px;color:${hex};transition:transform 0.22s;display:inline-block">▼</span>
      </div>

      <!-- EXPANDABLE DETAILS ──────────────────────────── -->
      <div id="trix-${idx}" style="display:none;padding:13px;border-top:1px solid ${hex}22">

        <div style="margin-bottom:11px">
          <div style="font-size:8.5px;color:#ff8099;font-family:'Consolas',monospace;text-transform:uppercase;letter-spacing:0.1em;margin-bottom:5px">⚡ Why this matters</div>
          <div style="font-size:11.5px;color:#c8c9e8;line-height:1.72;padding:10px 12px;background:rgba(255,59,92,0.05);border:1px solid rgba(255,59,92,0.14);border-radius:8px">
            ${escH(sum.why_it_matters || "")}
          </div>
        </div>

        <div style="margin-bottom:11px">
          <div style="font-size:8.5px;color:#00dba0;font-family:'Consolas',monospace;text-transform:uppercase;letter-spacing:0.1em;margin-bottom:5px">⚖️ Your legal rights</div>
          <div style="font-size:11.5px;color:#c8c9e8;line-height:1.72;padding:10px 12px;background:rgba(0,219,160,0.05);border:1px solid rgba(0,219,160,0.14);border-radius:8px">
            ${escH(sum.your_rights || "")}
          </div>
        </div>

        <div style="margin-bottom:11px">
          <div style="font-size:8.5px;color:#ffb347;font-family:'Consolas',monospace;text-transform:uppercase;letter-spacing:0.1em;margin-bottom:5px">🛠 What to do</div>
          <div style="font-size:11.5px;color:#c8c9e8;line-height:1.72;padding:10px 12px;background:rgba(255,179,71,0.05);border:1px solid rgba(255,179,71,0.14);border-radius:8px">
            ${escH(sum.action || "")}
          </div>
        </div>

        <div style="margin-bottom:${refs.length?"11":"0"}px">
          <div style="font-size:8.5px;color:#44466a;font-family:'Consolas',monospace;text-transform:uppercase;letter-spacing:0.1em;margin-bottom:5px">📄 Original clause text</div>
          <div style="font-size:10px;color:#44466a;padding:9px 11px;background:#020305;border:1px solid #0f1020;border-radius:8px;font-family:'Consolas',monospace;font-style:italic;line-height:1.7;word-break:break-word">
            "${escH((clause.text||"").substring(0,320))}${(clause.text||"").length>320?"…":""}"
          </div>
        </div>

        ${refs.length ? `
          <div style="font-size:8.5px;color:#a594ff;font-family:'Consolas',monospace;text-transform:uppercase;letter-spacing:0.1em;margin-bottom:7px;margin-top:11px">📚 Applicable Laws</div>
          ${refHtml}
          <div style="font-size:9px;font-family:'Consolas',monospace;color:#44466a;margin-top:6px">
            Verdict: <b style="color:${verdictCol}">${escH(sum.verdict_label || clause.legal?.overall_verdict || "")}</b>
          </div>` : ""}

      </div>
    `;

    clauseList.appendChild(card);

    // Toggle expand/collapse
    document.getElementById(`ttoggle-${idx}`).addEventListener("click", e => {
      e.stopPropagation();
      const body  = document.getElementById(`trix-${idx}`);
      const arrow = document.getElementById(`tarrow-${idx}`);
      const open  = body.style.display !== "none";
      body.style.display    = open ? "none" : "block";
      arrow.style.transform = open ? "rotate(0deg)" : "rotate(180deg)";
    });

    // CLICK card header → jump to the highlighted span on the page
    card.querySelector(`[style*="padding:12px 13px"]`).addEventListener("click", (e) => {
      // Don't trigger if they clicked the toggle bar
      if (e.target.closest(`#ttoggle-${idx}`)) return;

      const hl = document.getElementById(`tri-hl-${idx}`);
      if (!hl) return;  // no highlight found for this clause — skip

      // Scroll the page to the highlight
      hl.scrollIntoView({ behavior: "smooth", block: "center" });

      // Flash the highlight on the page 3 times
      const origBg = hl.style.background;
      let f = 0;
      const flashHL = setInterval(() => {
        hl.style.background = f % 2 === 0 ? "rgba(255,255,0,0.35)" : origBg || "";
        f++;
        if (f >= 6) { clearInterval(flashHL); hl.style.background = origBg || ""; }
      }, 180);
    });
  }


  function updateSidebarScanningMsg(label, sub) {
    const existing = document.getElementById("tri-scan-msg");
    if (existing) { existing.querySelector(".scan-label").textContent = label; existing.querySelector(".scan-sub").textContent = sub; return; }
    document.getElementById("tri-clauses").innerHTML = `
      <div id="tri-scan-msg" style="text-align:center;padding:30px 16px;color:#5a5c7a;font-size:12px">
        <div style="font-size:28px;margin-bottom:12px;animation:spin 1s linear infinite;display:inline-block">⚙️</div>
        <div class="scan-label" style="color:#9899ba;margin-bottom:4px">${label}</div>
        <div class="scan-sub" style="font-size:10px;font-family:'DM Mono',monospace">${sub}</div>
      </div>`;
  }

  // ── Sidebar states ─────────────────────────────────────────────────────────
  function updateSidebarScanning() {
    document.getElementById("tri-clauses").innerHTML = `
      <div style="text-align:center;padding:40px 16px;color:#44466a;font-size:12px">
        <div style="font-size:36px;margin-bottom:12px;animation:spin 1s linear infinite;display:inline-block">⚙️</div>
        <div style="color:#8f90b0;margin-bottom:4px">Analyzing T&C clauses…</div>
        <div style="font-size:10px;font-family:'Consolas',monospace;color:#44466a">Cross-referencing RBI · DPDP · CPA 2019</div>
      </div>`;
    document.getElementById("tri-stats").style.display = "none";
    const mv = document.getElementById("tri-meter-val");
    if (mv) { mv.textContent = "Analyzing…"; mv.className = "tri-score-num"; }
    document.getElementById("tri-fill").style.width = "0%";
  }

  function updateSidebarStats(data) {
    const { clauses, overall_risk, total, risky_count, safe_count, hidden_risks, doc_length } = data;
    const kb       = Math.round((doc_length || 0) / 1024);
    const score    = data.risk_score || Math.round((risky_count / Math.max(total, 1)) * 100);

    // ── Score bar ──────────────────────────────────────────────────────────
    const numEl = document.getElementById("tri-meter-val");
    numEl.textContent = `${score}/100 — ${overall_risk}`;
    numEl.className   = `tri-score-num ${overall_risk}`;
    setTimeout(() => { document.getElementById("tri-fill").style.width = score + "%"; }, 80);

    // ── Stats row ──────────────────────────────────────────────────────────
    document.getElementById("ts-total").textContent = total;
    document.getElementById("ts-risky").textContent = risky_count;
    document.getElementById("ts-safe").textContent  = safe_count;
    const statsEl = document.getElementById("tri-stats");
    statsEl.style.display = "flex";

    // Doc size + hidden risks line
    const old = document.getElementById("tri-doc-info");
    if (old) old.remove();
    if (kb > 0 || hidden_risks > 0) {
      const info = document.createElement("div");
      info.id = "tri-doc-info";
      info.style.cssText = "font-size:10px;color:#44466a;font-family:'Consolas',monospace;margin-top:7px;display:flex;gap:12px;align-items:center";
      info.innerHTML = `
        ${kb > 0 ? `<span>📄 ${kb}KB scanned</span>` : ""}
        ${hidden_risks > 0 ? `<span style="color:#ff3b5c;font-weight:700">⚠️ ${hidden_risks} hidden risk${hidden_risks>1?"s":""}</span>` : ""}
      `;
      statsEl.after(info);
    }

    // Summary section removed — shows directly in clause cards

    // ── Clause legend + cards ──────────────────────────────────────────────
    const clauseList = document.getElementById("tri-clauses");
    clauseList.innerHTML = `
      <div style="padding:12px 4px 10px;border-top:1px solid #0f1020;margin-top:2px">
        <div style="font-size:11px;font-weight:700;color:#f0f1ff;margin-bottom:5px">
          ${total} Clauses Analysed
        </div>
        <div style="display:flex;gap:10px;font-size:10px;color:#8f90b0;flex-wrap:wrap;margin-bottom:2px">
          <span style="color:#ff3b5c">🔴 Dangerous</span>
          <span style="color:#ffb347">🟡 Watch out</span>
          <span style="color:#00dba0">🟢 Safe for you</span>
        </div>
        <div style="font-size:9.5px;color:#44466a;font-family:'Consolas',monospace;margin-top:4px">
          Tap any card to read the full summary →
        </div>
      </div>
    `;

    // Sort: hidden risks + high score first, then safe at bottom
    const sorted = [...clauses].sort((a,b) => {
      if (a.is_hidden_risk && !b.is_hidden_risk) return -1;
      if (!a.is_hidden_risk && b.is_hidden_risk) return 1;
      return (b.risk_score||0) - (a.risk_score||0);
    });
    sorted.forEach((clause, i) => renderLiveCard(clause, i));
  }

  function updateSidebarEmpty() {
    document.getElementById("tri-clauses").innerHTML = `
      <div style="text-align:center;padding:40px 16px;color:#5a5c7a;font-size:12px">
        <div style="font-size:32px;margin-bottom:10px">📄</div>
        No T&C text detected on this page.<br>Navigate to a Terms or Privacy Policy page.
      </div>`;
  }

  function updateSidebarError(msg) {
    // Detect if it's a cold-start / connection error and show helpful guidance
    const isColdStart = msg.toLowerCase().includes("start") ||
                        msg.toLowerCase().includes("wait") ||
                        msg.toLowerCase().includes("timeout") ||
                        msg.toLowerCase().includes("unreachable") ||
                        msg.toLowerCase().includes("fetch");

    const helpText = isColdStart
      ? "Railway server is waking up. Click Re-Analyze in 30 seconds."
      : "Check your Railway URL in content.js and make sure the backend is deployed.";

    document.getElementById("tri-clauses").innerHTML = `
      <div style="text-align:center;padding:30px 16px">
        <div style="font-size:32px;margin-bottom:10px">⚠️</div>
        <div style="color:#ff4d6d;font-size:13px;font-weight:700;margin-bottom:10px">
          ${escH(msg.substring(0, 120))}
        </div>
        <div style="color:#5a5c7a;font-size:11px;line-height:1.7;margin-bottom:14px;
          background:rgba(255,255,255,0.03);border:1px solid #1c1e38;border-radius:9px;padding:10px">
          ${escH(helpText)}
        </div>
        <div style="font-size:10px;color:#44466a;font-family:'Consolas',monospace">
          Railway URL: ${API_BASE.substring(0,50)}
        </div>
      </div>`;
  }

  // ── Sidebar results ────────────────────────────────────────────────────────
  function updateSidebarResults(data) {
    const { clauses, overall_risk, total, risky_count, safe_count } = data;
    const riskPct = Math.round((risky_count / total) * 100);

    // Meter
    document.getElementById("tri-meter-val").textContent = `${riskPct}% — ${overall_risk}`;
    document.getElementById("tri-meter-val").className = `tri-meter-val ${overall_risk}`;
    setTimeout(() => { document.getElementById("tri-fill").style.width = riskPct + "%"; }, 100);

    // Stats
    document.getElementById("ts-total").textContent = total;
    document.getElementById("ts-risky").textContent = risky_count;
    document.getElementById("ts-safe").textContent  = safe_count;
    document.getElementById("tri-stats").style.display = "flex";

    // Summary
    const sumPoints = buildSummary(clauses, overall_risk);
    document.getElementById("tri-sum-items").innerHTML = sumPoints.map(p =>
      `<div class="tri-sum-item"><span class="tri-sum-icon">${p.icon}</span><span>${p.text}</span></div>`
    ).join("");

    // Clause cards
    const clauseList = document.getElementById("tri-clauses");
    clauseList.innerHTML = `<div class="tri-sec-label" style="padding:4px 4px 8px">Clause Breakdown + Real-World Impact</div>`;

    clauses.forEach((clause, i) => {
      const label = clause.labels[0] || "neutral";
      const color = getColor(label);
      const icon  = getIcon(label);
      const rw    = REAL_WORLD[label] || REAL_WORLD["neutral"];

      const refs = (clause.legal?.references || []).slice(0, 2);
      const regPills = refs.map(r =>
        `<span class="tri-reg-pill">${r.authority.split(" ").slice(0,3).join(" ")}</span>`
      ).join("");

      const card = document.createElement("div");
      card.className = `tri-card ${color}`;
      card.style.animationDelay = (i * 0.06) + "s";
      card.innerHTML = `
        <div class="tri-card-top">
          <div class="tri-icon ${color}">${icon}</div>
          <div class="tri-card-body">
            <div class="tri-label ${color}">${label.toUpperCase()}</div>
            <div class="tri-plain" id="tp${i}">${escH(clause.plain_english || clause.text)}</div>
          </div>
        </div>
        <div class="tri-impact" id="ti${i}">
          <div class="tri-impact-label">🌍 Real-World Problem</div>
          <div class="tri-impact-problem">${rw.problem}</div>
          <div class="tri-impact-label" style="margin-top:8px">✅ Your Solution & Rights</div>
          <div class="tri-impact-solution">${rw.solution}</div>
          ${regPills ? `<div style="margin-top:6px">${regPills}</div>` : ""}
          <div class="tri-score">Risk Score: <b>${clause.risk_score||0}/100</b> · Confidence: <b>${Math.round((clause.scores[0]||0)*100)}%</b></div>
        </div>
      `;
      card.addEventListener("click", () => {
        document.getElementById(`tp${i}`).classList.toggle("expanded");
        document.getElementById(`ti${i}`).classList.toggle("open");
      });
      clauseList.appendChild(card);
    });
  }

  // ── Highlight risky text on page ───────────────────────────────────────────
  function highlightPage(data) {
    // Two-way linking: page highlight ↔ sidebar card
    // ALL clause types highlighted: red/amber/green/blue(neutral)
    // Smarter matching: tries multiple snippet lengths for better coverage

    data.clauses.forEach((clause, idx) => {
      const label = clause.labels[0] || "neutral";
      const color = getColor(label);  // red / amber / green / blue

      // Try multiple snippet lengths — shorter = easier to find on page
      const snippets = [
        clause.text.substring(0, 40).trim(),
        clause.text.substring(0, 25).trim(),
        clause.text.substring(5, 35).trim(),   // skip first few chars in case of bullet/number
      ].filter(s => s.length >= 15);

      try {
        const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
        let node;
        let matched = false;

        while ((node = walker.nextNode()) && !matched) {
          if (node.parentElement?.closest("#trinetra-root")) continue;
          if (node.parentElement?.tagName === "SCRIPT") continue;
          if (node.parentElement?.tagName === "STYLE") continue;

          const nodeText = node.textContent;
          const found    = snippets.some(s => nodeText.includes(s));

          if (found) {
            const span = document.createElement("mark");
            span.className         = `tri-hl ${color}`;
            span.id                = `tri-hl-${idx}`;
            span.dataset.clauseIdx = String(idx);
            span.title             = `Trinetra: ${label.toUpperCase()} — click to see full analysis`;
            span.textContent       = nodeText;

            // CLICK highlight on page → jump to clause card in sidebar
            span.addEventListener("click", (e) => {
              e.stopPropagation();
              setSidebar(true);

              setTimeout(() => {
                const card = document.getElementById(`tricard-${idx}`);
                if (!card) return;

                // Scroll sidebar to this card
                card.scrollIntoView({ behavior: "smooth", block: "center" });

                // Flash card border 3 times
                const flashCol = color === "red"   ? "#ff3b5c"
                               : color === "amber" ? "#ffb347"
                               : color === "blue"  ? "#00b4ff"
                               : "#00dba0";
                let f = 0;
                const flashCard = setInterval(() => {
                  card.style.outline = f % 2 === 0 ? `2px solid ${flashCol}` : "none";
                  if (++f >= 6) { clearInterval(flashCard); card.style.outline = ""; }
                }, 200);

                // Auto-expand card details
                const body  = document.getElementById(`trix-${idx}`);
                const arrow = document.getElementById(`tarrow-${idx}`);
                if (body && body.style.display === "none") {
                  body.style.display = "block";
                  if (arrow) arrow.style.transform = "rotate(180deg)";
                }
              }, 350);
            });

            node.parentNode.replaceChild(span, node);
            matched = true;
          }
        }
      } catch(e) { console.warn("Trinetra highlight error:", e); }
    });
  }

  // ── Toast notifications ────────────────────────────────────────────────────
  function showToastsSequential(data) {
    const risky = data.clauses
      .filter(c => c.is_risky)
      .sort((a, b) => (b.risk_score||0) - (a.risk_score||0))
      .slice(0, 3);

    risky.forEach((clause, i) => {
      setTimeout(() => showToast(clause), i * 2500);
    });
  }

  function showToast(clause) {
    const label    = clause.labels[0] || "neutral";
    const icon     = getIcon(label);
    const riskLvl  = clause.risk_score >= 70 ? "HIGH" : clause.risk_score >= 40 ? "MEDIUM" : "LOW";
    const rw       = REAL_WORLD[label] || REAL_WORLD["neutral"];
    const duration = 7000;

    // Stack toasts
    const existing = document.querySelectorAll(".tri-toast").length;
    const toast = document.createElement("div");
    toast.className = "tri-toast";
    toast.style.bottom = (90 + existing * 8) + "px";
    toast.innerHTML = `
      <div class="tri-toast-hdr">
        <div class="tri-toast-icon ${riskLvl}">${icon}</div>
        <div class="tri-toast-title">⚠️ ${label.charAt(0).toUpperCase()+label.slice(1)} Detected</div>
        <button class="tri-toast-x">✕</button>
      </div>
      <div class="tri-toast-body">${escH(clause.plain_english || "")}</div>
      <div class="tri-toast-problem">${rw.problem.substring(0, 120)}…</div>
      <div class="tri-toast-solution">${rw.solution.substring(0, 100)}…</div>
      <div class="tri-toast-footer">
        <span class="tri-toast-reg">${rw.reg}</span>
        <button class="tri-toast-cta">Review →</button>
      </div>
      <div class="tri-toast-bar" style="animation-duration:${duration}ms"></div>
    `;
    root.appendChild(toast);

    const dismiss = () => { toast.classList.add("out"); setTimeout(() => toast.remove(), 300); };
    toast.querySelector(".tri-toast-x").addEventListener("click", e => { e.stopPropagation(); dismiss(); });
    toast.querySelector(".tri-toast-cta").addEventListener("click", () => { setSidebar(true); dismiss(); });
    toast.addEventListener("click", () => { setSidebar(true); dismiss(); });
    setTimeout(dismiss, duration);
  }

  // ── Warning Modal ──────────────────────────────────────────────────────────
  function showWarningModal() {
    if (!analysisData) return;
    const riskyLabels = analysisData.clauses
      .filter(c => c.is_risky)
      .slice(0, 3)
      .map(c => `• ${c.plain_english || c.labels[0]}`)
      .join("<br>");
    document.getElementById("tri-modal-risk-list").innerHTML = riskyLabels;
    modal.classList.add("show");
  }

  // ── Blockchain Hash & Ledger ──────────────────────────────────────────────
  // ── Hash & Store — saves evidence files directly to user's own PC ────────────
  // No database. No cloud. Files saved to Downloads/Trinetra_Evidence/domain/
  // Each file is a complete tamper-proof SHA-256 signed JSON block.

  // ── Hash & Store — 100% local, nothing sent to cloud ─────────────────────
  // SHA-256 computed in browser using Web Crypto API
  // Evidence saved directly to user's PC via Chrome Downloads API
  // Railway is NOT involved — zero data leaves the device

  async function doHash() {
    if (!analysisData) {
      showToastSimple("⚠️ Analyze a T&C page first before storing evidence.");
      return;
    }

    const btn = document.getElementById("tri-btn-hash");
    if (btn) { btn.disabled = true; btn.textContent = "⏳ Creating evidence…"; }

    try {
      // ── Step 1: Compute SHA-256 entirely in the browser ───────────────────
      // Web Crypto API — built into Chrome, no external call needed
      const encoder     = new TextEncoder();
      const rawBytes    = encoder.encode(rawPageText || "");
      const hashBuffer  = await crypto.subtle.digest("SHA-256", rawBytes);
      const hashArray   = Array.from(new Uint8Array(hashBuffer));
      const rawTextHash = hashArray.map(b => b.toString(16).padStart(2,"0")).join("");

      // Block payload — same structure as before, computed locally
      const domain    = location.hostname.replace(/^www\./,"");
      const now       = new Date();
      const dateStr   = now.toISOString().slice(0,10);
      const timeTag   = now.toTimeString().slice(0,8).replace(/:/g,"-");
      const blockId   = generateBlockId();

      const payload = {
        block_id:      blockId,
        url:           location.href,
        domain:        domain,
        timestamp:     Math.floor(now.getTime()/1000),
        overall_risk:  analysisData.overall_risk  || "",
        risk_score:    analysisData.risk_score     || 0,
        clauses_count: analysisData.total          || 0,
        hidden_risks:  analysisData.hidden_risks   || 0,
        doc_length:    analysisData.doc_length     || 0,
        raw_text_hash: rawTextHash,
        clause_hashes: (analysisData.clauses||[]).map(cl =>
          cl.text ? cl.text.substring(0,16).split("").reduce((h,c)=>
            ((h<<5)-h+c.charCodeAt(0))|0, 0).toString(16).padStart(8,"0") : "00000000"
        ),
      };

      // SHA-256 of the entire payload = block hash
      const payloadBytes  = encoder.encode(JSON.stringify(payload, Object.keys(payload).sort()));
      const blockBuffer   = await crypto.subtle.digest("SHA-256", payloadBytes);
      const blockArray    = Array.from(new Uint8Array(blockBuffer));
      const sha256Hash    = blockArray.map(b => b.toString(16).padStart(2,"0")).join("");

      // ── Step 2: Build full evidence block ────────────────────────────────
      const evidenceBlock = {
        // Identity
        block_id:       blockId,
        domain:         domain,
        url:            location.href,
        page_title:     document.title,
        date_stored:    dateStr,
        time_stored:    now.toTimeString().slice(0,8),
        stored_at_iso:  now.toISOString(),

        // Blockchain
        sha256_hash:    sha256Hash,
        raw_text_hash:  rawTextHash,
        prev_hash:      "computed-locally",
        algorithm:      "SHA-256 (Web Crypto API — browser native)",
        privacy_note:   "This evidence was computed and stored entirely on your device. No data was sent to any server.",

        // Risk
        overall_risk:   analysisData.overall_risk,
        risk_score:     analysisData.risk_score,
        total_clauses:  analysisData.total,
        risky_clauses:  analysisData.risky_count,
        safe_clauses:   analysisData.safe_count,
        hidden_risks:   analysisData.hidden_risks,
        doc_length_kb:  Math.round((analysisData.doc_length||0)/1024),

        // Full raw T&C text — the actual legal evidence
        raw_tc_text:    rawPageText || "",
        raw_tc_chars:   (rawPageText||"").length,

        // Complete clause analysis
        clauses: (analysisData.clauses||[]).map(cl => ({
          text:           cl.text,
          label:          cl.labels?.[0] || "neutral",
          risk_score:     cl.risk_score,
          is_risky:       cl.is_risky,
          is_hidden:      cl.is_hidden_risk,
          position_pct:   cl.position_pct,
          plain_english:  cl.plain_english,
          what_it_says:   cl.summary?.what_it_says   || "",
          why_it_matters: cl.summary?.why_it_matters  || "",
          your_rights:    cl.summary?.your_rights     || "",
          action:         cl.summary?.action          || "",
          verdict:        cl.legal?.overall_verdict   || "LEGAL",
        })),

        // Legal notice
        legal_notice: [
          "PRIVACY: This evidence file was generated entirely on your device.",
          "No T&C text, clause data, or personal information was sent to any cloud server.",
          "The SHA-256 hashes were computed using your browser's built-in Web Crypto API.",
          "This file proves what " + domain + " Terms said on " + dateStr + ".",
          "Admissible as evidence at consumerhelpline.gov.in and edaakhil.nic.in.",
        ].join(" "),
      };

      // ── Step 3: Save to PC ────────────────────────────────────────────────
      const fileName = `Trinetra_Evidence/${domain}/${dateStr}_${timeTag}_${blockId}.json`;
      const jsonStr  = JSON.stringify(evidenceBlock, null, 2);
      await saveFileToPC(fileName, jsonStr);

      // ── Step 4: Save index entry ──────────────────────────────────────────
      const indexEntry = {
        block_id:      blockId,
        domain:        domain,
        url:           location.href,
        date:          dateStr,
        overall_risk:  analysisData.overall_risk,
        risk_score:    analysisData.risk_score,
        total_clauses: analysisData.total,
        risky_clauses: analysisData.risky_count,
        safe_clauses:  analysisData.safe_count,
        sha256_hash:   sha256Hash,
        raw_text_hash: rawTextHash,
        evidence_file: fileName,
        stored_at:     now.toISOString(),
        privacy_note:  "Computed locally — no cloud involved",
      };
      await saveFileToPC(
        `Trinetra_Evidence/_index_${domain}.json`,
        JSON.stringify(indexEntry, null, 2)
      );

      // ── Step 5: Update sidebar ────────────────────────────────────────────
      renderCompactChainRecord({
        block_id:      blockId,
        sha256_hash:   sha256Hash,
        raw_text_hash: rawTextHash,
        overall_risk:  analysisData.overall_risk,
        raw_text_kb:   Math.round((rawPageText||"").length/1024),
      }, fileName);

      if (btn) {
        btn.textContent = "✅ Saved to PC";
        btn.style.color  = "#00dba0";
        btn.style.border = "1px solid rgba(0,219,160,0.4)";
      }

      showToastSimple(`✅ Saved locally! Downloads/Trinetra_Evidence/${domain}/${dateStr}_${blockId}.json`);
      console.log("✅ Trinetra evidence — 100% local, block:", blockId, "hash:", sha256Hash.substring(0,16)+"…");

    } catch(err) {
      console.error("Hash error:", err);
      showToastSimple("❌ Save failed: " + err.message);
      if (btn) {
        btn.disabled    = false;
        btn.textContent = "🔗 Hash & Store";
        btn.style.color = "";
        btn.style.border = "";
      }
    }
  }

  // ── Generate a random 8-char hex block ID (like 42A985DA) ─────────────────
  function generateBlockId() {
    return Array.from(crypto.getRandomValues(new Uint8Array(4)))
      .map(b => b.toString(16).padStart(2,"0").toUpperCase())
      .join("");
  }


  async function saveIndexFile(domain, dateStr, blockId, hashData, evidenceFile) {
    const indexEntry = {
      block_id:      blockId,
      domain:        domain,
      url:           location.href,
      date:          dateStr,
      overall_risk:  analysisData.overall_risk,
      risk_score:    analysisData.risk_score,
      total_clauses: analysisData.total,
      risky_clauses: analysisData.risky_count,
      safe_clauses:  analysisData.safe_count,
      sha256_hash:   hashData.sha256_hash,
      raw_text_hash: hashData.raw_text_hash,
      evidence_file: evidenceFile,
      stored_at:     new Date().toISOString(),
    };
    const indexJson = JSON.stringify(indexEntry, null, 2);
    // Index file named by domain so all entries for same domain stay together
    await saveFileToPC(`Trinetra_Evidence/_index_${domain}.json`, indexJson);
  }

  // ── Render the compact chain record in the sidebar ─────────────────────────
  function renderCompactChainRecord(block, fileName, fullBlock) {
    const old = document.getElementById("tri-chain-record");
    if (old) old.remove();

    const list  = document.getElementById("tri-clauses");
    const panel = document.createElement("div");
    panel.id    = "tri-chain-record";
    panel.className = "tri-chain-panel";

    const rc  = block.overall_risk || analysisData?.overall_risk || "";
    const rcol = rc==="HIGH" ? "#ff3b5c" : rc==="MEDIUM" ? "#ffb347" : "#00dba0";
    const isGen = (block.prev_hash||"") === "0".repeat(64) || !(block.prev_hash);
    const rawKb = block.raw_text_kb || Math.round((rawPageText||"").length/1024) || 0;
    const domain = location.hostname.replace(/^www\./,"");
    const dateStr = new Date().toISOString().slice(0,10);
    const fName = fileName || `Trinetra_Evidence/${domain}/${dateStr}_${block.block_id}.json`;

    panel.innerHTML = `
      <div class="tri-chain-title">✅ Evidence Saved to Your PC</div>

      <div style="font-size:12px;color:#00dba0;background:rgba(0,219,160,0.07);
        border:1px solid rgba(0,219,160,0.2);border-radius:9px;padding:10px 12px;margin-bottom:11px;
        line-height:1.6;font-family:'Consolas',monospace;word-break:break-all">
        📁 Downloads/${fName}
      </div>

      <div style="font-size:11.5px;color:#8f90b5;line-height:1.7;padding:10px 12px;
        background:rgba(0,0,0,0.2);border:1px solid #1a1d35;border-radius:9px;margin-bottom:11px">
        This file contains the <strong style="color:#f0f1ff">full verbatim T&C text</strong>
        as it existed today, plus the complete AI analysis of every clause.
        The <strong style="color:#a48bff">SHA-256 hash</strong> proves the content was
        unchanged. If this company edits their terms later,
        <strong style="color:#00dba0">your file is legal evidence</strong> of what they originally said.
      </div>

      <div style="display:grid;grid-template-columns:1fr 1fr;gap:7px;margin-bottom:11px">
        <div style="background:rgba(255,255,255,0.02);border:1px solid #1a1d35;border-radius:8px;padding:9px 11px">
          <div style="font-family:'Consolas',monospace;font-size:8px;color:#44466a;text-transform:uppercase;letter-spacing:.08em">Block ID</div>
          <div style="font-family:'Consolas',monospace;font-size:11px;color:#a48bff;margin-top:3px;font-weight:700">#${block.block_id}</div>
        </div>
        <div style="background:rgba(255,255,255,0.02);border:1px solid #1a1d35;border-radius:8px;padding:9px 11px">
          <div style="font-family:'Consolas',monospace;font-size:8px;color:#44466a;text-transform:uppercase;letter-spacing:.08em">Risk Level</div>
          <div style="font-family:'Consolas',monospace;font-size:11px;color:${rcol};margin-top:3px;font-weight:700">${rc}</div>
        </div>
        <div style="background:rgba(255,255,255,0.02);border:1px solid #1a1d35;border-radius:8px;padding:9px 11px">
          <div style="font-family:'Consolas',monospace;font-size:8px;color:#44466a;text-transform:uppercase;letter-spacing:.08em">Raw Text Saved</div>
          <div style="font-family:'Consolas',monospace;font-size:11px;color:#00dba0;margin-top:3px;font-weight:700">${rawKb}KB evidence</div>
        </div>
        <div style="background:rgba(255,255,255,0.02);border:1px solid #1a1d35;border-radius:8px;padding:9px 11px">
          <div style="font-family:'Consolas',monospace;font-size:8px;color:#44466a;text-transform:uppercase;letter-spacing:.08em">Saved</div>
          <div style="font-family:'Consolas',monospace;font-size:11px;color:#f0f1ff;margin-top:3px;font-weight:700">${dateStr}</div>
        </div>
      </div>

      <div style="font-size:9px;font-family:'Consolas',monospace;color:#44466a;
        padding:9px 11px;background:rgba(0,0,0,0.25);border:1px solid #1a1d35;
        border-radius:8px;word-break:break-all;line-height:1.9;margin-bottom:11px">
        <span style="color:#00d4ff;display:block;font-size:8px;margin-bottom:3px;text-transform:uppercase;letter-spacing:.1em">SHA-256 Hash</span>
        ${block.sha256_hash || ""}
      </div>

      <div style="font-size:10.5px;color:#44466a;line-height:1.65">
        📂 Open <strong style="color:#f0f1ff">File Explorer</strong> →
        <strong style="color:#a48bff">Downloads</strong> →
        <strong style="color:#a48bff">Trinetra_Evidence</strong> →
        <strong style="color:#a48bff">${domain}</strong>
        to find your evidence file.
      </div>
    `;

    list.insertBefore(panel, list.firstChild);
  }



  function showLedgerPanel() {
    const clauseArea = document.getElementById("tri-clauses");
    clauseArea.innerHTML =
      '<div style="padding:14px 4px 10px;border-bottom:1px solid #181a30;margin-bottom:12px">' +
        '<div style="font-size:14px;font-weight:700;color:#f0f1ff;margin-bottom:4px">📒 Blockchain Ledger — All Stored Records</div>' +
        '<div style="font-size:10.5px;color:#9496b0;line-height:1.6">Every T&C document you hashed is stored here. If a company changes their terms, this record proves what it originally said.</div>' +
      '</div>' +
      '<div id="full-ledger-list"><div style="font-size:11px;color:#44466a;padding:10px 0">Loading records…</div></div>';

    fetch(API_BASE + "/ledger").then(function(r){ return r.json(); }).then(function(data) {
      var entries = (Array.isArray(data) ? data : (data.entries || [])).slice().reverse();
      var el = document.getElementById("full-ledger-list");
      if (!el) return;

      if (!entries.length) {
        el.innerHTML =
          '<div style="padding:20px;text-align:center;color:#44466a">' +
          '<div style="font-size:32px;margin-bottom:10px">📭</div>' +
          '<div style="font-size:12px">No records yet.<br>Analyze a T&C page then click <b style="color:#a594ff">🔗 Hash & Store</b>.</div>' +
          '</div>';
        return;
      }

      el.innerHTML = entries.map(function(e) {
        var domain  = (e.url||"").replace(/^https?:\/\//,"").split("/")[0];
        var risk    = e.overall_risk || "—";
        var rc      = risk==="HIGH"?"#ff3b5c":risk==="MEDIUM"?"#ffb347":"#00e5a0";
        var bg      = risk==="HIGH"?"rgba(255,59,92,0.06)":risk==="MEDIUM"?"rgba(255,179,71,0.06)":"rgba(0,229,160,0.06)";
        var n       = e.clauses_count || e.clauses_analyzed || 0;
        var kb      = e.raw_text_kb || 0;
        var ts      = new Date((e.timestamp||0)*1000).toLocaleString("en-IN",{dateStyle:"medium",timeStyle:"short"});
        var hashShort = (e.sha256_hash||"").substring(0,20) + "…";
        var rawInfo = kb > 0
          ? '<div style="font-size:10px;color:#00e5a0;background:rgba(0,229,160,0.07);border:1px solid rgba(0,229,160,0.2);border-radius:7px;padding:6px 10px">✅ Full T&C page text stored — tamper-proof legal evidence ('+kb+'KB)</div>'
          : '<div style="font-size:10px;color:#ffb347;background:rgba(255,179,71,0.07);border:1px solid rgba(255,179,71,0.2);border-radius:7px;padding:6px 10px">⚠️ No raw text stored — re-analyze and hash again to store full page evidence</div>';

        return '<div style="background:'+bg+';border:1px solid '+rc+'33;border-left:3px solid '+rc+';border-radius:10px;padding:12px 13px;margin-bottom:8px">' +
          '<div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:6px">' +
            '<span style="font-family:Consolas,monospace;font-size:10px;color:#a594ff;font-weight:700">#'+e.block_id+'</span>' +
            '<span style="font-size:9px;font-weight:700;padding:2px 8px;border-radius:20px;border:1px solid '+rc+'44;background:'+rc+'11;color:'+rc+'">'+risk+'</span>' +
          '</div>' +
          '<div style="font-size:12px;font-weight:600;color:#f0f1ff;margin-bottom:4px">'+domain+'</div>' +
          '<div style="font-family:Consolas,monospace;font-size:8.5px;color:#44466a;word-break:break-all;margin-bottom:6px">SHA-256: '+hashShort+'</div>' +
          '<div style="display:flex;gap:12px;flex-wrap:wrap;font-size:10px;color:#9496b0;margin-bottom:7px">' +
            '<span>📋 '+n+' clauses</span>' +
            '<span>🕐 '+ts+'</span>' +
          '</div>' +
          rawInfo +
        '</div>';
      }).join("");
    }).catch(function(e) {
      var el = document.getElementById("full-ledger-list");
      if(el) el.innerHTML = '<div style="color:#ff3b5c;font-size:11px;padding:10px">Could not load: ' + e.message + '</div>';
    });
  }

  async function loadAndRenderLedger() {
    try {
      const res     = await fetch(`${API_BASE}/ledger`);
      const data    = await res.json();
      const entries = (data.entries || []).slice().reverse(); // newest first
      const el      = document.getElementById("tri-ledger-entries");
      if (!el) return;

      if (!entries.length) {
        el.innerHTML = `<div style="font-size:10px;color:#5a5c7a;font-family:'DM Mono',monospace;padding:4px 0">No entries yet.</div>`;
        return;
      }

      el.innerHTML = entries.slice(0, 8).map(e => {
        const t      = new Date(e.timestamp * 1000);
        const hh     = String(t.getHours()).padStart(2,'0');
        const mm     = String(t.getMinutes()).padStart(2,'0');
        const dd     = t.toLocaleDateString();
        const domain = (e.url || "").replace(/^https?:\/\//,'').split('/')[0].substring(0,28);
        const risk   = e.overall_risk || "—";
        return `
          <div class="tri-ledger-entry">
            <span class="le-id">#${e.block_id}</span>
            <span class="le-url" title="${e.url}">${domain}</span>
            <span class="le-risk ${risk}">${risk}</span>
            <span class="le-time">${dd} ${hh}:${mm}</span>
          </div>`;
      }).join("");

      if (entries.length > 8) {
        el.innerHTML += `<div style="font-size:9px;color:#5a5c7a;font-family:'DM Mono',monospace;text-align:center;padding-top:4px">+${entries.length - 8} more in ledger</div>`;
      }
    } catch(e) {
      const el = document.getElementById("tri-ledger-entries");
      if (el) el.innerHTML = `<div style="font-size:10px;color:#5a5c7a;padding:4px 0">Could not load ledger.</div>`;
    }
  }

  function showToastSimple(msg) {
    const t = document.createElement("div");
    t.className = "tri-toast";
    t.style.cssText = "bottom:90px;padding:12px 16px;font-size:12px;color:#e8e9f3;";
    t.textContent = msg;
    root.appendChild(t);
    setTimeout(() => { t.classList.add("out"); setTimeout(() => t.remove(), 300); }, 3000);
  }

  // ── FAB helpers ────────────────────────────────────────────────────────────
  function setFabBadge(count) {
    const b = document.getElementById("tri-fab-badge");
    b.textContent = count;
    b.classList.toggle("show", count > 0);
  }
  function setFabStatus(state) {
    document.getElementById("tri-fab-status").className = "tri-fab-status " + state;
  }

  // ── Summary builder ────────────────────────────────────────────────────────
  function buildSummary(clauses, overallRisk, riskScore) {
    const pts     = [];
    const labels  = clauses.map(c => c.labels?.[0]);
    const risky   = clauses.filter(c => c.is_risky);
    const hidden  = clauses.filter(c => c.is_hidden_risk);
    const score   = riskScore || 0;
    const col     = overallRisk==="HIGH" ? "#ff3b5c" : overallRisk==="MEDIUM" ? "#ffb347" : "#00dba0";
    const ico     = overallRisk==="HIGH" ? "🔴" : overallRisk==="MEDIUM" ? "🟡" : "🟢";

    pts.push({icon: ico, html:
      `<strong style="color:${col}">${score}/100 — ${overallRisk} RISK.</strong> `
      + (overallRisk==="HIGH"
        ? `${risky.length} clauses heavily favour the company over you.`
        : overallRisk==="MEDIUM"
        ? `${risky.length} clause${risky.length!==1?"s":""} need attention before agreeing.`
        : `No major violations found — still read carefully.`)
    });

    if (hidden.length > 0)
      pts.push({icon:"⚠️", html:
        `<strong style="color:#ff3b5c">${hidden.length} clause${hidden.length>1?"s":""} deliberately buried</strong> at the bottom to hide them. These include: ${hidden.slice(0,2).map(c=>c.labels?.[0]).join(", ")}.`
      });

    if (labels.includes("termination clause"))
      pts.push({icon:"⚡", html:`<strong>Account Termination</strong> — They can close your account without notice. File at consumerhelpline.gov.in if unfairly terminated.`});
    if (labels.includes("auto-renewal"))
      pts.push({icon:"💳", html:`<strong>Auto-Renewal</strong> — Your card is charged automatically. RBI requires 24hr pre-debit notice. Dispute via your bank if not received.`});
    if (labels.includes("privacy breach"))
      pts.push({icon:"👁️", html:`<strong>Data Privacy</strong> — Your personal data may be shared with third parties. DPDP Act 2023 §12 gives you the right to request deletion.`});
    if (labels.includes("theft"))
      pts.push({icon:"🚨", html:`<strong>Content Ownership</strong> — They claim a broad license over your content. Copyright Act 1957 §17 keeps you as the original author.`});
    if (labels.includes("arbitration"))
      pts.push({icon:"⚖️", html:`<strong>Arbitration</strong> — They want disputes handled privately. CPA 2019 §100 still lets you file in Indian consumer courts.`});
    if (labels.includes("indemnification"))
      pts.push({icon:"💸", html:`<strong>Indemnification</strong> — You agree to pay their legal costs. Indian Contract Act §23 can void unconscionable clauses.`});

    if (pts.length <= 1)
      pts.push({icon:"📋", html: overallRisk==="HIGH"
        ? "Multiple clauses favour the company. Consider if this service is worth these terms."
        : "No major issues detected. Check auto-renewal and data-sharing sections."
      });

    return pts;
  }


  function getColor(label) {
    const red   = ["termination clause","privacy breach","theft","arbitration","indemnification","risky"];
    const green = ["consumer-friendly","refund clause"];
    const blue  = ["neutral"];
    if (red.includes(label))   return "red";
    if (green.includes(label)) return "green";
    if (blue.includes(label))  return "blue";
    return "amber";  // auto-renewal and anything unrecognised
  }

  function getIcon(label) {
    return {
      "termination clause": "⚡",
      "auto-renewal":       "💳",
      "privacy breach":     "👁️",
      "theft":              "🚨",
      "arbitration":        "⚖️",
      "indemnification":    "💸",
    }[label] || "⚠️";
  }
  function escH(t) { return (t||"").replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;"); }

  // ── Kick off — handles normal pages, SPAs, and lazy-loaded T&C pages ────────
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", autoStart);
  } else {
    // DOM already ready — run after a tick so page scripts finish
    setTimeout(autoStart, 300);
  }

  // Fallback: if page content loads late (SPA route change, lazy render)
  // Watch for the page to settle and retry detection once
  let retried = false;
  const retryObserver = new MutationObserver(() => {
    if (!retried && !isAnalyzing && !analysisData && isTnCPage()) {
      retried = true;
      retryObserver.disconnect();
      setTimeout(autoStart, 500);
    }
  });
  retryObserver.observe(document.body, { childList: true, subtree: false });
  setTimeout(() => retryObserver.disconnect(), 8000); // stop watching after 8s

})();
