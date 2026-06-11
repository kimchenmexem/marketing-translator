/**
 * ComplianceFeedbackPanel — feedback on a compliance ASSESSMENT.
 *
 * Deliberately separate from ReviewPanel (which is for translation quality:
 * tone / terminology / corrected translation). Compliance feedback asks a
 * different question — was the assessment itself right? — with verdicts that
 * matter for tuning the rules: was it a false positive (over-flagged), or did
 * it miss a real violation?
 *
 * Posts to POST /api/compliance/check/:outputId/feedback.
 */

import { useState } from "react";
import { submitComplianceFeedback, type ComplianceVerdict } from "../api/compliance";

const VERDICTS: Array<{ value: ComplianceVerdict; label: string; hint: string }> = [
  { value: "correct", label: "✓ Correct", hint: "The assessment was right." },
  { value: "false_positive", label: "⚠ Over-flagged", hint: "Flagged something that is actually compliant (false positive)." },
  { value: "missed_violation", label: "✗ Missed a violation", hint: "A real compliance issue was not caught." },
];

export default function ComplianceFeedbackPanel({ outputId }: { outputId: number }) {
  const [verdict, setVerdict] = useState<ComplianceVerdict | null>(null);
  const [note, setNote] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [errMsg, setErrMsg] = useState<string | null>(null);

  if (submitted) {
    return (
      <div style={{ paddingTop: "0.625rem", borderTop: "1px solid var(--border)", fontSize: "0.8125rem", color: "var(--green, #2a8a3e)" }}>
        Thanks — compliance feedback recorded.
      </div>
    );
  }

  const handleSubmit = async () => {
    if (!verdict) return;
    setSubmitting(true);
    setErrMsg(null);
    try {
      await submitComplianceFeedback(outputId, { verdict, note: note.trim() || undefined });
      setSubmitted(true);
    } catch (e: any) {
      const m = e?.response?.data?.error;
      setErrMsg(typeof m === "string" ? m : "Failed to submit feedback.");
    } finally {
      setSubmitting(false);
    }
  };

  const selectedHint = VERDICTS.find((v) => v.value === verdict)?.hint;

  return (
    <div style={{ paddingTop: "0.625rem", borderTop: "1px solid var(--border)", display: "flex", flexDirection: "column", gap: "0.5rem" }}>
      <span style={{ fontWeight: 600, color: "var(--text-3)", fontSize: "0.75rem" }}>
        WAS THIS COMPLIANCE ASSESSMENT CORRECT?
      </span>
      <div style={{ display: "flex", gap: "0.5rem", flexWrap: "wrap" }}>
        {VERDICTS.map((v) => (
          <button
            key={v.value}
            type="button"
            className={`btn btn-sm ${verdict === v.value ? "btn-primary" : "btn-secondary"}`}
            style={{ fontSize: "0.8125rem" }}
            onClick={() => setVerdict(v.value)}
            title={v.hint}
          >
            {v.label}
          </button>
        ))}
      </div>

      {selectedHint && (
        <span style={{ fontSize: "0.75rem", color: "var(--text-3)" }}>{selectedHint}</span>
      )}

      {verdict && (
        <>
          <div className="field">
            <label className="field-label" style={{ fontSize: "0.7rem" }}>
              {verdict === "false_positive"
                ? "Which phrase was wrongly flagged? (optional)"
                : verdict === "missed_violation"
                  ? "What should have been flagged? (optional)"
                  : "Note (optional)"}
            </label>
            <input
              className="input"
              style={{ fontSize: "0.8125rem" }}
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder={
                verdict === "false_positive"
                  ? 'e.g. "win" matched inside "window"'
                  : verdict === "missed_violation"
                    ? "e.g. implied guaranteed returns in the second sentence"
                    : "Anything worth noting…"
              }
            />
          </div>
          {errMsg && <div style={{ color: "var(--danger, #c00)", fontSize: "0.75rem" }}>{errMsg}</div>}
          <div>
            <button className="btn btn-sm btn-primary" disabled={submitting} onClick={handleSubmit} style={{ fontSize: "0.8125rem" }}>
              {submitting ? "Submitting…" : "Submit feedback"}
            </button>
          </div>
        </>
      )}
    </div>
  );
}
