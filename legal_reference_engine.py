"""
legal_reference_engine.py — Trinetra.net Domain-Specific Legal Reference Engine
=================================================================================
Maps T&C clauses to real-world regulatory frameworks:
  - RBI Guidelines (India)
  - GDPR (Europe)
  - IT Act 2000 / DPDP Act 2023 (India)
  - Consumer Protection Act 2019 (India)
  - SEBI Regulations
  - TRAI Regulations
  - PCI-DSS (Payment Security)
  - Copyright Act / IP Laws

Each clause gets:
  1. Domain detection (Finance, Privacy, IP, etc.)
  2. Relevant regulation match
  3. Legality verdict (Legal / Questionable / Illegal)
  4. Official citation
  5. Plain English explanation
  6. Developer note (what to implement to comply)
"""

import re
from dataclasses import dataclass, field
from typing import Optional


# ─── Data Structures ──────────────────────────────────────────────────────────

@dataclass
class RegulatoryReference:
    regulation:     str          # e.g. "RBI Master Direction 2021"
    section:        str          # e.g. "Section 4(2)(b)"
    jurisdiction:   str          # e.g. "India", "EU", "Global"
    authority:      str          # e.g. "Reserve Bank of India"
    url:            str          # Official source URL
    summary:        str          # What the regulation says
    clause_verdict: str          # "LEGAL", "QUESTIONABLE", "ILLEGAL", "REQUIRES_DISCLOSURE"
    verdict_reason: str          # Why this verdict
    plain_english:  str          # Simple language for users
    developer_note: str          # What developers must implement


@dataclass
class ClauseLegalAnalysis:
    clause_text:    str
    domain:         str                         # PRIMARY domain
    all_domains:    list = field(default_factory=list)
    references:     list = field(default_factory=list)  # list of RegulatoryReference
    overall_verdict:str = "LEGAL"
    risk_level:     str = "LOW"
    summary_simple: str = ""                    # 15-year-old explanation
    summary_pro:    str = ""                    # Professional/developer explanation


# ─── Regulatory Knowledge Base ────────────────────────────────────────────────

REGULATORY_DB = {

    # ── AUTO-RENEWAL ──────────────────────────────────────────────────────────
    "auto-renewal": [
        RegulatoryReference(
            regulation    = "RBI Circular on Recurring Payments (e-Mandates)",
            section       = "RBI/2021-22/189 DPSS.CO.PD No.S-516/02.14.003/2021-22",
            jurisdiction  = "India",
            authority     = "Reserve Bank of India (RBI)",
            url           = "https://www.rbi.org.in/Scripts/NotificationUser.aspx?Id=12051",
            summary       = "RBI mandates that for recurring payments above ₹15,000, banks MUST send a pre-debit notification to the customer at least 24 hours before the charge. Auto-renewal without this notification is a direct violation.",
            clause_verdict= "REQUIRES_DISCLOSURE",
            verdict_reason= "Auto-renewal clauses are permitted BUT require mandatory pre-debit notification under RBI e-Mandate framework. Silent auto-renewal above ₹15,000 is non-compliant.",
            plain_english = "By law, the company MUST send you a message at least 24 hours before charging your card for renewal. If they don't — that's illegal under RBI rules. You can file a complaint.",
            developer_note= "Implement pre-debit notification system via SMS/email 24hrs before charge. For amounts >₹15,000 require re-authentication (OTP/biometric). Register e-Mandate with acquiring bank."
        ),
        RegulatoryReference(
            regulation    = "Consumer Protection Act 2019",
            section       = "Section 2(47) — Unfair Trade Practice",
            jurisdiction  = "India",
            authority     = "Central Consumer Protection Authority (CCPA)",
            url           = "https://consumeraffairs.nic.in/acts-and-rules/consumer-protection-act-2019",
            summary       = "Auto-renewal without clear, prominent disclosure and easy cancellation mechanism constitutes an 'Unfair Trade Practice' under CPA 2019. Companies must provide a simple, accessible cancellation option.",
            clause_verdict= "QUESTIONABLE",
            verdict_reason= "Legal only if cancellation is as easy as subscription, with clear prior notice. Dark patterns that make cancellation difficult are explicitly prohibited.",
            plain_english = "The company must make it just as easy to CANCEL as it was to SIGN UP. If they hide the cancel button or make it complicated, that's illegal under Indian consumer law.",
            developer_note= "Implement one-click cancellation accessible from the same location as subscription. Never use dark patterns. Send cancellation confirmation immediately."
        )
    ],

    # ── PRIVACY / DATA COLLECTION ─────────────────────────────────────────────
    "privacy breach": [
        RegulatoryReference(
            regulation    = "Digital Personal Data Protection Act 2023 (DPDP Act)",
            section       = "Section 6 — Consent, Section 9 — Processing of Children's Data",
            jurisdiction  = "India",
            authority     = "Data Protection Board of India",
            url           = "https://www.meity.gov.in/writereaddata/files/Digital%20Personal%20Data%20Protection%20Act%202023.pdf",
            summary       = "DPDP Act 2023 mandates explicit, informed, free, specific, and revocable consent before collecting personal data. Companies must state EXACTLY what data is collected, why, and for how long. Vague consent is invalid.",
            clause_verdict= "REQUIRES_DISCLOSURE",
            verdict_reason= "Data sharing with 'third parties' or 'partners' without naming them and specifying purpose violates DPDP Act 2023 Section 6(1). Blanket consent clauses are not legally valid.",
            plain_english = "Under India's new data protection law, the company can't just say 'we may share your data.' They must tell you EXACTLY who gets it and WHY. Vague clauses like this may not be legally enforceable.",
            developer_note= "Implement granular consent management. List all third-party data recipients by name. Provide data deletion requests within 72 hours. Appoint a Data Protection Officer (DPO)."
        ),
        RegulatoryReference(
            regulation    = "Information Technology Act 2000 — Section 43A & Rules",
            section       = "IT (Reasonable Security Practices) Rules 2011, Rule 4",
            jurisdiction  = "India",
            authority     = "Ministry of Electronics & Information Technology (MeitY)",
            url           = "https://www.meity.gov.in/content/information-technology-act-2000",
            summary       = "Section 43A holds companies liable for compensation if they fail to protect sensitive personal data (passwords, financial data, health info, biometrics) due to negligent security practices.",
            clause_verdict= "LEGAL",
            verdict_reason= "Disclosure of data collection is required. However, clauses that try to waive company liability for data breaches are unenforceable under IT Act 43A — companies remain liable regardless.",
            plain_english = "Even if the T&C says 'we are not responsible for data breaches' — that clause is NOT legally valid in India. The company is still liable to pay you compensation under the IT Act.",
            developer_note= "Implement ISO 27001 security practices. Maintain ISMS. Clauses waiving breach liability are not valid — ensure security infrastructure is breach-resilient."
        ),
        RegulatoryReference(
            regulation    = "GDPR — General Data Protection Regulation",
            section       = "Article 6 (Lawful Basis), Article 13 (Transparency), Article 17 (Right to Erasure)",
            jurisdiction  = "European Union",
            authority     = "European Data Protection Board (EDPB)",
            url           = "https://gdpr-info.eu/",
            summary       = "GDPR requires a clear lawful basis for processing, transparent disclosure of data use, and the right to erasure ('right to be forgotten'). Fines up to €20 million or 4% global turnover.",
            clause_verdict= "REQUIRES_DISCLOSURE",
            verdict_reason= "Any clause claiming broad data usage rights without specific lawful basis violates GDPR Article 6. Consent must be specific, not bundled with T&C acceptance.",
            plain_english = "In Europe, you have the right to ask any company to DELETE all your data, and they must comply. You also have the right to know exactly what data they hold about you.",
            developer_note= "Implement separate consent for data processing (not bundled with T&C). Build data export and deletion APIs. Respond to DSAR requests within 30 days."
        )
    ],

    # ── TERMINATION ───────────────────────────────────────────────────────────
    "termination clause": [
        RegulatoryReference(
            regulation    = "Consumer Protection Act 2019",
            section       = "Section 2(46) — Unfair Contract Terms",
            jurisdiction  = "India",
            authority     = "Central Consumer Protection Authority (CCPA)",
            url           = "https://consumeraffairs.nic.in/acts-and-rules/consumer-protection-act-2019",
            summary       = "Clauses allowing companies to terminate services 'at any time, for any reason, without notice' in a paid subscription context may qualify as an 'unfair contract term' under CPA 2019. Consumers are entitled to reasonable notice.",
            clause_verdict= "QUESTIONABLE",
            verdict_reason= "Termination without notice in a paid subscription violates the principle of fair dealing under CPA 2019. Free services have more leeway; paid services must provide notice period and pro-rata refund.",
            plain_english = "If you're paying for the service, the company can't just shut down your account without warning. Indian consumer law says you're entitled to notice and possibly a partial refund for unused time.",
            developer_note= "For paid services: provide minimum 30-day notice before termination, offer pro-rata refund for unused period. For free services: 7-day notice is best practice. Document termination reasons."
        ),
        RegulatoryReference(
            regulation    = "RBI Guidelines on Payment Aggregators",
            section       = "RBI/2020-21/72 DPSS.CO.PD No.1810/02.14.008/2020-21",
            jurisdiction  = "India",
            authority     = "Reserve Bank of India (RBI)",
            url           = "https://www.rbi.org.in/Scripts/NotificationUser.aspx?Id=11822",
            summary       = "For fintech/payment services, RBI requires minimum 30-day notice before service termination and mandatory refund of outstanding wallet balances. Immediate termination without refund is prohibited.",
            clause_verdict= "ILLEGAL",
            verdict_reason= "Termination clauses in payment/fintech apps that allow immediate closure without refunding outstanding balance directly violate RBI PA/PG Guidelines.",
            plain_english = "For any app that holds your money (wallets, payments), they CANNOT close your account and keep your balance. RBI rules say they must return your money and give 30 days notice.",
            developer_note= "Implement escrow mechanism for wallet balances. Termination workflow must: (1) notify 30 days prior, (2) freeze new transactions, (3) process all pending transactions, (4) refund balance within 5 business days."
        )
    ],

    # ── INTELLECTUAL PROPERTY / THEFT ─────────────────────────────────────────
    "theft": [
        RegulatoryReference(
            regulation    = "Copyright Act 1957 (India)",
            section       = "Section 17 — First Owner of Copyright, Section 57 — Moral Rights",
            jurisdiction  = "India",
            authority     = "Copyright Office, Ministry of Commerce",
            url           = "https://copyright.gov.in/documents/copyrightrules1957.pdf",
            summary       = "Under the Copyright Act 1957, the creator (user) is the first owner of any original content they create. A T&C clause claiming ownership of user-generated content must be a clearly stated, specific license — not a blanket ownership transfer. Moral rights (Section 57) cannot be contractually waived.",
            clause_verdict= "QUESTIONABLE",
            verdict_reason= "Broad IP ownership clauses that transfer all rights to the platform may not be enforceable in India to the extent they attempt to override Section 57 moral rights, which are inalienable.",
            plain_english = "When you post a photo or write something on a platform, YOU still own it under Indian copyright law. The company can only use it in ways you specifically agreed to. They can't claim they own everything you create.",
            developer_note= "Replace broad ownership clauses with specific, limited licenses: 'You grant us a non-exclusive, royalty-free license to display/distribute content solely for platform operation.' Never claim full ownership of UGC."
        ),
        RegulatoryReference(
            regulation    = "Indian Contract Act 1872",
            section       = "Section 23 — Unlawful Consideration, Section 16 — Undue Influence",
            jurisdiction  = "India",
            authority     = "Ministry of Law and Justice",
            url           = "https://legislative.gov.in/sites/default/files/A1872-09.pdf",
            summary       = "Contracts where consideration is 'opposed to public policy' or obtained through undue influence (take-it-or-leave-it mandatory T&C) may be void or voidable. Courts have struck down clauses that are grossly one-sided.",
            clause_verdict= "QUESTIONABLE",
            verdict_reason= "Clauses transferring all user IP rights as a condition of service access (with no negotiation) may be challenged as contracts of adhesion — courts may refuse to enforce them.",
            plain_english = "Contracts that are completely one-sided can sometimes be challenged in court. If a company forces you to give away all your rights just to use a free app, a court might not enforce that.",
            developer_note= "Ensure T&C terms are proportionate to the service offered. Avoid 'all-or-nothing' IP assignment. Consider opt-in consent for specific content uses beyond core service delivery."
        )
    ],

    # ── FINANCIAL / REFUND ────────────────────────────────────────────────────
    "refund clause": [
        RegulatoryReference(
            regulation    = "Consumer Protection Act 2019",
            section       = "Section 2(9) — Consumer Rights, Section 47 — Mediation",
            jurisdiction  = "India",
            authority     = "National Consumer Disputes Redressal Commission (NCDRC)",
            url           = "https://ncdrc.nic.in/",
            summary       = "Consumers have a statutory right to seek redressal for defective services. No-refund policies for services that are defective or not delivered as described are unenforceable. Consumers can approach consumer courts regardless of T&C no-refund clauses.",
            clause_verdict= "LEGAL",
            verdict_reason= "Refund clauses are legal and enforceable as long as they don't completely waive statutory consumer rights. A 'no refund under any circumstance' clause for defective services is unenforceable.",
            plain_english = "Even if the T&C says 'no refunds,' if the service was broken or not delivered as promised, you can STILL file a complaint at the consumer court and win a refund. The T&C can't take away your basic legal rights.",
            developer_note= "Implement a clear refund policy with defined timelines. For digital goods: offer 7-day refund window. For subscription services: pro-rata refund on cancellation. Never state 'absolutely no refunds' for defective service."
        ),
        RegulatoryReference(
            regulation    = "RBI Guidelines on Prepaid Payment Instruments",
            section       = "RBI/2021-22/161 DPSS.CO.PD No.S-479",
            jurisdiction  = "India",
            authority     = "Reserve Bank of India (RBI)",
            url           = "https://www.rbi.org.in/Scripts/BS_PressReleaseDisplay.aspx?prid=53167",
            summary       = "For digital wallets and prepaid instruments, RBI mandates full refund of wallet balance on closure, with interest for delays beyond 5 business days.",
            clause_verdict= "LEGAL",
            verdict_reason= "Refund clauses for prepaid instruments must align with RBI PPI Master Directions. Any clause limiting refund of prepaid balance is non-compliant.",
            plain_english = "If you have money in a digital wallet or prepaid account, you ALWAYS get it back when you close the account — this is guaranteed by RBI rules, no matter what the T&C says.",
            developer_note= "Implement automated refund processing within 5 business days of account closure request. Integrate with payment gateway for direct refund to source."
        )
    ],

    # ── ARBITRATION / DISPUTE ─────────────────────────────────────────────────
    "arbitration": [
        RegulatoryReference(
            regulation    = "Arbitration and Conciliation Act 1996 (Amended 2021)",
            section       = "Section 7 — Arbitration Agreement, Section 12 — Independence of Arbitrator",
            jurisdiction  = "India",
            authority     = "Ministry of Law and Justice",
            url           = "https://legislative.gov.in/sites/default/files/A1996-26_1.pdf",
            summary       = "Mandatory arbitration clauses are legally valid in India. However, the arbitrator must be independent and impartial. Clauses where the company itself appoints the arbitrator (or pays the arbitrator directly) may be challenged for bias under Section 12(5).",
            clause_verdict= "QUESTIONABLE",
            verdict_reason= "One-sided arbitration clauses where the company controls arbitrator selection violate the independence requirement. Consumers retain the right to approach consumer forums regardless of arbitration clauses (CPA 2019).",
            plain_english = "Even if the T&C says you must use private arbitration, you CAN still go to a consumer court for most everyday disputes. The arbitration clause doesn't take away this right under Indian law.",
            developer_note= "Use independent arbitration institutions (DIAC, MCIA). Do not name company-appointed arbitrators. Include consumer forum carve-out: 'Nothing herein limits consumer rights under CPA 2019.'"
        )
    ],

    # ── GENERAL RISKY ─────────────────────────────────────────────────────────
    "risky": [
        RegulatoryReference(
            regulation    = "Indian Contract Act 1872 + Consumer Protection Act 2019",
            section       = "ICA Section 23 (Unlawful), CPA Section 2(46) (Unfair Contract)",
            jurisdiction  = "India",
            authority     = "Ministry of Law and Justice / CCPA",
            url           = "https://consumeraffairs.nic.in/acts-and-rules/consumer-protection-act-2019",
            summary       = "Contracts with terms that are unconscionable, grossly one-sided, or against public policy may be declared void by Indian courts. The Consumer Protection Act specifically lists 'unfair contracts' as actionable.",
            clause_verdict= "QUESTIONABLE",
            verdict_reason= "Broadly risky clauses that give companies unlimited unilateral power (to change terms, limit liability to zero, or override consumer rights) are subject to challenge under Indian contract and consumer law.",
            plain_english = "Some of these clauses sound scary but may not actually be enforceable in an Indian court. Courts can strike down terms that are completely unfair or one-sided — you still have legal protections.",
            developer_note= "Review all unilateral power clauses. Replace 'sole discretion' with defined criteria. Cap liability at minimum 3 months subscription value. Always include grievance redressal mechanism (mandatory under CPA 2019)."
        )
    ],

    # ── NEUTRAL ───────────────────────────────────────────────────────────────
    "neutral": [
        RegulatoryReference(
            regulation    = "Indian Contract Act 1872",
            section       = "Section 10 — Valid Contract Requirements",
            jurisdiction  = "India",
            authority     = "Ministry of Law and Justice",
            url           = "https://legislative.gov.in/sites/default/files/A1872-09.pdf",
            summary       = "Standard contract clauses defining the relationship between parties are legally valid as long as they meet basic contract requirements: free consent, lawful object, competent parties, and lawful consideration.",
            clause_verdict= "LEGAL",
            verdict_reason= "This clause appears to be standard legal boilerplate that does not raise significant consumer protection concerns under current Indian law.",
            plain_english = "This is standard legal language that courts see all the time. It's not particularly unfair — just routine contract terms defining how the agreement works.",
            developer_note= "Standard clause — ensure language is clear and unambiguous. Use plain language where possible (Plain Language in Law movement recommended by Law Commission of India)."
        )
    ]
}

# ─── Domain Detector ─────────────────────────────────────────────────────────

DOMAIN_KEYWORDS = {
    "Finance & Payments":  ["payment", "charge", "fee", "bank", "wallet", "debit", "credit", "refund", "subscription", "billing", "price", "currency", "transaction", "upi", "neft", "rtgs"],
    "Data & Privacy":      ["data", "personal", "information", "privacy", "collect", "process", "share", "third party", "cookie", "tracking", "profile", "location", "device"],
    "Intellectual Property": ["copyright", "trademark", "patent", "intellectual property", "license", "own", "content", "user generated", "publish", "distribute", "reproduce"],
    "Account & Access":    ["account", "terminate", "suspend", "cancel", "access", "login", "password", "credential", "deactivate", "ban"],
    "Legal & Dispute":     ["arbitration", "dispute", "jurisdiction", "court", "law", "legal", "govern", "indemnify", "liability", "waive", "claim", "sue"],
    "Security":            ["security", "breach", "hack", "unauthorized", "protect", "encrypt", "ssl", "tls", "safe"],
    "Consumer Rights":     ["consumer", "buyer", "customer", "purchase", "product", "service", "warranty", "guarantee", "return"],
    "Communications":      ["email", "sms", "notification", "marketing", "promotional", "contact", "communicate", "message"]
}

def detect_domains(clause_text: str) -> list:
    text   = clause_text.lower()
    found  = []
    for domain, keywords in DOMAIN_KEYWORDS.items():
        if any(kw in text for kw in keywords):
            found.append(domain)
    return found if found else ["General"]

# ─── Main Analysis Function ───────────────────────────────────────────────────

def analyze_clause_legally(clause_text: str, ml_label: str) -> ClauseLegalAnalysis:
    """
    Full legal analysis of a clause:
    1. Detect domain
    2. Find regulatory references
    3. Generate simple + professional summaries
    4. Return structured ClauseLegalAnalysis
    """
    domains     = detect_domains(clause_text)
    primary_dom = domains[0] if domains else "General"

    # Get references for this ML label
    references = REGULATORY_DB.get(ml_label, REGULATORY_DB.get("neutral", []))

    # Determine overall verdict (worst case across references)
    verdict_priority = {"ILLEGAL": 4, "QUESTIONABLE": 3, "REQUIRES_DISCLOSURE": 2, "LEGAL": 1}
    overall_verdict  = max(references, key=lambda r: verdict_priority.get(r.clause_verdict, 0)).clause_verdict if references else "LEGAL"

    risk_level = {
        "ILLEGAL":              "CRITICAL",
        "QUESTIONABLE":         "HIGH",
        "REQUIRES_DISCLOSURE":  "MEDIUM",
        "LEGAL":                "LOW"
    }.get(overall_verdict, "LOW")

    # Build simple summary (for any user)
    simple_parts = []
    for ref in references[:2]:
        simple_parts.append(f"• {ref.plain_english}")
    summary_simple = "\n".join(simple_parts) if simple_parts else "This clause appears standard under applicable law."

    # Build professional summary (for developers/legal teams)
    pro_parts = []
    for ref in references[:2]:
        pro_parts.append(
            f"[{ref.authority}] {ref.regulation} — {ref.section}: "
            f"{ref.verdict_reason} | Action: {ref.developer_note}"
        )
    summary_pro = " || ".join(pro_parts) if pro_parts else "No specific regulatory concern identified."

    return ClauseLegalAnalysis(
        clause_text     = clause_text,
        domain          = primary_dom,
        all_domains     = domains,
        references      = references,
        overall_verdict = overall_verdict,
        risk_level      = risk_level,
        summary_simple  = summary_simple,
        summary_pro     = summary_pro
    )

def analyze_clause_legally_dict(clause_text: str, ml_label: str) -> dict:
    """Returns dict version for JSON serialization in Flask."""
    result = analyze_clause_legally(clause_text, ml_label)
    return {
        "domain":          result.domain,
        "all_domains":     result.all_domains,
        "overall_verdict": result.overall_verdict,
        "risk_level":      result.risk_level,
        "summary_simple":  result.summary_simple,
        "summary_pro":     result.summary_pro,
        "references": [
            {
                "regulation":     r.regulation,
                "section":        r.section,
                "jurisdiction":   r.jurisdiction,
                "authority":      r.authority,
                "url":            r.url,
                "summary":        r.summary,
                "verdict":        r.clause_verdict,
                "verdict_reason": r.verdict_reason,
                "plain_english":  r.plain_english,
                "developer_note": r.developer_note
            }
            for r in result.references
        ]
    }
