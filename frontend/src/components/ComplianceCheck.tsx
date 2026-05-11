/**
 * ComplianceCheck — standalone compliance check UI.
 *
 * Paste text + pick locale → get a compliance decision.
 * No translation. No rewrite. No publisher/market-intelligence mixing.
 *
 * Reuses the existing backend endpoint POST /api/compliance/check.
 */

import { useState } from "react";
import * as compliance from "../api/compliance";

const LOCALES: Array<{ code: string; label: string }> = [
  { code: "it-IT", label: "Italian (Italy)" },
  { code: "fr-FR", label: "French (France)" },
  { code: "nl-NL", label: "Dutch (Netherlands)" },
  { code: "nl-BE", label: "Dutch (Belgium)" },
  { code: "fr-BE", label: "French (Belgium)" },
  { code: "es-ES", label: "Spanish (Spain)" },
  { code: "en-GB", label: "English (UK)" },
];

export default function ComplianceCheck() {
  const [text, setText] = useState("");
  const [locale, setLocale] = useState("en-GB");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<any | null>(null);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!text.trim()) return;
    setLoading(true);
    setError(null);
    setResult(null);
    try {
      const r = await compliance.runComplianceCheck({ text, locale });
      setResult(r);
    } catch (err: any) {
      const raw = err?.response?.data?.error;
      setError(
        typeof raw === "string"
          ? raw
          : Array.isArray(raw)
            ? raw.map((e: any) => e.message ?? JSON.stringify(e)).join("; ")
            : err?.message ?? "Compliance check failed."
      );
    } finally {
      setLoading(false);
    }
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "1.25rem" }}>
      {/* Form */}
      <form onSubmit={submit} style={{ display: "contents" }}>
        <div className="card">
          <div className="card-header">
            <span className="card-title">Check</span>
          </div>
          <div className="card-body" style={{ display: "flex", flexDirection: "column", gap: "1rem" }}>
            <div className="field">
              <label className="field-label">Target locale / country</label>
              <select className="select" value={locale} onChange={e => setLocale(e.target.value)}>
                {LOCALES.map(l => <option key={l.code} value={l.code}>{l.label}</option>)}
              </select>
            </div>
            <div className="field">
              <label className="field-label">Source text</label>
              <textarea
                className="textarea"
                style={{ height: "10rem" }}
                value={text}
                onChange={e => setText(e.target.value)}
                placeholder="Paste marketing copy to check against the target locale's compliance bundle…"
                required
                maxLength={10000}
              />
              <span className="field-hint">{text.length}/10000 characters — no translation is performed.</span>
            </div>
          </div>
        </div>

        {error && <div className="alert alert-error">{error}</div>}

        <div>
          <button type="submit" className="btn btn-primary" disabled={loading || !text.trim()}>
            {loading ? "Checking…" : "Run compliance check"}
          </button>
        </div>
      </form>

      {/* Result */}
      {result && <ResultCard result={result} />}
    </div>
  );
}

function ResultCard({ result }: { result: any }) {
  const status = result.status as "approved" | "review_required" | "rejected";
  const statusColor =
    status === "approved" ? "badge-green" :
    status === "rejected" ? "badge-red" : "badge-amber";

  const riskColor =
    result.riskLevel === "critical" || result.riskLevel === "high" ? "badge-red" :
    result.riskLevel === "medium" ? "badge-amber" : "badge-gray";

  const actionColor =
    result.recommendedAction === "publish_as_is" ? "badge-green" :
    result.recommendedAction === "do_not_publish" ? "badge-red" : "badge-amber";

  return (
    <div className="card">
      <div className="card-header">
        <div style={{ display: "flex", alignItems: "center", gap: "0.5rem", flexWrap: "wrap" }}>
          <span className="card-title">Result</span>
          <span className={`badge ${statusColor}`} style={{ fontWeight: 700 }}>
            {status.replace("_", " ").toUpperCase()}
          </span>
          <span className={`badge ${riskColor}`}>Risk: {result.riskLevel}</span>
          <span className={`badge ${actionColor}`}>{result.recommendedAction.replace(/_/g, " ")}</span>
          {result.needsHumanReview && <span className="badge badge-amber">Human review</span>}
          {typeof result.confidence === "number" && (
            <span className="badge badge-gray">Confidence {Math.round(result.confidence)}%</span>
          )}
        </div>
      </div>

      <div className="card-body" style={{ display: "flex", flexDirection: "column", gap: "1rem", fontSize: "0.8125rem" }}>
        {/* Summary */}
        <div>
          <div style={{ fontWeight: 600, color: "var(--text-3)", fontSize: "0.75rem", marginBottom: "0.25rem" }}>SUMMARY</div>
          <div>{result.summary}</div>
        </div>

        {/* Meta row */}
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))", gap: "0.75rem" }}>
          <Meta label="Locale" value={`${result.locale}${result.country ? ` — ${result.country}` : ""}`} />
          <Meta label="Bundle" value={result.bundleVersion ?? "(legacy fallback)"} />
          <Meta label="Regulators" value={(result.regulatorsApplied ?? []).join(", ") || "—"} />
        </div>

        {/* Issues list */}
        {Array.isArray(result.issues) && result.issues.length > 0 && (
          <div>
            <div style={{ fontWeight: 600, color: "var(--text-3)", fontSize: "0.75rem", marginBottom: "0.25rem" }}>
              ISSUES ({result.issues.length})
            </div>
            <ul style={{ marginLeft: "1.25rem" }}>
              {result.issues.map((i: string, idx: number) => <li key={idx}>{i}</li>)}
            </ul>
          </div>
        )}

        {/* Matched rules — human-readable */}
        {Array.isArray(result.matchedRules) && result.matchedRules.length > 0 && (
          <div>
            <div style={{ fontWeight: 600, color: "var(--text-3)", fontSize: "0.75rem", marginBottom: "0.25rem" }}>
              FINDINGS ({result.matchedRules.length})
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: "0.625rem" }}>
              {result.matchedRules.map((r: any, i: number) => (
                <FindingCard key={i} rule={r} />
              ))}
            </div>
          </div>
        )}

        {/* Source refs */}
        {Array.isArray(result.sourceRefs) && result.sourceRefs.length > 0 && (
          <div>
            <div style={{ fontWeight: 600, color: "var(--text-3)", fontSize: "0.75rem", marginBottom: "0.25rem" }}>
              SOURCE REFERENCES
            </div>
            <div style={{ display: "flex", flexWrap: "wrap", gap: "0.375rem" }}>
              {result.sourceRefs.map((r: any, i: number) => (
                <span key={i} className="badge badge-blue">
                  {r.sourceCode}{r.documentRef ? ` / ${r.documentRef}` : ""}
                </span>
              ))}
            </div>
          </div>
        )}

        {/* Provenance */}
        <div style={{ color: "var(--text-3)", fontSize: "0.6875rem", paddingTop: "0.375rem", borderTop: "1px solid var(--border)" }}>
          Checked at {new Date(result.checkedAt).toLocaleString()} —
          {result.bundleVersion
            ? ` decision from published bundle ${result.bundleVersion}.`
            : " decision from legacy fallback rules (no published bundle for this locale)."}
        </div>
      </div>
    </div>
  );
}

// ─── Human-readable rule display ────────────────────────────────────

const TYPE_LABELS: Record<string, { label: string; description: string }> = {
  banned_phrase:        { label: "Prohibited phrase",          description: "A specific phrase that is not allowed under the applicable regulations was found in the text." },
  regex:                { label: "Pattern match",              description: "A pattern of words matching a known regulatory violation was detected." },
  required_disclaimer:  { label: "Missing required disclosure", description: "The text mentions a topic (e.g. returns, performance) that requires an accompanying risk disclosure, but the disclosure was not found." },
  llm_semantic:         { label: "Content review",             description: "An automated review of the overall content flagged a potential concern. This is an interpretation, not a hard rule match." },
  llm_independent:      { label: "Strict review",              description: "A separate, conservative automated review flagged a potential concern. This reviewer is intentionally cautious and may flag text that is actually compliant." },
};

const SEVERITY_LABELS: Record<string, { label: string; color: string; description: string }> = {
  critical: { label: "Critical", color: "badge-red",   description: "Clear regulatory violation — must be fixed before publishing." },
  major:    { label: "Major",    color: "badge-amber",  description: "Significant concern — should be reviewed by a qualified person." },
  minor:    { label: "Low",      color: "badge-gray",   description: "Minor observation — likely acceptable but flagged for awareness." },
};

function expandMessage(type: string, message: string): string {
  // If the message is a bare category label (e.g. "guarantees"), expand it
  const EXPANSIONS: Record<string, string> = {
    guarantees:        "The text may contain language that could be interpreted as implying guaranteed outcomes or capital safety.",
    urgency:           "The text may create a sense of urgency or scarcity that could pressure the reader.",
    authority:         "The text may make unsupported claims of authority, superiority, or market leadership.",
    promotional:       "The text may use overly promotional language that does not meet the standard of fair, clear and not misleading.",
    suitability:       "The text may imply the product is suitable for all investors without qualification.",
    "risk balance":    "The text mentions benefits or returns without proportionate risk disclosure.",
  };
  const lower = message.toLowerCase().trim();
  return EXPANSIONS[lower] ?? message;
}

function FindingCard({ rule }: { rule: any }) {
  const typeInfo = TYPE_LABELS[rule.type] ?? { label: rule.type, description: "" };
  const sevInfo = SEVERITY_LABELS[rule.severity] ?? SEVERITY_LABELS.minor;
  const isHardRule = ["banned_phrase", "regex", "required_disclaimer"].includes(rule.type);
  const hasEvidence = rule.evidence && rule.evidence !== "—" && rule.evidence !== "";
  const expandedMessage = expandMessage(rule.type, rule.message);

  return (
    <div style={{
      padding: "0.75rem",
      background: "var(--bg)",
      borderRadius: "var(--radius-sm)",
      borderLeft: `3px solid ${rule.severity === "critical" ? "var(--red)" : rule.severity === "major" ? "var(--amber)" : "var(--border-md)"}`,
    }}>
      {/* Header row */}
      <div style={{ display: "flex", alignItems: "center", gap: "0.5rem", marginBottom: "0.375rem", flexWrap: "wrap" }}>
        <span style={{ fontWeight: 600, fontSize: "0.8125rem" }}>{typeInfo.label}</span>
        <span className={`badge ${sevInfo.color}`}>{sevInfo.label}</span>
        {rule.sourceCode && <span className="badge badge-blue" style={{ fontSize: "0.6875rem" }}>{rule.sourceCode}</span>}
        {isHardRule && <span style={{ fontSize: "0.6875rem", color: "var(--text-3)" }}>Hard rule</span>}
        {!isHardRule && <span style={{ fontSize: "0.6875rem", color: "var(--text-3)" }}>Automated review</span>}
      </div>

      {/* Explanation */}
      <div style={{ fontSize: "0.8125rem", color: "var(--text-2)", marginBottom: hasEvidence ? "0.375rem" : 0 }}>
        {expandedMessage}
      </div>

      {/* Evidence or "no specific match" */}
      {hasEvidence ? (
        <div style={{ fontSize: "0.75rem", marginTop: "0.25rem" }}>
          <span style={{ color: "var(--text-3)" }}>Found in text: </span>
          <code style={{ background: "var(--red-bg)", padding: "0.125rem 0.375rem", borderRadius: "3px", fontSize: "0.75rem" }}>
            {rule.evidence}
          </code>
        </div>
      ) : (
        <div style={{ fontSize: "0.75rem", color: "var(--text-4)", marginTop: "0.25rem", fontStyle: "italic" }}>
          No specific phrase matched — this finding is based on an overall assessment of the text.
        </div>
      )}

      {/* Type explanation on hover / expandable */}
      {typeInfo.description && (
        <div style={{ fontSize: "0.6875rem", color: "var(--text-4)", marginTop: "0.375rem" }}>
          {typeInfo.description}
        </div>
      )}
    </div>
  );
}

function Meta({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div style={{ fontWeight: 600, color: "var(--text-3)", fontSize: "0.6875rem" }}>{label.toUpperCase()}</div>
      <div style={{ fontSize: "0.8125rem" }}>{value}</div>
    </div>
  );
}

function Th({ children }: { children: React.ReactNode }) {
  return <th style={{ padding: "0.375rem 0.5rem", fontWeight: 600, fontSize: "0.6875rem", color: "var(--text-3)" }}>{children}</th>;
}

function Td({ children }: { children: React.ReactNode }) {
  return <td style={{ padding: "0.375rem 0.5rem", verticalAlign: "top" }}>{children}</td>;
}
