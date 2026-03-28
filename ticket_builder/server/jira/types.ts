/** Jira issue shape returned from search / get for parent selection */
export interface JiraIssueSummary {
  key: string;
  id: string;
  summary: string;
  issueType: string;
  status: string;
}

export interface JiraSearchParams {
  query: string;
  maxResults?: number;
}

export interface JiraCreateStoryParams {
  parentKey: string;
  summary: string;
  /** Plain text or Gherkin — converted to ADF for Jira */
  description: string;
  /**
   * Three paragraphs (blank line separated), markdown **bold** for Gherkin keywords only.
   * Stored in the project's Acceptance Criteria custom field when discoverable or when
   * `JIRA_ACCEPTANCE_CRITERIA_FIELD` is set.
   */
  acceptanceCriteria?: string;
}

export interface JiraCreateStoryResult {
  key: string;
  id: string;
  self: string;
  browseUrl: string;
}

/** Issue + plain description for Refine Ticket flow */
export interface JiraIssueForRefine {
  key: string;
  id: string;
  summary: string;
  issueType: string;
  status: string;
  descriptionPlain: string;
  /** Plain + **bold** markers when loaded from ADF; empty if field missing */
  acceptanceCriteriaPlain: string;
}

export interface JiraClientConfig {
  siteBaseUrl: string;
  email: string;
  apiToken: string;
  /** Optional; used by future MCP or OAuth-style adapters */
  cloudId?: string;
  /** Optional custom field id (e.g. customfield_10017) for Acceptance Criteria */
  acceptanceCriteriaFieldId?: string;
}
