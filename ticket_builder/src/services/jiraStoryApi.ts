import type {
  JiraCreateStoryResult,
  JiraIssueForRefine,
  JiraIssueSummary,
} from "../types/api";

const base = "";

async function parseJson<T>(res: Response): Promise<T> {
  const text = await res.text();
  try {
    return JSON.parse(text) as T;
  } catch {
    throw new Error(text.slice(0, 200) || `Invalid JSON (${res.status})`);
  }
}

export async function searchIssues(query: string): Promise<JiraIssueSummary[]> {
  const params = new URLSearchParams({ q: query });
  const res = await fetch(`${base}/api/jira/search?${params}`);
  const data = await parseJson<{ ok: boolean; issues?: JiraIssueSummary[]; error?: string }>(
    res
  );
  if (!res.ok || !data.ok) {
    throw new Error(data.error || `Search failed (${res.status})`);
  }
  return data.issues ?? [];
}

export async function getIssueByKey(key: string): Promise<JiraIssueSummary> {
  const res = await fetch(`${base}/api/jira/issue/${encodeURIComponent(key)}`);
  const data = await parseJson<{ ok: boolean; issue?: JiraIssueSummary; error?: string }>(res);
  if (!res.ok || !data.ok || !data.issue) {
    throw new Error(data.error || `Lookup failed (${res.status})`);
  }
  return data.issue;
}

export async function generateGherkin(text: string): Promise<{
  gherkin: string;
  suggestedSummary: string;
  acceptanceCriteria: string[];
}> {
  const res = await fetch(`${base}/api/gherkin/generate`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ text }),
  });
  const data = await parseJson<{
    ok: boolean;
    gherkin?: string;
    suggestedSummary?: string;
    acceptanceCriteria?: string[];
    error?: string;
  }>(res);
  if (
    !res.ok ||
    !data.ok ||
    !data.gherkin ||
    data.suggestedSummary === undefined ||
    !Array.isArray(data.acceptanceCriteria)
  ) {
    throw new Error(data.error || `Generate failed (${res.status})`);
  }
  return {
    gherkin: data.gherkin,
    suggestedSummary: data.suggestedSummary,
    acceptanceCriteria: data.acceptanceCriteria,
  };
}

export async function getIssueForRefine(key: string): Promise<JiraIssueForRefine> {
  const res = await fetch(
    `${base}/api/jira/issue/${encodeURIComponent(key)}/refine`
  );
  const data = await parseJson<{
    ok: boolean;
    issue?: JiraIssueForRefine;
    error?: string;
  }>(res);
  if (!res.ok || !data.ok || !data.issue) {
    throw new Error(data.error || `Load issue failed (${res.status})`);
  }
  return data.issue;
}

export async function updateIssueDescription(
  key: string,
  description: string,
  acceptanceCriteria?: string
): Promise<void> {
  const res = await fetch(
    `${base}/api/jira/issue/${encodeURIComponent(key)}/description`,
    {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        description,
        ...(acceptanceCriteria !== undefined ? { acceptanceCriteria } : {}),
      }),
    }
  );
  const data = await parseJson<{ ok: boolean; error?: string }>(res);
  if (!res.ok || !data.ok) {
    throw new Error(data.error || `Update description failed (${res.status})`);
  }
}

export async function createStory(params: {
  parentKey: string;
  summary: string;
  description: string;
  acceptanceCriteria?: string;
}): Promise<JiraCreateStoryResult> {
  const res = await fetch(`${base}/api/jira/stories`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(params),
  });
  const data = await parseJson<{
    ok: boolean;
    issue?: JiraCreateStoryResult;
    error?: string;
  }>(res);
  if (!res.ok || !data.ok || !data.issue) {
    throw new Error(data.error || `Create story failed (${res.status})`);
  }
  return data.issue;
}
