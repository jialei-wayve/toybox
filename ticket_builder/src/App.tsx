import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import { AuditLog } from "./components/AuditLog";
import { StatusPanel } from "./components/StatusPanel";
import type { JiraIssueForRefine, JiraIssueSummary } from "./types/api";
import {
  createStory,
  generateGherkin,
  getIssueByKey,
  getIssueForRefine,
  searchIssues,
  updateIssueDescription,
} from "./services/jiraStoryApi";

interface SessionCreatedTicket {
  parentKey: string;
  parentSummary: string;
  parentBrowseUrl: string;
  childKey: string;
  childSummary: string;
  childBrowseUrl: string;
}

const SESSION_TICKETS_STORAGE_KEY = "toybox:session-created-tickets";

function splitAcceptanceCriteriaParagraphs(text: string): string[] {
  return text
    .trim()
    .split(/\n\s*\n+/)
    .map((p) => p.trim())
    .filter((p) => p.length > 0);
}

/** When the summary box is empty, Jira still needs a summary — derive from Gherkin (Feature: line, etc.). */
function deriveSummaryFromGherkin(text: string): string {
  const lines = text.split(/\r?\n/).map((l) => l.trim());
  for (const t of lines) {
    if (!t || t.startsWith("#")) continue;
    const fm = /^Feature:\s*(.+)$/i.exec(t);
    if (fm) return fm[1].trim().slice(0, 255);
  }
  const keywordLine =
    /^\*\*(As a|I want|So that|Given|When|Then|And|But)\*\*/i;
  for (const t of lines) {
    if (!t || t.startsWith("#")) continue;
    if (/^Scenario:/i.test(t)) continue;
    if (keywordLine.test(t)) continue;
    return t.slice(0, 255);
  }
  return "";
}

function stamp(): string {
  return new Date().toLocaleTimeString();
}

function useDebounced<T>(value: T, ms: number): T {
  const [d, setD] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setD(value), ms);
    return () => clearTimeout(t);
  }, [value, ms]);
  return d;
}

export default function App() {
  const [searchQuery, setSearchQuery] = useState("");
  const debouncedSearch = useDebounced(searchQuery, 350);
  const [searchResults, setSearchResults] = useState<JiraIssueSummary[]>([]);
  const [searchLoading, setSearchLoading] = useState(false);
  const [searchError, setSearchError] = useState<string | null>(null);

  const [manualKey, setManualKey] = useState("");
  const [parent, setParent] = useState<JiraIssueSummary | null>(null);

  const [tab, setTab] = useState<"new" | "refine">("new");
  const [refineKeyInput, setRefineKeyInput] = useState("");
  const [refineLoadLoading, setRefineLoadLoading] = useState(false);
  const [refineError, setRefineError] = useState<string | null>(null);
  const [refineLoaded, setRefineLoaded] = useState<JiraIssueForRefine | null>(null);

  const [rawInput, setRawInput] = useState("");
  const [gherkinDraft, setGherkinDraft] = useState("");
  const [acceptanceCriteriaDraft, setAcceptanceCriteriaDraft] = useState("");
  const [summary, setSummary] = useState("");

  const [genLoading, setGenLoading] = useState(false);
  const [submitLoading, setSubmitLoading] = useState(false);
  const [statusTone, setStatusTone] = useState<"idle" | "loading" | "success" | "error">(
    "idle"
  );
  const [statusTitle, setStatusTitle] = useState("Ready");
  const [statusDetail, setStatusDetail] = useState<ReactNode>(null);
  const [sessionCreatedTickets, setSessionCreatedTickets] = useState<SessionCreatedTicket[]>([]);

  const [audit, setAudit] = useState<string[]>([]);
  const pushAudit = useCallback((line: string) => {
    setAudit((a) => [...a, `[${stamp()}] ${line}`]);
  }, []);

  useEffect(() => {
    try {
      const raw = localStorage.getItem(SESSION_TICKETS_STORAGE_KEY);
      if (!raw) return;
      const parsed = JSON.parse(raw) as unknown;
      if (!Array.isArray(parsed)) return;
      const safeItems = parsed.filter((item): item is SessionCreatedTicket => {
        if (!item || typeof item !== "object") return false;
        const obj = item as Record<string, unknown>;
        return (
          typeof obj.parentKey === "string" &&
          typeof obj.parentSummary === "string" &&
          typeof obj.parentBrowseUrl === "string" &&
          typeof obj.childKey === "string" &&
          typeof obj.childSummary === "string" &&
          typeof obj.childBrowseUrl === "string"
        );
      });
      setSessionCreatedTickets(safeItems);
    } catch {
      // Ignore malformed localStorage entries and continue with empty state.
    }
  }, []);

  useEffect(() => {
    try {
      localStorage.setItem(
        SESSION_TICKETS_STORAGE_KEY,
        JSON.stringify(sessionCreatedTickets)
      );
    } catch {
      // Ignore quota/security errors silently.
    }
  }, [sessionCreatedTickets]);

  useEffect(() => {
    if (tab !== "new") {
      setSearchResults([]);
      return;
    }
    const q = debouncedSearch.trim();
    if (q.length < 2) {
      setSearchResults([]);
      setSearchError(null);
      return;
    }
    let cancelled = false;
    setSearchLoading(true);
    setSearchError(null);
    searchIssues(q)
      .then((issues) => {
        if (!cancelled) setSearchResults(issues);
      })
      .catch((e) => {
        if (!cancelled) {
          setSearchResults([]);
          setSearchError(e instanceof Error ? e.message : "Search failed");
        }
      })
      .finally(() => {
        if (!cancelled) setSearchLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [debouncedSearch, tab]);

  const loadManualKey = async () => {
    const key = manualKey.trim();
    if (!key) {
      setSearchError("Enter a ticket key (e.g. WP-1029)");
      return;
    }
    setSearchError(null);
    setSearchLoading(true);
    try {
      const issue = await getIssueByKey(key);
      setParent(issue);
      pushAudit(`Loaded parent by key ${issue.key}`);
    } catch (e) {
      setSearchError(e instanceof Error ? e.message : "Lookup failed");
    } finally {
      setSearchLoading(false);
    }
  };

  const loadRefineTicket = async () => {
    const key = refineKeyInput.trim();
    if (!key) {
      setRefineError("Enter a Jira issue key (e.g. WP-1234).");
      return;
    }
    setRefineError(null);
    setRefineLoadLoading(true);
    try {
      const issue = await getIssueForRefine(key);
      setRefineLoaded(issue);
      const seed =
        issue.descriptionPlain.trim().length > 0
          ? issue.descriptionPlain
          : issue.summary;
      setRawInput(seed);
      setGherkinDraft("");
      setAcceptanceCriteriaDraft(issue.acceptanceCriteriaPlain.trim());
      setSummary(issue.summary);
      setStatusTone("idle");
      setStatusTitle("Ready");
      setStatusDetail(
        `Loaded ${issue.key}. Edit requirement text, generate Gherkin, then Accept to update the description.`
      );
      pushAudit(`Refine: loaded ${issue.key}`);
    } catch (e) {
      setRefineLoaded(null);
      setRefineError(e instanceof Error ? e.message : "Load failed");
    } finally {
      setRefineLoadLoading(false);
    }
  };

  const onGenerate = async () => {
    const text = rawInput.trim();
    if (!text) {
      setStatusTone("error");
      setStatusTitle("Validation");
      setStatusDetail("Enter a requirement, bug, or feature summary before generating.");
      return;
    }
    setGenLoading(true);
    setStatusTone("loading");
    setStatusTitle("Generating Gherkin…");
    setStatusDetail(null);
    try {
      const { gherkin, suggestedSummary, acceptanceCriteria } = await generateGherkin(text);
      setGherkinDraft(gherkin);
      setAcceptanceCriteriaDraft(acceptanceCriteria.join("\n\n"));
      setSummary(suggestedSummary);
      setStatusTone("idle");
      setStatusTitle("Gherkin ready for review");
      setStatusDetail(
        "Edit Gherkin and acceptance criteria if needed, then set the story summary (new ticket) and click Accept."
      );
      pushAudit("Generated Gherkin and acceptance criteria from raw input");
    } catch (e) {
      setStatusTone("error");
      setStatusTitle("Generation failed");
      setStatusDetail(e instanceof Error ? e.message : "Unknown error");
      pushAudit(`Generate error: ${e instanceof Error ? e.message : e}`);
    } finally {
      setGenLoading(false);
    }
  };

  const onAccept = async () => {
    const desc = gherkinDraft.trim();
    if (!desc) {
      setStatusTone("error");
      setStatusTitle("Validation");
      setStatusDetail("Gherkin description is empty.");
      return;
    }

    const acParagraphs = splitAcceptanceCriteriaParagraphs(acceptanceCriteriaDraft);
    if (acParagraphs.length !== 3) {
      setStatusTone("error");
      setStatusTitle("Validation");
      setStatusDetail(
        "Acceptance criteria must contain exactly three non-empty paragraphs separated by a blank line."
      );
      return;
    }
    const acceptanceCriteriaForJira = acParagraphs.join("\n\n");

    if (tab === "refine") {
      if (!refineLoaded) {
        setStatusTone("error");
        setStatusTitle("Validation");
        setStatusDetail("Load a ticket in the Refine Ticket tab first.");
        return;
      }
      setSubmitLoading(true);
      setStatusTone("loading");
      setStatusTitle("Updating description…");
      setStatusDetail(null);
      try {
        await updateIssueDescription(refineLoaded.key, desc, acceptanceCriteriaForJira);
        setStatusTone("idle");
        setStatusTitle("Ready");
        setStatusDetail(`Updated description and acceptance criteria on ${refineLoaded.key}.`);
        pushAudit(`Refine: updated description and acceptance criteria on ${refineLoaded.key}`);
      } catch (e) {
        setStatusTone("error");
        setStatusTitle("Update failed");
        setStatusDetail(e instanceof Error ? e.message : "Unknown error");
        pushAudit(`Refine update error: ${e instanceof Error ? e.message : e}`);
      } finally {
        setSubmitLoading(false);
      }
      return;
    }

    if (!parent) {
      setStatusTone("error");
      setStatusTitle("Validation");
      setStatusDetail("Select or load a parent ticket first.");
      return;
    }
    const sum = summary.trim() || deriveSummaryFromGherkin(desc);
    if (!sum) {
      setStatusTone("error");
      setStatusTitle("Validation");
      setStatusDetail(
        "Add a Story summary, or include a Feature: line (or other non-keyword line) in the Gherkin so a summary can be inferred."
      );
      return;
    }

    setSubmitLoading(true);
    setStatusTone("loading");
    setStatusTitle("Creating Jira Story…");
    setStatusDetail(null);
    try {
      const issue = await createStory({
        parentKey: parent.key,
        summary: sum,
        description: desc,
        acceptanceCriteria: acceptanceCriteriaForJira,
      });
      const parentBrowseUrl = `${issue.browseUrl.replace(/\/browse\/[^/]+$/, "")}/browse/${parent.key}`;
      setSessionCreatedTickets((items) => [
        ...items,
        {
          parentKey: parent.key,
          parentSummary: parent.summary,
          parentBrowseUrl,
          childKey: issue.key,
          childSummary: sum,
          childBrowseUrl: issue.browseUrl,
        },
      ]);
      setStatusTone("idle");
      setStatusTitle("Ready");
      setStatusDetail(null);
      pushAudit(`Created Story ${issue.key} under ${parent.key}`);
    } catch (e) {
      setStatusTone("error");
      setStatusTitle("Create failed");
      setStatusDetail(e instanceof Error ? e.message : "Unknown error");
      pushAudit(`Create error: ${e instanceof Error ? e.message : e}`);
    } finally {
      setSubmitLoading(false);
    }
  };

  const copyGherkin = async () => {
    const text = gherkinDraft.trim();
    if (!text) return;
    try {
      await navigator.clipboard.writeText(text);
      pushAudit("Copied Gherkin to clipboard");
      setStatusTone("idle");
      setStatusTitle("Copied");
      setStatusDetail("Gherkin is on the clipboard.");
    } catch {
      setStatusTone("error");
      setStatusTitle("Copy failed");
      setStatusDetail("Clipboard permission denied or unavailable.");
    }
  };

  const resetFlow = () => {
    setRawInput("");
    setGherkinDraft("");
    setAcceptanceCriteriaDraft("");
    setSummary("");
    setParent(null);
    setSearchQuery("");
    setManualKey("");
    setSearchResults([]);
    setRefineKeyInput("");
    setRefineLoaded(null);
    setRefineError(null);
    setStatusTone("idle");
    setStatusTitle("Ready");
    setStatusDetail(null);
    pushAudit("Reset form");
  };

  const groupedSessionTickets = useMemo(() => {
    const groups: Array<{
      parentKey: string;
      parentSummary: string;
      parentBrowseUrl: string;
      children: Array<{ key: string; summary: string; browseUrl: string }>;
    }> = [];
    for (const item of sessionCreatedTickets) {
      const existing = groups.find((g) => g.parentKey === item.parentKey);
      if (existing) {
        existing.children.push({
          key: item.childKey,
          summary: item.childSummary,
          browseUrl: item.childBrowseUrl,
        });
      } else {
        groups.push({
          parentKey: item.parentKey,
          parentSummary: item.parentSummary,
          parentBrowseUrl: item.parentBrowseUrl,
          children: [
            {
              key: item.childKey,
              summary: item.childSummary,
              browseUrl: item.childBrowseUrl,
            },
          ],
        });
      }
    }
    return groups;
  }, [sessionCreatedTickets]);

  const effectiveSummary = useMemo(
    () => summary.trim() || deriveSummaryFromGherkin(gherkinDraft),
    [summary, gherkinDraft]
  );

  const acceptanceParagraphCount = useMemo(
    () => splitAcceptanceCriteriaParagraphs(acceptanceCriteriaDraft).length,
    [acceptanceCriteriaDraft]
  );

  const acceptDisabled = useMemo(() => {
    if (submitLoading) return true;
    if (!gherkinDraft.trim()) return true;
    if (acceptanceParagraphCount !== 3) return true;
    if (tab === "refine") {
      return !refineLoaded;
    }
    return !parent || !effectiveSummary.trim();
  }, [
    tab,
    refineLoaded,
    parent,
    gherkinDraft,
    effectiveSummary,
    submitLoading,
    acceptanceParagraphCount,
  ]);

  const acceptDisabledReason = useMemo(() => {
    if (submitLoading) {
      return tab === "refine" ? "Saving description…" : "Creating story…";
    }
    if (!gherkinDraft.trim()) return "Add Gherkin text for the Jira description.";
    if (acceptanceParagraphCount !== 3) {
      return "Acceptance criteria need exactly three paragraphs separated by a blank line.";
    }
    if (tab === "refine") {
      return refineLoaded ? undefined : "Load an existing ticket first.";
    }
    if (!parent) return "Select or load a parent ticket first.";
    if (!effectiveSummary.trim()) {
      return "Add a Story summary, or a Feature: line in the Gherkin.";
    }
    return undefined;
  }, [
    tab,
    refineLoaded,
    parent,
    gherkinDraft,
    effectiveSummary,
    submitLoading,
    acceptanceParagraphCount,
  ]);

  return (
    <>
      <header>
        <h1>Jira Story Builder</h1>
        <p className="subtitle">
          Generate Gherkin from notes, then create a new Story under a parent or update an existing
          ticket description.
        </p>
      </header>

      <div className="layout-grid">
        <div>
          <StatusPanel tone={statusTone} title={statusTitle}>
            {statusDetail}
          </StatusPanel>
          {groupedSessionTickets.length > 0 ? (
            <section className="panel">
              <h2>Session tickets</h2>
              <div className="session-ticket-list">
                {groupedSessionTickets.map((group) => (
                  <div key={group.parentKey}>
                    <a href={group.parentBrowseUrl} target="_blank" rel="noreferrer">
                      {group.parentKey} - {group.parentSummary}
                    </a>
                    {group.children.map((child) => (
                      <a
                        key={`${group.parentKey}-${child.key}`}
                        href={child.browseUrl}
                        target="_blank"
                        rel="noreferrer"
                        className="session-ticket-line--child"
                      >
                        {child.key} - {child.summary}
                      </a>
                    ))}
                  </div>
                ))}
              </div>
            </section>
          ) : null}

          <div className="tabs" role="tablist" aria-label="Ticket workflow">
            <button
              type="button"
              role="tab"
              aria-selected={tab === "new"}
              className={`tab ${tab === "new" ? "tab--active" : ""}`}
              onClick={() => {
                setTab("new");
                setRefineError(null);
              }}
            >
              New Ticket
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={tab === "refine"}
              className={`tab ${tab === "refine" ? "tab--active" : ""}`}
              onClick={() => {
                setTab("refine");
                setSearchError(null);
              }}
            >
              Refine Ticket
            </button>
          </div>

          {tab === "new" ? (
            <section className="panel">
              <h2>Parent ticket</h2>
              <label className="field-label" htmlFor="search">
                Search or type a key (debounced search)
              </label>
              <input
                id="search"
                type="text"
                placeholder="e.g. WP-1029 or triage studio"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                autoComplete="off"
              />
              {searchLoading ? (
                <p className="muted" style={{ marginTop: "0.5rem" }}>
                  Searching…
                </p>
              ) : null}
              {searchError ? (
                <p className="muted" style={{ marginTop: "0.5rem", color: "var(--error)" }}>
                  {searchError}
                </p>
              ) : null}
              {searchResults.length > 0 ? (
                <ul className="search-results" style={{ marginTop: "0.5rem" }}>
                  {searchResults.map((issue) => (
                    <li key={issue.id}>
                      <button
                        type="button"
                        onClick={() => {
                          setParent(issue);
                          pushAudit(`Selected parent ${issue.key}`);
                        }}
                      >
                        <span className="ticket-key">{issue.key}</span>
                        {issue.summary}
                        <span className="muted"> · {issue.issueType}</span>
                      </button>
                    </li>
                  ))}
                </ul>
              ) : null}

              <div className="row" style={{ marginTop: "0.75rem" }}>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <label className="field-label" htmlFor="key">
                    Or enter key directly
                  </label>
                  <input
                    id="key"
                    type="text"
                    placeholder="WP-1029"
                    value={manualKey}
                    onChange={(e) => setManualKey(e.target.value)}
                  />
                </div>
                <button type="button" className="btn btn--ghost" onClick={loadManualKey}>
                  Load
                </button>
              </div>

              {parent ? (
                <div className="selected-parent">
                  <strong>
                    Parent: {parent.key} <span className="muted">({parent.issueType})</span>
                  </strong>
                  <div>{parent.summary}</div>
                  <div className="muted">Status: {parent.status}</div>
                </div>
              ) : (
                <p className="muted" style={{ marginTop: "0.5rem" }}>
                  No parent selected yet.
                </p>
              )}
            </section>
          ) : (
            <section className="panel">
              <h2>Existing ticket</h2>
              <label className="field-label" htmlFor="refine-key">
                Jira issue key
              </label>
              <div className="row" style={{ marginBottom: 0 }}>
                <input
                  id="refine-key"
                  type="text"
                  placeholder="e.g. WP-1234"
                  value={refineKeyInput}
                  onChange={(e) => setRefineKeyInput(e.target.value)}
                  autoComplete="off"
                />
                <button
                  type="button"
                  className="btn btn--ghost"
                  onClick={loadRefineTicket}
                  disabled={refineLoadLoading}
                >
                  {refineLoadLoading ? "Loading…" : "Load"}
                </button>
              </div>
              {refineError ? (
                <p className="muted" style={{ marginTop: "0.5rem", color: "var(--error)" }}>
                  {refineError}
                </p>
              ) : null}
              {refineLoaded ? (
                <div className="selected-parent" style={{ marginTop: "0.75rem" }}>
                  <strong>
                    {refineLoaded.key}{" "}
                    <span className="muted">({refineLoaded.issueType})</span>
                  </strong>
                  <div>{refineLoaded.summary}</div>
                  <div className="muted">Status: {refineLoaded.status}</div>
                </div>
              ) : (
                <p className="muted" style={{ marginTop: "0.5rem" }}>
                  Enter a key and click Load to copy the ticket description into the requirement
                  field below.
                </p>
              )}
            </section>
          )}

          <section className="panel">
            <h2>Requirement input</h2>
            <label className="field-label" htmlFor="raw">
              Bug, requirement, or feature summary
            </label>
            <textarea
              id="raw"
              value={rawInput}
              onChange={(e) => setRawInput(e.target.value)}
              placeholder="Describe what you need in plain language…"
            />
            <div className="btn-row">
              <button
                type="button"
                className="btn btn--primary"
                onClick={onGenerate}
                disabled={genLoading || !rawInput.trim()}
              >
                {genLoading ? "Generating…" : "Generate Gherkin"}
              </button>
            </div>
          </section>

          <section className="panel">
            <h2>Gherkin (editable)</h2>
            <label className="field-label" htmlFor="gherkin">
              {tab === "refine"
                ? "Review and edit before updating the ticket description"
                : "Review and edit before creating the Story"}
            </label>
            <textarea
              id="gherkin"
              className="gherkin-editor"
              value={gherkinDraft}
              onChange={(e) => setGherkinDraft(e.target.value)}
            />

            <label className="field-label" htmlFor="acceptance-criteria" style={{ marginTop: "0.75rem" }}>
              Acceptance criteria (three paragraphs, Gherkin keywords in **bold**)
            </label>
            <textarea
              id="acceptance-criteria"
              className="gherkin-editor"
              style={{ minHeight: "7rem" }}
              value={acceptanceCriteriaDraft}
              onChange={(e) => setAcceptanceCriteriaDraft(e.target.value)}
              placeholder="Generate from requirement to fill three paragraphs. Separate each criterion with a blank line."
            />
            <p className="muted" style={{ marginTop: "0.35rem" }}>
              Bold only Gherkin keywords: Given, When, Then, And, But, As a, I want, So that (wrap each
              keyword in **double asterisks** in the text). Paragraphs: {acceptanceParagraphCount} / 3.
            </p>

            {tab === "new" ? (
              <>
                <label className="field-label" htmlFor="summary" style={{ marginTop: "0.75rem" }}>
                  Story summary
                </label>
                <input
                  id="summary"
                  type="text"
                  value={summary}
                  onChange={(e) => setSummary(e.target.value)}
                  placeholder="Optional if Gherkin has Feature: … — otherwise enter a summary"
                />
                {!summary.trim() && effectiveSummary && gherkinDraft.trim() ? (
                  <p className="muted" style={{ marginTop: "0.35rem" }}>
                    Story summary will be: <strong>{effectiveSummary}</strong> (from Gherkin)
                  </p>
                ) : null}
              </>
            ) : null}
            <div className="btn-row">
              <button
                type="button"
                className="btn btn--primary"
                onClick={onAccept}
                disabled={acceptDisabled}
                title={acceptDisabled ? acceptDisabledReason : undefined}
              >
                {submitLoading
                  ? tab === "refine"
                    ? "Saving…"
                    : "Creating…"
                  : tab === "refine"
                    ? "Accept — update description"
                    : "Accept — create Story"}
              </button>
              <button
                type="button"
                className="btn btn--ghost"
                onClick={copyGherkin}
                disabled={!gherkinDraft.trim()}
              >
                Copy Gherkin
              </button>
              <button type="button" className="btn btn--ghost" onClick={resetFlow}>
                Reset flow
              </button>
            </div>
          </section>
        </div>

        <aside>
          <AuditLog entries={audit} />
        </aside>
      </div>
    </>
  );
}
