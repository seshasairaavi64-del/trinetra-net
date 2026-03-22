"""
app.py — Trinetra.net Cloud Backend v7.0
==========================================
Uses Groq FREE API (LLaMA 3) instead of local BART model.
- No 1.6GB model download
- No GPU needed
- Runs on any free server (Railway, Render, etc.)
- Users get results in ~2 seconds
- Free tier: 14,400 requests/day

Deploy on Railway:
  1. Push this folder to GitHub
  2. Connect Railway to GitHub repo
  3. Add environment variable: GROQ_API_KEY=your_key
  4. Railway auto-deploys — done.
"""

from flask import Flask, request, jsonify
from flask_cors import CORS
from legal_reference_engine import analyze_clause_legally_dict
import hashlib, json, time, os, re, uuid, requests
from datetime import datetime
from pathlib import Path

app = Flask(__name__)

# Allow requests from ANY origin (Chrome extension + website)
CORS(app, origins="*", methods=["GET","POST","OPTIONS"],
     allow_headers=["Content-Type","Authorization"])

# ── Groq API config ────────────────────────────────────────────────────────────
GROQ_API_KEY = os.environ.get("GROQ_API_KEY", "")
GROQ_URL     = "https://api.groq.com/openai/v1/chat/completions"
GROQ_MODEL   = "llama3-8b-8192"   # free, fast, excellent at classification

# ── Storage paths ──────────────────────────────────────────────────────────────
EVIDENCE_DIR = Path("trinetra_evidence")
INDEX_FILE   = EVIDENCE_DIR / "index.json"
DOMAINS_DIR  = EVIDENCE_DIR / "domains"
BLOCKS_DIR   = EVIDENCE_DIR / "blocks"

def init_storage():
    EVIDENCE_DIR.mkdir(exist_ok=True)
    DOMAINS_DIR.mkdir(exist_ok=True)
    BLOCKS_DIR.mkdir(exist_ok=True)
    if not INDEX_FILE.exists():
        _write_json(INDEX_FILE, {"version":"1.0","total_blocks":0,"chain":[]})

def _write_json(path, data):
    path.parent.mkdir(parents=True, exist_ok=True)
    with open(path, "w", encoding="utf-8") as f:
        json.dump(data, f, indent=2, ensure_ascii=False)

def _read_json(path, default=None):
    if path.exists():
        with open(path, encoding="utf-8") as f:
            return json.load(f)
    return default

def _extract_domain(url):
    return url.replace("https://","").replace("http://","").split("/")[0].split("?")[0].lower()

def _month_folder():
    month = datetime.now().strftime("%Y-%m")
    p = BLOCKS_DIR / month
    p.mkdir(parents=True, exist_ok=True)
    return p

init_storage()

# ── Keyword pre-classifier (runs instantly, no API call needed) ────────────────
FAST_LABELS = {
    "termination clause":  ["terminat","cancel your account","without notice","at any time","deactivat","suspend your","revoke access","discontinue","close your account"],
    "auto-renewal":        ["automatically renew","auto-renew","recurring charge","unless you cancel","subscription will renew","charged automatically","continuous subscription"],
    "privacy breach":      ["sell your","third-party partner","we may share","behavioral data","share your personal","advertising partner","data broker","sell or transfer your"],
    "theft":               ["irrevocable license","perpetual license","royalty-free","you grant us","worldwide license","sublicense","assign all","transfer all rights"],
    "arbitration":         ["binding arbitration","class action waiver","you agree to arbitrate","waive your right to","individual basis","no class","small claims court"],
    "indemnification":     ["indemnify","hold harmless","defend us","attorney fees","legal costs","you will be liable","you shall indemnify"],
}

RISK_WEIGHTS = {
    "termination clause": 0.80, "auto-renewal": 0.70,
    "privacy breach": 0.90,     "theft": 1.0,
    "arbitration": 0.88,        "indemnification": 0.95,
    "risky": 0.75,              "neutral": 0.3,
    "refund clause": 0.2,       "consumer-friendly": 0.1,
}

RISKY_LABELS = {"risky","termination clause","privacy breach","theft","auto-renewal","arbitration","indemnification"}

HIGH_VALUE_KW = [
    "terminat","cancel","suspend","ban","restrict","revok","deactivat","block","discontinu","withhold","forfeit",
    "data","personal","privacy","collect","share","third party","partner","track","monitor","profil","location",
    "device","cookie","beacon","identif","biometric","facial","voice","behavioural",
    "renew","auto","recurring","charge","billing","subscription","fee","payment","price","refund","return",
    "reimburse","credit","debit","wallet","balance","penalty","fine","interest",
    "own","intellectual property","license","copyright","trademark","royalt","assign","transfer","grant","content","upload","post",
    "arbitration","dispute","lawsuit","court","jurisdiction","govern","liable","liability","indemnif",
    "waiv","damages","class action","settlement","mediati",
    "at any time","without notice","sole discretion","without reason","without liability","without warning","unilateral",
    "consent","agree","accept","bind","oblig",
    "modify","amend","change","update terms","new terms","effective immediately","continued use",
    "deemed acceptance","entire agreement","severab","surviv",
    "force majeure","limitation of liability","disclaimer","as is","no warrant","maximum extent",
]

HIDDEN_BONUS_KW = [
    "at any time","without notice","sole discretion","without liability","indemnif",
    "arbitration","class action","limitation of liability","as is","no warrant",
    "effective immediately","continued use","deemed acceptance",
]

SKIP_RE = re.compile(
    r"^(this agreement|these terms|by using|welcome to|last updated|effective date|introduction)"
    r"|\d+\.\s*(introduction|overview|general|definitions?|interpretation)\s*$"
    r"|^(if you have any questions|contact us at|for more information|please read)"
    r"|^(©|copyright \d{4}|all rights reserved)"
    r"|^(table of contents|jump to|section \d+:?\s*$)",
    re.IGNORECASE
)

# ── Fast keyword classifier ────────────────────────────────────────────────────
def fast_classify(clause_text):
    """Instant classification using keywords — no API call needed."""
    t = clause_text.lower()
    for label, keywords in FAST_LABELS.items():
        hits = sum(1 for kw in keywords if kw in t)
        if hits >= 2:
            return label, min(0.75 + hits * 0.04, 0.95)
    return None, 0.0

# ── Groq AI classifier ─────────────────────────────────────────────────────────
def groq_classify(clause_text):
    """
    Uses Groq's free LLaMA 3 API to classify clause.
    Only called when fast_classify returns nothing.
    """
    if not GROQ_API_KEY:
        return "risky", 0.6

    prompt = f"""You are a legal clause classifier for Indian consumer protection law.

Classify this T&C clause into EXACTLY ONE of these categories:
- termination clause (company can close/suspend your account)
- auto-renewal (subscription charges automatically)
- privacy breach (collects/shares/sells personal data)
- theft (claims ownership of your content/IP)
- arbitration (forces private arbitration, waives court rights)
- indemnification (user must pay company's legal costs)
- refund clause (refund/cancellation policy)
- consumer-friendly (protects or benefits the user)
- neutral (standard boilerplate, no significant impact)

Clause: "{clause_text[:500]}"

Reply with ONLY a JSON object, nothing else:
{{"label": "category name here", "confidence": 0.85, "reason": "one sentence why"}}"""

    try:
        resp = requests.post(
            GROQ_URL,
            headers={
                "Authorization": f"Bearer {GROQ_API_KEY}",
                "Content-Type":  "application/json"
            },
            json={
                "model":       GROQ_MODEL,
                "messages":    [{"role":"user","content":prompt}],
                "max_tokens":  120,
                "temperature": 0.1,
            },
            timeout=15
        )
        resp.raise_for_status()
        text = resp.json()["choices"][0]["message"]["content"].strip()
        # Parse JSON — Groq follows instructions well
        parsed = json.loads(text)
        label  = parsed.get("label","neutral").lower().strip()
        conf   = float(parsed.get("confidence", 0.7))
        return label, conf
    except Exception as e:
        print(f"  Groq error: {e}")
        return "risky", 0.6   # safe fallback — flag it for review

# ── Clause extraction ──────────────────────────────────────────────────────────
def is_heading(t):
    t = t.strip()
    if len(t.split()) > 12: return False
    if t.isupper() and len(t) > 3: return True
    if re.match(r'^\d+[\.]\s+[A-Z]', t): return True
    if re.match(r'^[A-Z][A-Z\s]{3,}$', t): return True
    if t.endswith(":") and len(t.split()) <= 8: return True
    return False

def is_high_value(c):
    cl = c.lower()
    return any(kw in cl for kw in HIGH_VALUE_KW)

def clause_score(c):
    cl = c.lower()
    return sum(1 for kw in HIGH_VALUE_KW if kw in cl) + sum(3 for ph in HIDDEN_BONUS_KW if ph in cl)

def extract_all_clauses(full_text, max_clauses=21):
    parts = re.split(
        r'(?<=[.!?])\s+(?=[A-Z0-9])|'
        r'\n{2,}|'
        r'(?=\n\s*\d+[\.]\s)|'
        r'(?=\n\s*[•\-\u2013\u2014]\s)',
        full_text
    )
    parts = [p.strip() for p in parts if p.strip()]
    clauses, heading_buf = [], None
    for part in parts:
        if is_heading(part):
            heading_buf = part; continue
        text = (heading_buf + ". " + part) if heading_buf else part
        heading_buf = None
        if len(text.split()) < 7: continue
        if SKIP_RE.match(text.strip()): continue
        if not is_high_value(text): continue
        clauses.append(text)
    seen, deduped = set(), []
    for c in clauses:
        key = re.sub(r'\s+', ' ', c[:80].lower())
        if key not in seen:
            seen.add(key); deduped.append(c)
    return sorted(deduped, key=clause_score, reverse=True)[:max_clauses]

# ── Result builder ─────────────────────────────────────────────────────────────
def plain_eng(text, label):
    t = text.lower()
    if "indemnif" in t:                               return "You agree to pay the company's legal costs — even for problems they caused."
    if "arbitration" in t or "class action" in t:     return "You may lose your right to sue in court or join class action lawsuits."
    if "limitation of liability" in t:                return "They cap how much they owe you if something goes wrong."
    if "as is" in t or "no warrant" in t:             return "They promise nothing about quality or reliability of their service."
    if "deemed acceptance" in t or "continued use" in t: return "Just using the service means you agreed to new terms — even unread."
    if "sole discretion" in t:                        return "They can make decisions about your account with zero explanation."
    if "surviv" in t:                                 return "These obligations stay even after you delete your account."
    if "terminat" in t or "cancel" in t:              return "They can end your access or delete your account — possibly without warning."
    if "renew" in t or "subscription" in t:           return "Your subscription auto-renews and charges your card unless you cancel."
    if "data" in t or "personal info" in t:           return "Your personal data may be collected and shared with other companies."
    if "refund" in t or "return" in t:                return "You may be able to get your money back — check the time limits."
    if "intellectual property" in t:                  return "You're giving them rights over content you post on their platform."
    if "third part" in t:                             return "They can share your information with outside companies."
    if label == "consumer-friendly":                  return "This part protects you — written in your favor."
    return "Legal clause — tap to expand."

def get_location(doc, clause, doc_len):
    pos = doc.find(clause[:40])
    pct = round((pos / max(doc_len, 1)) * 100) if pos >= 0 else 50
    return pct

def clause_summary(clause_text, label, risk_score, is_hidden, legal):
    t       = clause_text.lower()
    refs    = legal.get("references", [])
    verdict = legal.get("overall_verdict", "LEGAL")

    what = {
        "termination clause": ("They can terminate your account without notice at any time" if "without notice" in t or "at any time" in t else "They can close your account if you breach any part of these terms"),
        "auto-renewal":       ("Your subscription automatically charges your card every cycle unless you cancel before renewal" if "unless" in t and "cancel" in t else "Your payment method will be charged automatically on renewal"),
        "privacy breach":     ("They can sell your personal data to third parties" if "sell" in t else "They share your data with advertising and business partners" if "advertising" in t or "partner" in t else "They collect your personal information and may share it with outside companies"),
        "theft":              ("You grant them a permanent, irrevocable, royalty-free license over your content" if "irrevocable" in t or "perpetual" in t else "Any content you post becomes available to them under a broad worldwide license"),
        "arbitration":        ("You waive your right to join a class-action lawsuit" if "class action" in t else "All disputes must go to private binding arbitration — not a public court"),
        "indemnification":    ("You agree to personally pay this company's legal costs if they are sued because of your use" if "attorney" in t or "legal fees" in t else "You take on financial liability for claims made against this company"),
    }.get(label, "This clause places legal obligations on you that are not obvious from the service description.")

    hidden_note = " ⚠️ This clause was deliberately buried at the bottom of the document — a common tactic to hide unfavourable terms." if is_hidden else ""

    why = {
        "termination clause": f"Risk: {risk_score}/100. Companies have used this to freeze accounts holding wallet balances. Paytm's 2021 account freeze and Google+'s shutdown are real examples." + hidden_note,
        "auto-renewal":       f"Risk: {risk_score}/100. Auto-renewals are the leading cause of unexpected bank charges in India. OTT platforms and gyms regularly renew at higher prices than the original offer." + hidden_note,
        "privacy breach":     f"Risk: {risk_score}/100. WhatsApp was fined €225M by the EU for undisclosed data sharing. DPDP Act 2023 now gives you rights — but only if you assert them." + hidden_note,
        "theft":              f"Risk: {risk_score}/100. Instagram tried to claim rights to sell user photos in 2012. An irrevocable license cannot be taken back even after you delete your account." + hidden_note,
        "arbitration":        f"Risk: {risk_score}/100. Uber used binding arbitration to block thousands of harassment claims from being heard together in court." + hidden_note,
        "indemnification":    f"Risk: {risk_score}/100. Gig workers on Zomato and Ola have faced liability for incidents the platform was arguably responsible for." + hidden_note,
    }.get(label, f"Risk: {risk_score}/100. This clause significantly alters your legal rights in favour of the company." + hidden_note)

    if refs:
        ref    = refs[0]
        rights = f"Under {ref.get('regulation','applicable law')} {ref.get('section','')}: {ref.get('plain_english') or ref.get('summary','You have protections this clause cannot override.')}"
    else:
        rights = {
            "termination clause": "CPA 2019 §2(9) requires paid-service providers to give reasonable notice before termination. File at consumerhelpline.gov.in (1800-11-4000).",
            "auto-renewal":       "RBI e-Mandate Circular 2021 requires a pre-debit notification at least 24 hours before every recurring charge. Dispute via your bank if violated.",
            "privacy breach":     "DPDP Act 2023 §6 requires explicit consent before data sharing. §12 gives you the right to request deletion. File with the Data Protection Board.",
            "theft":              "Copyright Act 1957 §17 confirms you are the original author. Courts can void excessively broad IP clauses under §57 (moral rights).",
            "arbitration":        "CPA 2019 §100 explicitly preserves your right to file in Indian consumer courts — regardless of any arbitration clause.",
            "indemnification":    "Indian Contract Act 1872 §23 voids clauses that are unlawful or against public policy. Courts regularly void unconscionable indemnity terms.",
        }.get(label, "Consult a consumer rights lawyer or file at consumerhelpline.gov.in if this clause causes harm.")

    action = {
        "termination clause": "Before agreeing: Screenshot your wallet balance and paid subscription proof. If terminated unfairly: File at consumerhelpline.gov.in within 2 years.",
        "auto-renewal":       "Set a calendar reminder 3 days before renewal date. To fight a charge: Request a bank chargeback citing RBI e-Mandate non-compliance.",
        "privacy breach":     "Email the company's DPO (Data Protection Officer) to request your data and who it was shared with. They must respond within 72 hours under DPDP Act.",
        "theft":              "Watermark original content before uploading. Keep dated records proving original authorship — admissible under the Indian Evidence Act.",
        "arbitration":        "File directly in your State Consumer Disputes Redressal Commission — this right cannot be waived by contract under CPA 2019 §100.",
        "indemnification":    "Challenge in court citing ICA §23 if enforced. Courts regularly void clauses that are unconscionable or disproportionate to user actions.",
    }.get(label, "Read carefully before agreeing. For paid services, consult a consumer rights lawyer if unsure.")

    verdict_label = {
        "ILLEGAL":              "This clause may violate applicable Indian law",
        "QUESTIONABLE":         "This clause is legally questionable under Indian law",
        "REQUIRES_DISCLOSURE":  "This clause requires specific disclosures by law",
        "LEGAL":                "This clause is legally permissible but unfavourable to you",
    }.get(verdict, "Legal status unclear — consult a professional")

    return {"what_it_says": what, "why_it_matters": why, "your_rights": rights, "action": action, "verdict_label": verdict_label}

def build_result(clause, label, confidence, raw_text, doc_len):
    is_risky  = label in RISKY_LABELS
    rs        = min(round(confidence * RISK_WEIGHTS.get(label, 0.5) * 100), 100)
    pct       = get_location(raw_text, clause, doc_len)
    is_hidden = pct >= 70 and is_risky
    try:    legal = analyze_clause_legally_dict(clause, label)
    except: legal = {"domain":"General","all_domains":[],"overall_verdict":"LEGAL","risk_level":"LOW","summary_simple":"","summary_pro":"","references":[]}
    summary = clause_summary(clause, label, rs, is_hidden, legal)
    return {
        "text":          clause,
        "labels":        [label],
        "scores":        [round(confidence, 4)],
        "is_risky":      is_risky,
        "risk_score":    rs,
        "plain_english": plain_eng(clause, label),
        "summary":       summary,
        "legal":         legal,
        "position_pct":  pct,
        "is_hidden_risk": is_hidden,
    }, is_risky

# ── POST /analyze ──────────────────────────────────────────────────────────────
@app.route("/analyze", methods=["POST", "OPTIONS"])
def analyze():
    if request.method == "OPTIONS":
        return "", 200

    data     = request.get_json(force=True, silent=True) or {}
    raw_text = (data.get("text","") or "").strip()
    url, title = data.get("url",""), data.get("title","")

    if not raw_text:
        return jsonify({"error": "No text provided"}), 400

    doc_len = len(raw_text)
    print(f"\n📄 {doc_len:,} chars | {url[:60]}")

    clauses = extract_all_clauses(raw_text)
    if not clauses:
        sents   = [s.strip() for s in re.split(r'(?<=[.!?])\s+', raw_text) if len(s.split())>6]
        clauses = sents[:21]
    if not clauses:
        return jsonify({"error": "Could not extract clauses from document"}), 400

    print(f"🔍 {len(clauses)} clauses — classifying...")
    t0 = time.time()
    results, rc, sc = [], 0, 0
    fast_hits, ai_hits = 0, 0

    for i, clause in enumerate(clauses):
        # Fast keyword check first (instant, no API call)
        label, conf = fast_classify(clause)
        method = "FAST"

        if not label:
            # Use Groq AI only when keywords are not enough
            label, conf = groq_classify(clause)
            method = "AI"
            ai_hits += 1
        else:
            fast_hits += 1

        res, risky = build_result(clause, label, conf, raw_text, doc_len)
        if risky: rc += 1
        else:     sc += 1
        results.append(res)
        flag = " 🔴HIDDEN" if res["is_hidden_risk"] else ""
        print(f"  [{i+1}/{len(clauses)}] [{method}] {label} ({round(conf*100)}%){flag} — {clause[:50]}…")

    # Sort: hidden + high risk first
    results.sort(key=lambda r: (r["is_hidden_risk"], r["risk_score"], r["is_risky"]), reverse=True)

    elapsed = round(time.time()-t0, 1)

    # Weighted document risk score
    if results:
        sev = {"indemnification":1.0,"theft":1.0,"privacy breach":0.9,"arbitration":0.88,"termination clause":0.8,"auto-renewal":0.7}
        ws  = [min((r["risk_score"]/100)*sev.get(r["labels"][0],0.5)*(1.15 if r["is_hidden_risk"] else 1.0),1.0) for r in results]
        doc_score = round(sum(ws)/len(ws)*100)
        density   = rc / max(len(results), 1)
        if density >= 0.7:  doc_score = min(doc_score+10, 100)
        elif density >= 0.5: doc_score = min(doc_score+5, 100)
        hidden_c = sum(1 for r in results if r["is_hidden_risk"])
        if hidden_c >= 3:   doc_score = min(doc_score+8, 100)
        overall = "HIGH" if doc_score>=60 else "MEDIUM" if doc_score>=30 else "LOW"
    else:
        doc_score=0; overall="LOW"; hidden_c=0

    hidden = sum(1 for r in results if r["is_hidden_risk"])
    print(f"✅ {elapsed}s | {overall} ({doc_score}/100) | {rc}/{len(results)} risky | {hidden} hidden | fast:{fast_hits} ai:{ai_hits}")

    return jsonify({
        "url": url, "title": title, "clauses": results,
        "total": len(results), "risky_count": rc, "safe_count": sc,
        "overall_risk": overall, "risk_score": doc_score,
        "hidden_risks": hidden, "doc_length": doc_len,
        "analyzed_at": int(time.time()), "elapsed_sec": elapsed,
    })

# ── POST /hash ─────────────────────────────────────────────────────────────────
@app.route("/hash", methods=["POST","OPTIONS"])
def hash_and_store():
    if request.method == "OPTIONS": return "", 200
    data     = request.get_json(force=True, silent=True) or {}
    url      = data.get("url","")
    analysis = data.get("analysis",{})
    raw_text = data.get("raw_text","")
    if not url or not analysis:
        return jsonify({"error":"Missing url or analysis"}), 400

    domain   = _extract_domain(url)
    block_id = str(uuid.uuid4())[:8].upper()
    ts       = int(time.time())
    dt       = datetime.fromtimestamp(ts)
    clauses  = analysis.get("clauses",[])

    index     = _read_json(INDEX_FILE, {"version":"1.0","total_blocks":0,"chain":[]})
    chain     = index.get("chain",[])
    prev_hash = chain[-1]["sha256_hash"] if chain else "0"*64
    raw_text_hash = hashlib.sha256(raw_text.encode()).hexdigest() if raw_text else ""

    payload = {
        "block_id":      block_id,
        "url":           url,
        "domain":        domain,
        "timestamp":     ts,
        "prev_hash":     prev_hash,
        "overall_risk":  analysis.get("overall_risk",""),
        "risk_score":    analysis.get("risk_score",0),
        "clauses_count": len(clauses),
        "hidden_risks":  analysis.get("hidden_risks",0),
        "doc_length":    analysis.get("doc_length",0),
        "raw_text_hash": raw_text_hash,
        "clause_hashes": [hashlib.sha256(c.get("text","").encode()).hexdigest()[:16] for c in clauses],
    }
    sha = hashlib.sha256(json.dumps(payload, sort_keys=True).encode()).hexdigest()
    full_block = {**payload, "sha256_hash":sha, "stored_date":dt.strftime("%Y-%m-%d"),
                  "raw_text":raw_text, "full_clauses":clauses}

    # Save block file
    block_file = _month_folder() / f"{block_id}.json"
    _write_json(block_file, full_block)

    # Update domain file
    safe_domain = re.sub(r'[^\w.\-]','_',domain)
    domain_file = DOMAINS_DIR / f"{safe_domain}.json"
    dd = _read_json(domain_file, {"domain":domain,"blocks":[]})
    dd["blocks"].append({"block_id":block_id,"timestamp":ts,"url":url,
                          "overall_risk":analysis.get("overall_risk",""),
                          "risk_score":analysis.get("risk_score",0),
                          "sha256_hash":sha,"raw_text_hash":raw_text_hash})
    _write_json(domain_file, dd)

    # Update index
    entry = {**{k:payload[k] for k in ["block_id","domain","url","timestamp","overall_risk","risk_score","clauses_count","hidden_risks","sha256_hash","raw_text_hash"]},
             "date": dt.strftime("%Y-%m-%d %H:%M"),
             "raw_text_kb": round(len(raw_text)/1024,1),
             "block_file": str(block_file)}
    chain.append(entry)
    index["total_blocks"] = len(chain)
    index["last_updated"] = dt.isoformat()
    index["chain"] = chain
    _write_json(INDEX_FILE, index)

    print(f"  ⛓ #{len(chain)} | {block_id} | {domain} | {analysis.get('overall_risk')} | {round(len(raw_text)/1024,1)}KB")
    return jsonify({"block_id":block_id,"sha256_hash":sha,"raw_text_hash":raw_text_hash,
                    "timestamp":ts,"prev_hash":prev_hash,"total_entries":len(chain),
                    "overall_risk":analysis.get("overall_risk",""),
                    "risk_score":analysis.get("risk_score",0),"clauses_count":len(clauses)})

# ── GET /ledger ────────────────────────────────────────────────────────────────
@app.route("/ledger", methods=["GET","OPTIONS"])
def get_ledger():
    if request.method == "OPTIONS": return "", 200
    domain_filter = request.args.get("domain")
    index = _read_json(INDEX_FILE, {"total_blocks":0,"chain":[]})
    chain = index.get("chain",[])
    if domain_filter:
        chain = [b for b in chain if b.get("domain","").lower()==domain_filter.lower()]
    return jsonify({"total":len(chain),"entries":chain})

# ── GET /verify/<block_id> ─────────────────────────────────────────────────────
@app.route("/verify/<block_id>", methods=["GET","OPTIONS"])
def verify_block(block_id):
    if request.method == "OPTIONS": return "", 200
    block_data = None
    for month_dir in BLOCKS_DIR.iterdir():
        bf = month_dir / f"{block_id.upper()}.json"
        if bf.exists():
            block_data = _read_json(bf); break
    if not block_data:
        return jsonify({"error":"Block not found"}), 404
    payload = {k:block_data.get(k) for k in ["block_id","url","domain","timestamp","prev_hash","overall_risk","risk_score","clauses_count","hidden_risks","doc_length","raw_text_hash","clause_hashes"]}
    sha   = hashlib.sha256(json.dumps(payload,sort_keys=True).encode()).hexdigest()
    valid = sha == block_data.get("sha256_hash","")
    return jsonify({"block_id":block_id.upper(),"valid":valid,"sha256_hash":block_data.get("sha256_hash",""),
                    "raw_text_stored":bool(block_data.get("raw_text","")),"raw_text_kb":round(len(block_data.get("raw_text",""))/1024,1)})

# ── GET /health ────────────────────────────────────────────────────────────────
@app.route("/health", methods=["GET"])
def health():
    index = _read_json(INDEX_FILE, {"total_blocks":0})
    return jsonify({"status":"ok","version":"7.0","model":"groq/llama3-8b-8192",
                    "groq_configured":bool(GROQ_API_KEY),"total_blocks":index.get("total_blocks",0)})

if __name__ == "__main__":
    port = int(os.environ.get("PORT", 5000))
    print(f"🚀 Trinetra.net v7.0 — Cloud Backend — port {port}")
    print(f"🤖 AI: Groq LLaMA 3 ({'✅ configured' if GROQ_API_KEY else '❌ GROQ_API_KEY not set'})")
    app.run(host="0.0.0.0", port=port, debug=False)
