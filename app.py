"""
app.py — Trinetra.net Cloud Backend v7.1
==========================================
Fixes:
- Groq JSON parsing made robust (handles markdown code blocks)
- Consumer-friendly detection vastly improved
- Hash & Store uses proper response confirmation
- Better error logging to debug Railway issues
"""

from flask import Flask, request, jsonify
from flask_cors import CORS
from legal_reference_engine import analyze_clause_legally_dict
import hashlib, json, time, os, re, uuid, requests
from datetime import datetime
from pathlib import Path

app = Flask(__name__)
CORS(app, origins="*", methods=["GET","POST","OPTIONS"],
     allow_headers=["Content-Type","Authorization"])

# ── Config ─────────────────────────────────────────────────────────────────────
GROQ_API_KEY = os.environ.get("GROQ_API_KEY", "")
GROQ_URL     = "https://api.groq.com/openai/v1/chat/completions"
GROQ_MODEL   = "llama3-8b-8192"

# ── Storage (Railway ephemeral — use /tmp which persists within a session) ─────
EVIDENCE_DIR = Path("/tmp/trinetra_evidence")
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
    with open(path,"w",encoding="utf-8") as f:
        json.dump(data, f, indent=2, ensure_ascii=False)

def _read_json(path, default=None):
    try:
        if path.exists():
            with open(path, encoding="utf-8") as f:
                return json.load(f)
    except Exception:
        pass
    return default

def _extract_domain(url):
    return url.replace("https://","").replace("http://","").split("/")[0].split("?")[0].lower()

def _month_folder():
    p = BLOCKS_DIR / datetime.now().strftime("%Y-%m")
    p.mkdir(parents=True, exist_ok=True)
    return p

init_storage()

# ── Labels ─────────────────────────────────────────────────────────────────────
RISKY_LABELS = {
    "risky","termination clause","privacy breach","theft",
    "auto-renewal","arbitration","indemnification"
}
SAFE_LABELS = {"consumer-friendly","refund clause","neutral"}

RISK_WEIGHTS = {
    "termination clause":0.80, "auto-renewal":0.70,
    "privacy breach":0.90,     "theft":1.0,
    "arbitration":0.88,        "indemnification":0.95,
    "risky":0.75,              "neutral":0.15,
    "refund clause":0.10,      "consumer-friendly":0.05,
}

# ── Fast keyword classifier ────────────────────────────────────────────────────
# RISKY patterns — 2+ hits = instant classification
FAST_RISKY = {
    "termination clause": [
        "terminat","cancel your account","without notice","at any time",
        "deactivat","suspend your","revoke access","discontinue","close your account",
        "right to terminate","immediately terminate","suspend or terminate"
    ],
    "auto-renewal": [
        "automatically renew","auto-renew","recurring charge","unless you cancel",
        "subscription will renew","charged automatically","continuous subscription",
        "will be charged","renewal date","automatically charged"
    ],
    "privacy breach": [
        "sell your","third-party partner","we may share","behavioral data",
        "share your personal","advertising partner","data broker",
        "sell or transfer your","share with third","disclose your"
    ],
    "theft": [
        "irrevocable license","perpetual license","royalty-free","you grant us",
        "worldwide license","sublicense","assign all","transfer all rights",
        "grant google","grant us a","license to use"
    ],
    "arbitration": [
        "binding arbitration","class action waiver","you agree to arbitrate",
        "waive your right to","individual basis","no class","small claims court",
        "arbitration agreement","mandatory arbitration"
    ],
    "indemnification": [
        "indemnify","hold harmless","defend us","attorney fees",
        "legal costs","you will be liable","you shall indemnify",
        "indemnify and defend","hold google harmless"
    ],
}

# CONSUMER-FRIENDLY patterns — 1+ hit = instant classification
FAST_CONSUMER = {
    "refund clause": [
        "full refund","money back guarantee","money-back","refund within",
        "entitled to refund","we will refund","30-day refund","7-day refund",
        "14-day refund","cancel and receive","no questions asked",
        "pro-rata refund","prorated refund"
    ],
    "consumer-friendly": [
        "you have the right to","you may cancel at any time","we will not sell your",
        "we do not sell your","you retain ownership","you own all",
        "we will notify you at least","prior written notice of at least",
        "opt out at any time","withdraw your consent","you are entitled to",
        "at no charge to you","free of charge","your data will be deleted",
        "upon your request we will","you can request deletion",
        "right to access your","right to delete","right to data portability",
        "we will give you","we are committed to","protecting your privacy",
        "you control your","you decide","your choice","you may choose",
        "no obligation","without penalty","no cancellation fee",
        "right to object","right to restrict","right to rectif",
        "you keep all rights","all rights reserved to you",
        "your content belongs","you retain all intellectual",
        "we respect your","your privacy matters","we take your privacy"
    ],
}

def fast_classify(clause_text):
    """Returns (label, confidence) or (None, 0) if no match."""
    t = clause_text.lower()

    # Check consumer-friendly first (1 hit is enough)
    for label, keywords in FAST_CONSUMER.items():
        for kw in keywords:
            if kw in t:
                return label, 0.82

    # Check risky (need 2+ hits)
    for label, keywords in FAST_RISKY.items():
        hits = sum(1 for kw in keywords if kw in t)
        if hits >= 2:
            return label, min(0.75 + hits * 0.04, 0.95)

    # Single risky hit — still flag it
    for label, keywords in FAST_RISKY.items():
        for kw in keywords:
            if kw in t:
                return label, 0.68

    return None, 0.0

# ── Groq AI classifier ─────────────────────────────────────────────────────────
def groq_classify(clause_text):
    """Calls Groq free API. Robust JSON parsing handles any response format."""
    if not GROQ_API_KEY:
        print("  ⚠️  GROQ_API_KEY not set — using keyword fallback")
        return "neutral", 0.5

    prompt = f"""Classify this legal clause. Reply with ONLY valid JSON, no markdown, no explanation.

Categories:
termination clause | auto-renewal | privacy breach | theft | arbitration | indemnification | refund clause | consumer-friendly | neutral

Clause: "{clause_text[:400]}"

JSON format: {{"label":"category","confidence":0.85}}"""

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
                "max_tokens":  60,
                "temperature": 0.0,
            },
            timeout=12
        )
        resp.raise_for_status()
        raw = resp.json()["choices"][0]["message"]["content"].strip()
        print(f"  Groq raw: {raw[:80]}")

        # ── Robust JSON extraction ─────────────────────────────────────────
        # Strip markdown code fences if present
        raw = re.sub(r'```(?:json)?', '', raw).strip()
        # Find the JSON object
        match = re.search(r'\{[^}]+\}', raw)
        if match:
            parsed = json.loads(match.group(0))
            label  = parsed.get("label", "neutral").lower().strip()
            conf   = float(parsed.get("confidence", 0.7))
            # Validate label is one of our known labels
            all_labels = set(FAST_RISKY.keys()) | {"consumer-friendly","refund clause","neutral","risky"}
            if label not in all_labels:
                label = "neutral"
            return label, conf
        else:
            # Try to find label directly in text
            for lbl in ["termination clause","auto-renewal","privacy breach","theft",
                        "arbitration","indemnification","refund clause","consumer-friendly","neutral"]:
                if lbl in raw.lower():
                    return lbl, 0.72
            return "neutral", 0.5

    except requests.exceptions.Timeout:
        print("  ⚠️  Groq timeout — using neutral")
        return "neutral", 0.5
    except Exception as e:
        print(f"  ⚠️  Groq error: {type(e).__name__}: {e}")
        return "neutral", 0.5

# ── Keyword lists ──────────────────────────────────────────────────────────────
HIGH_VALUE_KW = [
    "terminat","cancel","suspend","ban","restrict","revok","deactivat","block",
    "discontinu","withhold","forfeit","data","personal","privacy","collect","share",
    "third party","partner","track","monitor","profil","location","device","cookie",
    "renew","auto","recurring","charge","billing","subscription","fee","payment",
    "price","refund","return","reimburse","credit","debit","wallet","balance",
    "own","intellectual property","license","copyright","trademark","royalt",
    "assign","transfer","grant","content","upload","post","arbitration","dispute",
    "lawsuit","court","liable","liability","indemnif","waiv","damages","class action",
    "at any time","without notice","sole discretion","without liability",
    "consent","agree","accept","modify","amend","force majeure","disclaimer","as is",
]

CONSUMER_KW = [
    "you have the right","you may cancel","cancel at any time","cancel anytime",
    "full refund","money back","we will refund","entitled to","no charge",
    "free of charge","you own","you retain","you keep","your content remains",
    "we will notify","prior notice","we will not sell","we do not sell",
    "opt out","withdraw consent","your data will be deleted","upon your request",
    "right to access","right to delete","right to erasure","right to portability",
    "we respect","protecting your","your privacy","you control","you decide",
    "30-day","7-day","14-day","money-back","no cancellation fee","no penalty",
    "all rights reserved to you","belongs to you","you retain all",
]

HIDDEN_BONUS_KW = [
    "at any time","without notice","sole discretion","without liability",
    "indemnif","arbitration","class action","limitation of liability",
    "as is","no warrant","effective immediately","deemed acceptance",
]

SKIP_RE = re.compile(
    r"^(this agreement|these terms|by using|welcome to|last updated|effective date)"
    r"|\d+\.\s*(introduction|overview|general|definitions?)\s*$"
    r"|^(if you have any questions|contact us at|please read|table of contents)"
    r"|^(©|copyright \d{4}|all rights reserved)",
    re.IGNORECASE
)

def is_heading(t):
    t = t.strip()
    if len(t.split()) > 12: return False
    if t.isupper() and len(t) > 3: return True
    if re.match(r'^\d+[\.]\s+[A-Z]', t): return True
    if t.endswith(":") and len(t.split()) <= 8: return True
    return False

def is_high_value(c):
    cl = c.lower()
    return (any(kw in cl for kw in HIGH_VALUE_KW) or
            any(kw in cl for kw in CONSUMER_KW))

def is_consumer(c):
    cl = c.lower()
    return any(kw in cl for kw in CONSUMER_KW)

def clause_importance(c):
    cl = c.lower()
    r = sum(1 for kw in HIGH_VALUE_KW if kw in cl) + sum(3 for kw in HIDDEN_BONUS_KW if kw in cl)
    s = sum(2 for kw in CONSUMER_KW if kw in cl)
    return r + s

def extract_all_clauses(full_text, max_clauses=21):
    parts = re.split(
        r'(?<=[.!?])\s+(?=[A-Z0-9])|\n{2,}|(?=\n\s*\d+[\.]\s)|(?=\n\s*[•\-]\s)',
        full_text
    )
    parts = [p.strip() for p in parts if p.strip()]
    clauses, hbuf = [], None
    for part in parts:
        if is_heading(part): hbuf = part; continue
        text = (hbuf + ". " + part) if hbuf else part
        hbuf = None
        if len(text.split()) < 7: continue
        if SKIP_RE.match(text.strip()): continue
        if not is_high_value(text): continue
        clauses.append(text)

    # Deduplicate
    seen, deduped = set(), []
    for c in clauses:
        key = re.sub(r'\s+', ' ', c[:80].lower())
        if key not in seen:
            seen.add(key); deduped.append(c)

    # Split into risky and consumer-friendly
    risky_pool    = sorted([c for c in deduped if not is_consumer(c)], key=clause_importance, reverse=True)
    consumer_pool = sorted([c for c in deduped if is_consumer(c)],     key=clause_importance, reverse=True)

    # Target: 70% risky, 30% consumer-friendly
    n_risky    = min(len(risky_pool),    int(max_clauses * 0.70))
    n_consumer = min(len(consumer_pool), max_clauses - n_risky)
    # Fill remaining with more risky if not enough consumer
    n_risky    = min(len(risky_pool), max_clauses - n_consumer)

    result = risky_pool[:n_risky] + consumer_pool[:n_consumer]
    print(f"  📊 {n_risky} risky + {n_consumer} consumer-friendly = {len(result)} total")
    return result[:max_clauses]

# ── Per-clause plain English ───────────────────────────────────────────────────
def plain_eng(text, label):
    t = text.lower()
    if label == "consumer-friendly": return "✅ This clause protects you — it is written in your favour."
    if label == "refund clause":     return "✅ You may be entitled to a refund — check the conditions carefully."
    if label == "neutral":           return "Standard legal language — low risk, no major concern."
    if "indemnif" in t:              return "You agree to pay the company's legal costs — even for problems they caused."
    if "arbitration" in t:           return "You may lose your right to sue in court or join class action lawsuits."
    if "limitation of liability" in t: return "They cap how much they owe you if something goes wrong."
    if "as is" in t or "no warrant" in t: return "They promise nothing about quality or reliability."
    if "sole discretion" in t:       return "They can make decisions about your account with zero explanation."
    if "terminat" in t or "cancel" in t: return "They can end your access or delete your account — possibly without warning."
    if "renew" in t or "subscription" in t: return "Your subscription auto-renews and charges your card unless you cancel."
    if "data" in t or "personal" in t: return "Your personal data may be collected and shared with other companies."
    if "intellectual property" in t: return "You're giving them rights over content you post on their platform."
    return "Legal clause — tap to see full analysis."

def get_location(doc, clause, doc_len):
    pos = doc.find(clause[:40])
    return round((pos / max(doc_len, 1)) * 100) if pos >= 0 else 50

def clause_summary(clause_text, label, risk_score, is_hidden, legal):
    t       = clause_text.lower()
    refs    = legal.get("references", [])
    verdict = legal.get("overall_verdict", "LEGAL")

    # ── What it says ────────────────────────────────────────────────────────
    if label == "consumer-friendly":
        what = ("This clause explicitly states you retain ownership of your content" if "retain" in t or "own" in t
                else "This clause gives you a specific right or protection that benefits you as a user")
    elif label == "refund clause":
        what = ("You are entitled to a full refund within the stated period — keep your payment receipt" if "full refund" in t or "money back" in t
                else "You can cancel and receive a refund — check the specific time limits carefully")
    elif label == "neutral":
        what = "Standard contract language defining how the agreement works — no significant consumer impact"
    else:
        what_map = {
            "termination clause": ("They can terminate your account without notice at any time" if "without notice" in t or "at any time" in t else "They can close your account if you violate any part of these terms"),
            "auto-renewal":       ("Your subscription automatically charges your card every cycle unless you cancel before renewal" if "unless" in t and "cancel" in t else "Your payment method will be charged automatically on renewal"),
            "privacy breach":     ("They can sell your personal data to third parties" if "sell" in t else "They share your data with advertising and business partners" if "advertising" in t or "partner" in t else "They collect your personal information and may share it outside the company"),
            "theft":              ("You grant them a permanent, irrevocable, royalty-free license over your content" if "irrevocable" in t or "perpetual" in t else "Any content you post becomes available to them under a broad worldwide license"),
            "arbitration":        ("You waive your right to join a class-action lawsuit" if "class action" in t else "All disputes must go to private binding arbitration — not a public court"),
            "indemnification":    ("You agree to personally pay this company's legal costs" if "attorney" in t or "legal fees" in t else "You take on financial liability for claims made against this company because of your use"),
        }
        what = what_map.get(label, "This clause places legal obligations on you that are not obvious from the service description.")

    # ── Why it matters ───────────────────────────────────────────────────────
    hidden_note = " ⚠️ This clause was deliberately buried at the bottom of the document." if is_hidden else ""
    if label == "consumer-friendly":
        why = f"This is a POSITIVE clause. It explicitly protects you or grants you a right. Consumer-protective language is rare in T&C documents — note it carefully so you can invoke it if needed."
    elif label == "refund clause":
        why = f"This is a POSITIVE clause. A clear refund policy is required under CPA 2019 §2(9). This clause confirms your right to get money back — screenshot it so you can hold the company to it if they refuse."
    elif label == "neutral":
        why = f"Risk: {risk_score}/100. This is standard boilerplate — courts see it regularly. No significant consumer concern under current Indian law."
    else:
        why_map = {
            "termination clause": f"Risk: {risk_score}/100. Companies have used this to freeze accounts holding wallet balances. Paytm's 2021 account freeze and Google+'s shutdown are real examples." + hidden_note,
            "auto-renewal":       f"Risk: {risk_score}/100. Auto-renewals are the leading cause of unexpected bank charges in India. OTT platforms and gyms regularly renew at higher prices than the original offer." + hidden_note,
            "privacy breach":     f"Risk: {risk_score}/100. WhatsApp was fined €225M by the EU for undisclosed data sharing. DPDP Act 2023 gives you rights — but only if you assert them." + hidden_note,
            "theft":              f"Risk: {risk_score}/100. Instagram tried to claim rights to sell user photos in 2012. An irrevocable license cannot be taken back even after you delete your account." + hidden_note,
            "arbitration":        f"Risk: {risk_score}/100. Uber used binding arbitration to block thousands of harassment claims from being heard in court." + hidden_note,
            "indemnification":    f"Risk: {risk_score}/100. Gig workers on Zomato and Ola have faced liability for incidents the platform was responsible for." + hidden_note,
        }
        why = why_map.get(label, f"Risk: {risk_score}/100. This clause significantly alters your legal rights in favour of the company." + hidden_note)

    # ── Your rights ──────────────────────────────────────────────────────────
    if label == "consumer-friendly":
        rights = "This clause works in your favour. Keep a screenshot of it. If the company later contradicts this clause, you can cite it as evidence in a consumer court complaint under CPA 2019."
    elif label == "refund clause":
        rights = "CPA 2019 §2(9) guarantees your right to seek redressal for defective services — even if a no-refund policy exists. File at edaakhil.nic.in for online consumer complaints."
    elif label == "neutral":
        rights = "No specific legal concern. Standard contract language under Indian Contract Act 1872 §10 — valid as long as basic contract requirements are met."
    elif refs:
        ref    = refs[0]
        rights = f"Under {ref.get('regulation','applicable law')} {ref.get('section','')}: {ref.get('plain_english') or ref.get('summary','')}"
    else:
        rights = {
            "termination clause": "CPA 2019 §2(9) requires paid-service providers to give reasonable notice before termination. File at consumerhelpline.gov.in (1800-11-4000).",
            "auto-renewal":       "RBI e-Mandate Circular 2021 requires a pre-debit notification at least 24 hours before every recurring charge. Dispute via your bank if violated.",
            "privacy breach":     "DPDP Act 2023 §6 requires explicit consent before data sharing. §12 gives you the right to request deletion within 72 hours.",
            "theft":              "Copyright Act 1957 §17 confirms you are the original author. §57 moral rights cannot be waived by contract.",
            "arbitration":        "CPA 2019 §100 preserves your right to file in Indian consumer courts — regardless of any arbitration clause.",
            "indemnification":    "Indian Contract Act 1872 §23 voids clauses that are unlawful or against public policy.",
        }.get(label, "Consult a consumer rights lawyer or file at consumerhelpline.gov.in.")

    # ── Action ───────────────────────────────────────────────────────────────
    if label == "consumer-friendly":
        action = "Screenshot this clause right now. Save it with the date and URL. If the company later violates what it promises here, this screenshot is your evidence for a consumer court complaint."
    elif label == "refund clause":
        action = "Screenshot this clause before agreeing. If refused a refund: (1) Email them citing this clause. (2) File at edaakhil.nic.in if ignored. (3) Raise a chargeback with your bank."
    elif label == "neutral":
        action = "No immediate action needed. This is standard legal boilerplate — read it but no specific steps required."
    else:
        action = {
            "termination clause": "Screenshot your wallet balance and paid subscription proof now. If terminated unfairly: File at consumerhelpline.gov.in within 2 years.",
            "auto-renewal":       "Set a calendar reminder 3 days before your renewal date. To fight a charge: Request a bank chargeback citing RBI e-Mandate non-compliance.",
            "privacy breach":     "Email the company's DPO to request your data and who it was shared with. They must respond within 72 hours under DPDP Act 2023.",
            "theft":              "Watermark original content before uploading. Keep dated screenshots proving original authorship — admissible under the Indian Evidence Act.",
            "arbitration":        "File directly in your State Consumer Disputes Redressal Commission — CPA 2019 §100 preserves this right regardless of the arbitration clause.",
            "indemnification":    "Challenge in court citing ICA §23 if enforced. Courts regularly void clauses that are unconscionable or disproportionate.",
        }.get(label, "Read carefully before agreeing. For paid services, consult a consumer rights lawyer if unsure.")

    verdict_label = {
        "ILLEGAL":             "This clause may violate applicable Indian law",
        "QUESTIONABLE":        "This clause is legally questionable under Indian law",
        "REQUIRES_DISCLOSURE": "This clause requires specific disclosures by law",
        "LEGAL":               "This clause is legally permissible",
    }.get(verdict, "Legal status unclear")

    return {
        "what_it_says":   what,
        "why_it_matters": why,
        "your_rights":    rights,
        "action":         action,
        "verdict_label":  verdict_label,
    }

def build_result(clause, label, confidence, raw_text, doc_len):
    is_risky  = label in RISKY_LABELS
    rs        = min(round(confidence * RISK_WEIGHTS.get(label, 0.5) * 100), 100)
    pct       = get_location(raw_text, clause, doc_len)
    is_hidden = pct >= 70 and is_risky
    try:    legal = analyze_clause_legally_dict(clause, label)
    except: legal = {"domain":"General","all_domains":[],"overall_verdict":"LEGAL","risk_level":"LOW","summary_simple":"","summary_pro":"","references":[]}
    summary = clause_summary(clause, label, rs, is_hidden, legal)
    return {
        "text":           clause,
        "labels":         [label],
        "scores":         [round(confidence, 4)],
        "is_risky":       is_risky,
        "risk_score":     rs,
        "plain_english":  plain_eng(clause, label),
        "summary":        summary,
        "legal":          legal,
        "position_pct":   pct,
        "is_hidden_risk": is_hidden,
    }, is_risky

# ── POST /analyze ──────────────────────────────────────────────────────────────
@app.route("/analyze", methods=["POST","OPTIONS"])
def analyze():
    if request.method == "OPTIONS": return "", 200
    data     = request.get_json(force=True, silent=True) or {}
    raw_text = (data.get("text","") or "").strip()
    url      = data.get("url","")
    title    = data.get("title","")
    if not raw_text:
        return jsonify({"error":"No text provided"}), 400

    doc_len = len(raw_text)
    print(f"\n📄 {doc_len:,} chars | {url[:60]}")

    clauses = extract_all_clauses(raw_text)
    if not clauses:
        sents   = [s.strip() for s in re.split(r'(?<=[.!?])\s+', raw_text) if len(s.split())>6]
        clauses = sents[:21]
    if not clauses:
        return jsonify({"error":"Could not extract clauses"}), 400

    print(f"🔍 Classifying {len(clauses)} clauses...")
    t0 = time.time()
    results, rc, sc = [], 0, 0
    fast_hits = ai_hits = 0

    for i, clause in enumerate(clauses):
        label, conf = fast_classify(clause)
        method = "FAST"
        if not label:
            label, conf = groq_classify(clause)
            method = "AI"; ai_hits += 1
        else:
            fast_hits += 1

        res, risky = build_result(clause, label, conf, raw_text, doc_len)
        if risky: rc += 1
        else:     sc += 1
        results.append(res)
        flag = " 🔴HIDDEN" if res["is_hidden_risk"] else ""
        print(f"  [{i+1}/{len(clauses)}] [{method}] {label} ({round(conf*100)}%){flag}")

    results.sort(key=lambda r: (r["is_hidden_risk"], r["risk_score"], r["is_risky"]), reverse=True)
    elapsed = round(time.time()-t0, 1)

    if results:
        sev = {"indemnification":1.0,"theft":1.0,"privacy breach":0.9,"arbitration":0.88,
               "termination clause":0.8,"auto-renewal":0.7}
        ws  = [min((r["risk_score"]/100)*sev.get(r["labels"][0],0.3)*(1.15 if r["is_hidden_risk"] else 1.0),1.0) for r in results]
        doc_score = round(sum(ws)/len(ws)*100)
        density   = rc / max(len(results),1)
        if density>=0.7:  doc_score=min(doc_score+10,100)
        elif density>=0.5: doc_score=min(doc_score+5,100)
        if sum(1 for r in results if r["is_hidden_risk"])>=3: doc_score=min(doc_score+8,100)
        overall = "HIGH" if doc_score>=60 else "MEDIUM" if doc_score>=30 else "LOW"
    else:
        doc_score=0; overall="LOW"

    hidden = sum(1 for r in results if r["is_hidden_risk"])
    print(f"✅ {elapsed}s | {overall} ({doc_score}/100) | {rc} risky, {sc} safe | fast:{fast_hits} ai:{ai_hits}")

    return jsonify({
        "url":url,"title":title,"clauses":results,
        "total":len(results),"risky_count":rc,"safe_count":sc,
        "overall_risk":overall,"risk_score":doc_score,
        "hidden_risks":hidden,"doc_length":doc_len,
        "analyzed_at":int(time.time()),"elapsed_sec":elapsed,
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

    full_block = {
        **payload,
        "sha256_hash": sha,
        "stored_date": dt.strftime("%Y-%m-%d %H:%M"),
        "raw_text":    raw_text[:50000],   # store first 50KB of raw text
        "full_clauses": clauses,
    }

    # Save block file
    block_file = _month_folder() / f"{block_id}.json"
    _write_json(block_file, full_block)

    # Update domain file
    safe_domain = re.sub(r'[^\w.\-]','_', domain)
    domain_file = DOMAINS_DIR / f"{safe_domain}.json"
    dd = _read_json(domain_file, {"domain":domain,"blocks":[]})
    dd["blocks"].append({
        "block_id":     block_id,
        "timestamp":    ts,
        "date":         dt.strftime("%Y-%m-%d %H:%M"),
        "url":          url,
        "overall_risk": analysis.get("overall_risk",""),
        "risk_score":   analysis.get("risk_score",0),
        "clauses_count":len(clauses),
        "sha256_hash":  sha,
        "raw_text_hash":raw_text_hash,
    })
    _write_json(domain_file, dd)

    # Update master index
    entry = {
        "block_id":      block_id,
        "domain":        domain,
        "url":           url,
        "timestamp":     ts,
        "date":          dt.strftime("%Y-%m-%d %H:%M"),
        "overall_risk":  analysis.get("overall_risk",""),
        "risk_score":    analysis.get("risk_score",0),
        "clauses_count": len(clauses),
        "hidden_risks":  analysis.get("hidden_risks",0),
        "sha256_hash":   sha,
        "raw_text_hash": raw_text_hash,
        "raw_text_kb":   round(len(raw_text)/1024,1),
    }
    chain.append(entry)
    index["total_blocks"] = len(chain)
    index["last_updated"] = dt.isoformat()
    index["chain"]        = chain
    _write_json(INDEX_FILE, index)

    kb = round(len(raw_text)/1024,1)
    print(f"  ⛓ #{len(chain)} | {block_id} | {domain} | {analysis.get('overall_risk')} | {kb}KB")

    return jsonify({
        "block_id":      block_id,
        "sha256_hash":   sha,
        "raw_text_hash": raw_text_hash,
        "timestamp":     ts,
        "prev_hash":     prev_hash,
        "total_entries": len(chain),
        "overall_risk":  analysis.get("overall_risk",""),
        "risk_score":    analysis.get("risk_score",0),
        "clauses_count": len(clauses),
        "raw_text_kb":   kb,
        "stored":        True,
    })

# ── GET /ledger ────────────────────────────────────────────────────────────────
@app.route("/ledger", methods=["GET","OPTIONS"])
def get_ledger():
    if request.method == "OPTIONS": return "", 200
    domain_filter = request.args.get("domain")
    index  = _read_json(INDEX_FILE, {"total_blocks":0,"chain":[]})
    chain  = index.get("chain",[])
    if domain_filter:
        chain = [b for b in chain if b.get("domain","").lower()==domain_filter.lower()]
    return jsonify({"total":len(chain),"entries":chain})

# ── GET /verify/<block_id> ─────────────────────────────────────────────────────
@app.route("/verify/<block_id>", methods=["GET","OPTIONS"])
def verify_block(block_id):
    if request.method == "OPTIONS": return "", 200
    block_data = None
    try:
        for month_dir in BLOCKS_DIR.iterdir():
            bf = month_dir / f"{block_id.upper()}.json"
            if bf.exists():
                block_data = _read_json(bf); break
    except Exception:
        pass
    if not block_data:
        return jsonify({"error":"Block not found"}), 404

    payload = {k: block_data.get(k) for k in [
        "block_id","url","domain","timestamp","prev_hash","overall_risk",
        "risk_score","clauses_count","hidden_risks","doc_length",
        "raw_text_hash","clause_hashes"
    ]}
    sha   = hashlib.sha256(json.dumps(payload, sort_keys=True).encode()).hexdigest()
    valid = sha == block_data.get("sha256_hash","")
    return jsonify({
        "block_id":        block_id.upper(),
        "valid":           valid,
        "sha256_hash":     block_data.get("sha256_hash",""),
        "raw_text_stored": bool(block_data.get("raw_text","")),
        "raw_text_kb":     round(len(block_data.get("raw_text",""))/1024,1),
    })

# ── GET /health ────────────────────────────────────────────────────────────────
@app.route("/health", methods=["GET"])
def health():
    index = _read_json(INDEX_FILE, {"total_blocks":0})
    return jsonify({
        "status":         "ok",
        "version":        "7.1",
        "model":          "groq/llama3-8b-8192",
        "groq_configured": bool(GROQ_API_KEY),
        "total_blocks":   index.get("total_blocks",0),
    })

if __name__ == "__main__":
    port = int(os.environ.get("PORT", 5000))
    print(f"🚀 Trinetra.net v7.1 — port {port}")
    print(f"🤖 Groq: {'✅ configured' if GROQ_API_KEY else '❌ GROQ_API_KEY not set'}")
    app.run(host="0.0.0.0", port=port, debug=False)
