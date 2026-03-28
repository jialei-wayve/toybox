/** Shared API contracts (mirror server responses) */

export interface JiraIssueSummary {
  key: string;
  id: string;
  summary: string;
  issueType: string;
  status: string;
}

export interface JiraIssueForRefine {
  key: string;
  id: string;
  summary: string;
  issueType: string;
  status: string;
  descriptionPlain: string;
  acceptanceCriteriaPlain: string;
}

export interface JiraCreateStoryResult {
  key: string;
  id: string;
  self: string;
  browseUrl: string;
}

export type ApiOk<T> = { ok: true } & T;

export interface ApiErr {
  ok: false;
  error: string;
}
