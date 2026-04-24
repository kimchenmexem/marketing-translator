/**
 * ComplianceAdmin — internal admin UI for the compliance source-of-truth system.
 *
 * Sub-views (tabs within this component):
 *  - Sources: list regulatory sources, drill into documents
 *  - Documents: versions + diffs
 *  - Obligations: list/approve/reject
 *  - Review: review task queue
 *  - Bundles: list + inspect published bundles
 */

import { useState, useEffect, useCallback } from "react";
import * as api from "../api/compliance";

type SubTab = "sources" | "obligations" | "review" | "bundles";

const SUB_TABS: { id: SubTab; label: string }[] = [
  { id: "sources", label: "Sources" },
  { id: "obligations", label: "Obligations" },
  { id: "review", label: "Review Queue" },
  { id: "bundles", label: "Bundles" },
];

export default function ComplianceAdmin() {
  const [tab, setTab] = useState<SubTab>("sources");

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "1rem" }}>
      {/* Sub-tab bar */}
      <div style={{ display: "flex", gap: "0.25rem", borderBottom: "1px solid var(--border)", paddingBottom: "0.5rem" }}>
        {SUB_TABS.map(t => (
          <button
            key={t.id}
            className={`btn btn-sm ${tab === t.id ? "btn-primary" : "btn-ghost"}`}
            onClick={() => setTab(t.id)}
          >
            {t.label}
          </button>
        ))}
      </div>

      {tab === "sources" && <SourcesPanel />}
      {tab === "obligations" && <ObligationsPanel />}
      {tab === "review" && <ReviewPanel />}
      {tab === "bundles" && <BundlesPanel />}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════
// SOURCES
// ═══════════════════════════════════════════════════════════════════════

function SourcesPanel() {
  const [sources, setSources] = useState<any[]>([]);
  const [selected, setSelected] = useState<any | null>(null);
  const [docs, setDocs] = useState<any[]>([]);
  const [versions, setVersions] = useState<any[]>([]);
  const [diff, setDiff] = useState<any | null>(null);
  const [selectedDoc, setSelectedDoc] = useState<any | null>(null);
  const [syncing, setSyncing] = useState(false);
  const [syncResult, setSyncResult] = useState<any[] | null>(null);

  useEffect(() => { api.listSources().then(setSources).catch(console.error); }, []);

  const selectSource = async (code: string) => {
    const res = await api.getSource(code);
    setSelected(res.source);
    setDocs(res.documents);
    setVersions([]);
    setDiff(null);
    setSelectedDoc(null);
  };

  const selectDoc = async (doc: any) => {
    setSelectedDoc(doc);
    setDiff(null);
    const v = await api.listVersions(doc.id);
    setVersions(v);
    if (v.length > 0) {
      try { setDiff(await api.getDocDiff(doc.id)); } catch {}
    }
  };

  const handleSync = async () => {
    setSyncing(true);
    setSyncResult(null);
    try {
      const res = await api.triggerSync(selected?.code);
      setSyncResult(res);
      if (selected) await selectSource(selected.code);
    } catch (e: any) {
      setSyncResult([{ error: e.message }]);
    }
    setSyncing(false);
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "1rem" }}>
      {/* Source list */}
      <div className="card">
        <div className="card-header">
          <span className="card-title">Regulatory Sources</span>
          <button className="btn btn-sm btn-secondary" onClick={() => api.triggerSync().then(setSyncResult).finally(() => api.listSources().then(setSources))} disabled={syncing}>
            {syncing ? "Syncing..." : "Sync All"}
          </button>
        </div>
        <div className="card-body" style={{ padding: 0 }}>
          <table style={{ width: "100%", fontSize: "0.8125rem", borderCollapse: "collapse" }}>
            <thead>
              <tr style={{ borderBottom: "1px solid var(--border)", textAlign: "left" }}>
                <Th>Code</Th><Th>Regulator</Th><Th>Jurisdiction</Th><Th>Type</Th><Th>Locales</Th><Th>Active</Th>
              </tr>
            </thead>
            <tbody>
              {sources.map(s => (
                <tr key={s.code}
                  onClick={() => selectSource(s.code)}
                  style={{ borderBottom: "1px solid var(--border)", cursor: "pointer", background: selected?.code === s.code ? "var(--blue-light)" : undefined }}>
                  <Td><strong>{s.code}</strong></Td>
                  <Td>{s.regulator}</Td>
                  <Td><span className="badge badge-gray">{s.jurisdiction}</span></Td>
                  <Td>{s.sourceType}</Td>
                  <Td>{s.localeScope?.join(", ")}</Td>
                  <Td>{s.active ? "Yes" : "No"}</Td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Selected source → documents */}
      {selected && (
        <div className="card">
          <div className="card-header">
            <span className="card-title">{selected.code} — Documents ({docs.length})</span>
            <button className="btn btn-sm btn-secondary" onClick={handleSync} disabled={syncing}>
              {syncing ? "Syncing..." : `Sync ${selected.code}`}
            </button>
          </div>
          <div className="card-body" style={{ padding: 0 }}>
            {docs.length === 0
              ? <p style={{ padding: "1rem", color: "var(--text-3)", fontSize: "0.8125rem" }}>No documents yet. Run a sync or use the ManualAdapter.</p>
              : (
                <table style={{ width: "100%", fontSize: "0.8125rem", borderCollapse: "collapse" }}>
                  <thead>
                    <tr style={{ borderBottom: "1px solid var(--border)", textAlign: "left" }}>
                      <Th>Ref</Th><Th>Title</Th><Th>URL</Th>
                    </tr>
                  </thead>
                  <tbody>
                    {docs.map(d => (
                      <tr key={d.id}
                        onClick={() => selectDoc(d)}
                        style={{ borderBottom: "1px solid var(--border)", cursor: "pointer", background: selectedDoc?.id === d.id ? "var(--blue-light)" : undefined }}>
                        <Td><strong>{d.externalRef}</strong></Td>
                        <Td>{d.title}</Td>
                        <Td>{d.url ? <a href={d.url} target="_blank" rel="noreferrer" style={{ color: "var(--blue)", fontSize: "0.75rem" }}>Link</a> : "—"}</Td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
          </div>
        </div>
      )}

      {/* Sync results toast */}
      {syncResult && (
        <div className="card" style={{ background: "var(--blue-light)" }}>
          <div className="card-body" style={{ fontSize: "0.8125rem" }}>
            <strong>Sync results:</strong>
            {syncResult.map((r: any, i: number) => (
              <div key={i} style={{ marginTop: "0.25rem" }}>
                {r.sourceCode}: {r.status} — {r.documentsUpserted} docs, {r.versionsCreated} new versions
                {r.warnings?.map((w: string, j: number) => <div key={j} style={{ color: "var(--amber)", marginLeft: "1rem" }}>{w}</div>)}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Versions + diff */}
      {selectedDoc && versions.length > 0 && (
        <div className="card">
          <div className="card-header"><span className="card-title">{selectedDoc.externalRef} — Versions ({versions.length})</span></div>
          <div className="card-body" style={{ padding: 0 }}>
            <table style={{ width: "100%", fontSize: "0.8125rem", borderCollapse: "collapse" }}>
              <thead>
                <tr style={{ borderBottom: "1px solid var(--border)", textAlign: "left" }}>
                  <Th>ID</Th><Th>Label</Th><Th>Hash</Th><Th>Fetched</Th><Th>By</Th>
                </tr>
              </thead>
              <tbody>
                {versions.map(v => (
                  <tr key={v.id} style={{ borderBottom: "1px solid var(--border)" }}>
                    <Td>{v.id}</Td>
                    <Td>{v.versionLabel}</Td>
                    <Td><code style={{ fontSize: "0.6875rem" }}>{v.contentHash?.substring(0, 12)}...</code></Td>
                    <Td>{new Date(v.fetchedAt).toLocaleDateString()}</Td>
                    <Td>{v.fetchedBy}</Td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {diff && diff.hasChanges && (
            <div className="card-body" style={{ borderTop: "1px solid var(--border)" }}>
              <div style={{ fontSize: "0.75rem", fontWeight: 600, marginBottom: "0.5rem" }}>
                Diff: {diff.isNew ? "NEW" : `+${diff.stats.added} / -${diff.stats.removed} lines`}
              </div>
              <pre style={{ fontSize: "0.6875rem", background: "var(--bg)", padding: "0.75rem", borderRadius: "var(--radius-sm)", overflow: "auto", maxHeight: "200px" }}>
                {diff.hunks?.map((h: any, i: number) =>
                  h.lines.map((line: string, j: number) => (
                    <div key={`${i}-${j}`} style={{ color: h.type === "added" ? "var(--green)" : h.type === "removed" ? "var(--red)" : "var(--text-3)" }}>
                      {h.type === "added" ? "+ " : h.type === "removed" ? "- " : "  "}{line}
                    </div>
                  ))
                )}
              </pre>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════
// OBLIGATIONS
// ═══════════════════════════════════════════════════════════════════════

function ObligationsPanel() {
  const [obligations, setObligations] = useState<any[]>([]);
  const [filter, setFilter] = useState<string>("");
  const [expanded, setExpanded] = useState<number | null>(null);
  const [actor, setActor] = useState("admin");

  const load = useCallback(() => {
    const f: any = {};
    if (filter) f.status = filter;
    api.listObligations(f).then(setObligations).catch(console.error);
  }, [filter]);

  useEffect(() => { load(); }, [load]);

  const transition = async (id: number, status: string) => {
    try {
      await api.transitionObligation(id, status, actor);
      load();
    } catch (e: any) {
      alert(e?.response?.data?.error ?? e.message);
    }
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "1rem" }}>
      <div style={{ display: "flex", gap: "0.5rem", alignItems: "center" }}>
        <select className="select" value={filter} onChange={e => setFilter(e.target.value)} style={{ width: "180px", fontSize: "0.8125rem" }}>
          <option value="">All statuses</option>
          <option value="pending">Pending</option>
          <option value="reviewed">Reviewed</option>
          <option value="approved">Approved</option>
          <option value="rejected">Rejected</option>
          <option value="superseded">Superseded</option>
        </select>
        <span style={{ fontSize: "0.75rem", color: "var(--text-3)" }}>Actor:</span>
        <input className="input" value={actor} onChange={e => setActor(e.target.value)} style={{ width: "120px", fontSize: "0.8125rem" }} />
      </div>

      {obligations.length === 0
        ? <p style={{ color: "var(--text-3)", fontSize: "0.8125rem" }}>No obligations found.</p>
        : obligations.map(obl => (
            <div key={obl.id} className="card">
              <div className="card-header" style={{ cursor: "pointer" }} onClick={() => setExpanded(expanded === obl.id ? null : obl.id)}>
                <div style={{ display: "flex", alignItems: "center", gap: "0.5rem", flexWrap: "wrap" }}>
                  <span style={{ fontWeight: 600, fontSize: "0.875rem" }}>{obl.title}</span>
                  <StatusBadge status={obl.status} />
                  <span className="badge badge-gray">{obl.jurisdiction}</span>
                  {obl.localeCode && <span className="badge badge-gray">{obl.localeCode}</span>}
                  <span className={`badge ${obl.severity === "critical" ? "badge-red" : obl.severity === "major" ? "badge-amber" : "badge-gray"}`}>{obl.severity}</span>
                </div>
                <span style={{ fontSize: "0.75rem", color: "var(--text-4)" }}>#{obl.id}</span>
              </div>

              {expanded === obl.id && (
                <div className="card-body" style={{ display: "flex", flexDirection: "column", gap: "0.75rem", fontSize: "0.8125rem" }}>
                  <div><strong>Category:</strong> {obl.category}</div>
                  <div><strong>Description:</strong> {obl.description}</div>
                  {obl.sourceRefs?.length > 0 && (
                    <div>
                      <strong>Source refs:</strong>
                      {obl.sourceRefs.map((r: any, i: number) => (
                        <span key={i} className="badge badge-blue" style={{ marginLeft: "0.25rem" }}>{r.sourceCode}{r.documentRef ? ` / ${r.documentRef}` : ""}</span>
                      ))}
                    </div>
                  )}
                  {obl.rules?.length > 0 && (
                    <div>
                      <strong>Rules ({obl.rules.length}):</strong>
                      {obl.rules.map((r: any) => (
                        <div key={r.id} style={{ marginLeft: "1rem", marginTop: "0.25rem", padding: "0.375rem 0.5rem", background: "var(--bg)", borderRadius: "var(--radius-sm)", fontSize: "0.75rem" }}>
                          <span className="badge badge-gray">{r.ruleType}</span> {JSON.stringify(r.config).substring(0, 100)}...
                        </div>
                      ))}
                    </div>
                  )}
                  {obl.approvedBy && <div><strong>Approved by:</strong> {obl.approvedBy} at {new Date(obl.approvedAt).toLocaleString()}</div>}

                  {/* Action buttons */}
                  <div style={{ display: "flex", gap: "0.5rem", marginTop: "0.25rem" }}>
                    {obl.status === "pending" && (
                      <button className="btn btn-sm btn-secondary" onClick={() => transition(obl.id, "reviewed")}>Mark Reviewed</button>
                    )}
                    {obl.status === "reviewed" && (
                      <>
                        <button className="btn btn-sm btn-primary" style={{ background: "var(--green)" }} onClick={() => transition(obl.id, "approved")}>Approve</button>
                        <button className="btn btn-sm btn-secondary" style={{ color: "var(--red)" }} onClick={() => transition(obl.id, "rejected")}>Reject</button>
                      </>
                    )}
                    {obl.status === "rejected" && (
                      <button className="btn btn-sm btn-secondary" onClick={() => transition(obl.id, "pending")}>Re-open</button>
                    )}
                  </div>
                </div>
              )}
            </div>
          ))
      }
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════
// REVIEW QUEUE
// ═══════════════════════════════════════════════════════════════════════

function ReviewPanel() {
  const [tasks, setTasks] = useState<any[]>([]);
  const [filter, setFilter] = useState<string>("");

  const load = useCallback(() => {
    const f: any = {};
    if (filter) f.status = filter;
    api.listReviewTasks(f).then(setTasks).catch(console.error);
  }, [filter]);

  useEffect(() => { load(); }, [load]);

  const decide = async (id: number, decision: string) => {
    try {
      await api.decideReviewTask(id, decision, "admin");
      load();
    } catch (e: any) {
      alert(e?.response?.data?.error ?? e.message);
    }
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "1rem" }}>
      <select className="select" value={filter} onChange={e => setFilter(e.target.value)} style={{ width: "180px", fontSize: "0.8125rem" }}>
        <option value="">All statuses</option>
        <option value="open">Open</option>
        <option value="in_progress">In Progress</option>
        <option value="decided">Decided</option>
      </select>

      {tasks.length === 0
        ? <p style={{ color: "var(--text-3)", fontSize: "0.8125rem" }}>No review tasks.</p>
        : tasks.map(t => (
            <div key={t.id} className="card">
              <div className="card-header">
                <div style={{ display: "flex", alignItems: "center", gap: "0.5rem", flexWrap: "wrap" }}>
                  <span style={{ fontWeight: 600, fontSize: "0.8125rem" }}>{t.title}</span>
                  <StatusBadge status={t.status} />
                  <span className="badge badge-gray">{t.kind}</span>
                </div>
                <span style={{ fontSize: "0.75rem", color: "var(--text-4)" }}>#{t.id}</span>
              </div>
              <div className="card-body" style={{ fontSize: "0.8125rem" }}>
                <div><strong>Ref:</strong> {t.refType} #{t.refId}</div>
                {t.decision && <div><strong>Decision:</strong> {t.decision} by {t.decidedBy}</div>}
                {t.note && <div><strong>Note:</strong> {t.note}</div>}
                {t.status === "open" && (
                  <div style={{ display: "flex", gap: "0.5rem", marginTop: "0.5rem" }}>
                    <button className="btn btn-sm btn-primary" style={{ background: "var(--green)" }} onClick={() => decide(t.id, "approved")}>Approve</button>
                    <button className="btn btn-sm btn-secondary" style={{ color: "var(--red)" }} onClick={() => decide(t.id, "rejected")}>Reject</button>
                  </div>
                )}
              </div>
            </div>
          ))
      }
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════
// BUNDLES
// ═══════════════════════════════════════════════════════════════════════

function BundlesPanel() {
  const [bundles, setBundles] = useState<any[]>([]);
  const [expanded, setExpanded] = useState<number | null>(null);
  const [detail, setDetail] = useState<any | null>(null);

  useEffect(() => { api.listBundles().then(setBundles).catch(console.error); }, []);

  const expand = async (id: number) => {
    if (expanded === id) { setExpanded(null); setDetail(null); return; }
    setExpanded(id);
    try { setDetail(await api.getBundle(id)); } catch { setDetail(null); }
  };

  const handlePublish = async (id: number) => {
    try {
      await api.publishBundle(id, "admin");
      api.listBundles().then(setBundles);
      setExpanded(null);
      setDetail(null);
    } catch (e: any) {
      alert(e?.response?.data?.error ?? e.message);
    }
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "1rem" }}>
      {bundles.length === 0
        ? <p style={{ color: "var(--text-3)", fontSize: "0.8125rem" }}>No rule bundles yet.</p>
        : bundles.map(b => (
            <div key={b.id} className="card">
              <div className="card-header" style={{ cursor: "pointer" }} onClick={() => expand(b.id)}>
                <div style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
                  <span style={{ fontWeight: 600, fontSize: "0.875rem" }}>{b.localeCode}@{b.version}</span>
                  <StatusBadge status={b.status} />
                  <span className="badge badge-gray">{b.jurisdiction}</span>
                </div>
                <span style={{ fontSize: "0.75rem", color: "var(--text-4)" }}>
                  {b.publishedAt ? new Date(b.publishedAt).toLocaleDateString() : "draft"}
                </span>
              </div>

              {expanded === b.id && detail && (
                <div className="card-body" style={{ display: "flex", flexDirection: "column", gap: "0.75rem", fontSize: "0.8125rem" }}>
                  <div><strong>Hash:</strong> <code style={{ fontSize: "0.6875rem" }}>{detail.contentHash?.substring(0, 24)}...</code></div>
                  {detail.publishedBy && <div><strong>Published by:</strong> {detail.publishedBy}</div>}
                  {detail.notes && <div><strong>Notes:</strong> {detail.notes}</div>}

                  {/* Source refs */}
                  {detail.sourceRefs?.length > 0 && (
                    <div>
                      <strong>Source references:</strong>
                      <div style={{ display: "flex", gap: "0.25rem", flexWrap: "wrap", marginTop: "0.25rem" }}>
                        {detail.sourceRefs.map((r: any, i: number) => (
                          <span key={i} className="badge badge-blue">{r.sourceCode}{r.documentRef ? ` / ${r.documentRef}` : ""}</span>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* Compiled content */}
                  {detail.content && (
                    <div>
                      <strong>Compiled rules:</strong>
                      <div style={{ marginTop: "0.25rem", padding: "0.5rem", background: "var(--bg)", borderRadius: "var(--radius-sm)", fontSize: "0.75rem" }}>
                        <div><strong>Banned phrases:</strong> {detail.content.bannedPhrases?.length ?? 0} — {detail.content.bannedPhrases?.join(", ") || "none"}</div>
                        <div style={{ marginTop: "0.25rem" }}><strong>Regex rules:</strong> {detail.content.regexRules?.length ?? 0}</div>
                        {detail.content.regexRules?.map((r: any, i: number) => (
                          <div key={i} style={{ marginLeft: "1rem", color: "var(--text-3)" }}>/{r.pattern}/{r.flags ?? ""} → {r.message}</div>
                        ))}
                        <div style={{ marginTop: "0.25rem" }}><strong>Required disclaimers:</strong> {detail.content.requiredDisclaimers?.length ?? 0}</div>
                        {detail.content.requiredDisclaimers?.map((d: any, i: number) => (
                          <div key={i} style={{ marginLeft: "1rem", color: "var(--text-3)" }}>"{d.text?.substring(0, 80)}..." {d.triggers ? `(triggers: ${d.triggers.join(", ")})` : ""}</div>
                        ))}
                        <div style={{ marginTop: "0.25rem" }}><strong>Risk warning:</strong> {detail.content.disclaimers?.riskWarning}</div>
                        <div><strong>Past performance:</strong> {detail.content.disclaimers?.pastPerformance}</div>
                      </div>
                    </div>
                  )}

                  {/* Prompt context */}
                  {detail.content?.promptContext && (
                    <details style={{ fontSize: "0.75rem" }}>
                      <summary style={{ cursor: "pointer", fontWeight: 600 }}>Prompt context (for LLM validators)</summary>
                      <pre style={{ background: "var(--bg)", padding: "0.5rem", borderRadius: "var(--radius-sm)", marginTop: "0.25rem", whiteSpace: "pre-wrap", maxHeight: "200px", overflow: "auto" }}>
                        {detail.content.promptContext}
                      </pre>
                    </details>
                  )}

                  {/* Actions */}
                  {b.status === "draft" && (
                    <button className="btn btn-sm btn-primary" onClick={() => handlePublish(b.id)}>Publish Bundle</button>
                  )}
                </div>
              )}
            </div>
          ))
      }
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════
// SHARED SMALL COMPONENTS
// ═══════════════════════════════════════════════════════════════════════

function Th({ children }: { children: React.ReactNode }) {
  return <th style={{ padding: "0.5rem 0.75rem", fontWeight: 600, fontSize: "0.75rem", color: "var(--text-3)" }}>{children}</th>;
}

function Td({ children }: { children: React.ReactNode }) {
  return <td style={{ padding: "0.5rem 0.75rem" }}>{children}</td>;
}

function StatusBadge({ status }: { status: string }) {
  const colors: Record<string, string> = {
    published: "badge-green",
    approved: "badge-green",
    decided: "badge-green",
    draft: "badge-gray",
    pending: "badge-gray",
    open: "badge-blue",
    in_progress: "badge-blue",
    reviewed: "badge-blue",
    rejected: "badge-red",
    superseded: "badge-amber",
    failed: "badge-red",
  };
  return <span className={`badge ${colors[status] ?? "badge-gray"}`}>{status}</span>;
}
