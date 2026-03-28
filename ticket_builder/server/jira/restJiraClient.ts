import type { IJiraClient } from "./jiraClient.js";
import { adfDocumentToPlainText, plainTextToAdf } from "./adf.js";
import type {
  JiraClientConfig,
  JiraCreateStoryParams,
  JiraCreateStoryResult,
  JiraIssueForRefine,
  JiraIssueSummary,
  JiraSearchParams,
} from "./types.js";

function authHeader(email: string, apiToken: string): string {
  const raw = `${email}:${apiToken}`;
  return `Basic ${Buffer.from(raw, "utf8").toString("base64")}`;
}

function baseUrl(config: JiraClientConfig): string {
  return `${config.siteBaseUrl.replace(/\/$/, "")}/rest/api/3`;
}

interface ParentContext {
  id: string;
  key: string;
  projectKey: string;
  issueTypeName: string;
}

export class RestJiraClient implements IJiraClient {
  constructor(private readonly config: JiraClientConfig) {}

  private async fetchJson<T>(
    path: string,
    init?: RequestInit
  ): Promise<{ ok: boolean; status: number; body: T | { errorMessages?: string[]; errors?: Record<string, unknown> } }> {
    const url = `${baseUrl(this.config)}${path}`;
    const res = await fetch(url, {
      ...init,
      headers: {
        Authorization: authHeader(this.config.email, this.config.apiToken),
        Accept: "application/json",
        "Content-Type": "application/json",
        ...init?.headers,
      },
    });
    const text = await res.text();
    let parsed: unknown;
    try {
      parsed = text ? JSON.parse(text) : {};
    } catch {
      parsed = { errorMessages: [text || `HTTP ${res.status}`] };
    }
    const body = parsed as T | { errorMessages?: string[]; errors?: Record<string, unknown> };
    return { ok: res.ok, status: res.status, body };
  }

  private jqlForQuery(query: string): string {
    const q = query.trim();
    if (!q) return "updated >= -3650d ORDER BY updated DESC";
    const keyPattern = /^[A-Za-z][A-Za-z0-9]*-\d+$/;
    if (keyPattern.test(q)) {
      return `key = "${q.toUpperCase()}"`;
    }
    const escaped = q.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
    return `text ~ "${escaped}" ORDER BY updated DESC`;
  }

  async searchIssues(params: JiraSearchParams): Promise<JiraIssueSummary[]> {
    const maxResults = Math.min(params.maxResults ?? 20, 50);
    const jql = this.jqlForQuery(params.query);
    const { ok, status, body } = await this.fetchJson<{
      issues?: Array<{
        id: string;
        key: string;
        fields?: {
          summary?: string;
          issuetype?: { name?: string };
          status?: { name?: string };
        };
      }>;
      errorMessages?: string[];
    }>(`/search`, {
      method: "POST",
      body: JSON.stringify({
        jql,
        maxResults,
        fields: ["summary", "issuetype", "status"],
      }),
    });

    if (!ok) {
      const err = body as { errorMessages?: string[]; errors?: Record<string, string> };
      const msg =
        err.errorMessages?.join("; ") ||
        Object.values(err.errors || {}).join("; ") ||
        `Jira search failed (${status})`;
      throw new Error(msg);
    }

    const data = body as {
      issues?: Array<{
        id: string;
        key: string;
        fields?: {
          summary?: string;
          issuetype?: { name?: string };
          status?: { name?: string };
        };
      }>;
    };

    return (data.issues ?? []).map((issue) => ({
      id: issue.id,
      key: issue.key,
      summary: issue.fields?.summary ?? "",
      issueType: issue.fields?.issuetype?.name ?? "Unknown",
      status: issue.fields?.status?.name ?? "Unknown",
    }));
  }

  async getIssue(key: string): Promise<JiraIssueSummary | null> {
    const { ok, body } = await this.fetchJson<{
      id: string;
      key: string;
      fields?: {
        summary?: string;
        issuetype?: { name?: string };
        status?: { name?: string };
      };
    }>(`/issue/${encodeURIComponent(key)}?fields=summary,issuetype,status`);

    if (!ok) return null;
    const issue = body as {
      id: string;
      key: string;
      fields?: {
        summary?: string;
        issuetype?: { name?: string };
        status?: { name?: string };
      };
    };
    return {
      id: issue.id,
      key: issue.key,
      summary: issue.fields?.summary ?? "",
      issueType: issue.fields?.issuetype?.name ?? "Unknown",
      status: issue.fields?.status?.name ?? "Unknown",
    };
  }

  private async getParentContext(parentKey: string): Promise<ParentContext | null> {
    const { ok, body } = await this.fetchJson<{
      id?: string;
      key?: string;
      fields?: {
        project?: { key?: string };
        issuetype?: { name?: string };
      };
    }>(`/issue/${encodeURIComponent(parentKey)}?fields=project,issuetype`);

    if (!ok) return null;
    const b = body as {
      id?: string;
      key?: string;
      fields?: {
        project?: { key?: string };
        issuetype?: { name?: string };
      };
    };
    const projectKey = b.fields?.project?.key;
    if (!projectKey || !b.id || !b.key) return null;
    return {
      id: b.id,
      key: b.key,
      projectKey,
      issueTypeName: b.fields?.issuetype?.name ?? "",
    };
  }

  /**
   * Company-managed Jira often links Stories to Epics via "Epic Link", not `parent`.
   */
  private async resolveAcceptanceCriteriaFieldForStory(
    projectKey: string
  ): Promise<{ key: string; meta: { name?: string; schema?: { type?: string } } } | null> {
    const path =
      `/issue/createmeta?projectKeys=${encodeURIComponent(projectKey)}` +
      `&issuetypeNames=${encodeURIComponent("Story")}` +
      `&expand=projects.issuetypes.fields`;
    const { ok, body } = await this.fetchJson<{
      projects?: Array<{
        issuetypes?: Array<{
          fields?: Record<string, { name?: string; schema?: { type?: string } }>;
        }>;
      }>;
    }>(path);
    if (!ok) return null;
    const data = body as {
      projects?: Array<{
        issuetypes?: Array<{
          fields?: Record<string, { name?: string; schema?: { type?: string } }>;
        }>;
      }>;
    };
    const fields = data.projects?.[0]?.issuetypes?.[0]?.fields;
    return this.findAcceptanceCriteriaFieldInMeta(fields);
  }

  private async findEpicLinkFieldKey(projectKey: string): Promise<string | null> {
    const path =
      `/issue/createmeta?projectKeys=${encodeURIComponent(projectKey)}` +
      `&issuetypeNames=${encodeURIComponent("Story")}` +
      `&expand=projects.issuetypes.fields`;
    const { ok, body } = await this.fetchJson<{
      projects?: Array<{
        issuetypes?: Array<{
          fields?: Record<string, { name?: string } | undefined>;
        }>;
      }>;
    }>(path);

    if (!ok) return null;
    const data = body as {
      projects?: Array<{
        issuetypes?: Array<{
          fields?: Record<string, { name?: string } | undefined>;
        }>;
      }>;
    };
    const fields = data.projects?.[0]?.issuetypes?.[0]?.fields;
    if (!fields) return null;

    for (const [fieldKey, meta] of Object.entries(fields)) {
      const name = (meta?.name ?? "").trim().toLowerCase();
      if (name === "epic link") return fieldKey;
    }
    for (const [fieldKey, meta] of Object.entries(fields)) {
      const name = (meta?.name ?? "").toLowerCase();
      if (name.includes("epic") && name.includes("link")) return fieldKey;
    }
    if (fields.customfield_10014) return "customfield_10014";
    return null;
  }

  private matchesAcceptanceCriteriaFieldName(name: string): boolean {
    const n = name.trim().toLowerCase();
    if (!n) return false;
    return n.includes("acceptance") && n.includes("criter");
  }

  private findAcceptanceCriteriaFieldInMeta(
    fields: Record<string, { name?: string; schema?: { type?: string } }> | undefined
  ): { key: string; meta: { name?: string; schema?: { type?: string } } } | null {
    if (!fields) return null;
    if (this.config.acceptanceCriteriaFieldId) {
      const k = this.config.acceptanceCriteriaFieldId;
      const meta = fields[k];
      return { key: k, meta: meta ?? {} };
    }
    for (const [fieldKey, meta] of Object.entries(fields)) {
      const name = (meta?.name ?? "").trim();
      if (this.matchesAcceptanceCriteriaFieldName(name)) {
        return { key: fieldKey, meta: meta ?? {} };
      }
    }
    return null;
  }

  private acceptanceCriteriaMarkdownToJiraValue(
    markdown: string,
    fieldMeta?: { schema?: { type?: string } }
  ): unknown {
    const schemaType = fieldMeta?.schema?.type ?? "";
    if (schemaType === "string") {
      return markdown
        .replace(/\*\*([^*]+)\*\*/g, "$1")
        .trim();
    }
    return plainTextToAdf(markdown);
  }

  private issueFieldValueToEditorPlain(value: unknown): string {
    if (value === null || value === undefined) return "";
    if (typeof value === "string") return value;
    if (typeof value === "object" && (value as { type?: string }).type === "doc") {
      return adfDocumentToPlainText(value);
    }
    return "";
  }

  private formatCreateError(
    status: number,
    body: { errorMessages?: string[]; errors?: Record<string, unknown> }
  ): string {
    const parts: string[] = [];
    if (body.errorMessages?.length) {
      parts.push(body.errorMessages.join("; "));
    }
    if (body.errors && Object.keys(body.errors).length > 0) {
      parts.push(
        Object.entries(body.errors)
          .map(([k, v]) => `${k}: ${typeof v === "string" ? v : JSON.stringify(v)}`)
          .join("; ")
      );
    }
    if (parts.length === 0) {
      parts.push(`HTTP ${status}`);
    }
    return parts.join(" | ");
  }

  projectKeyFromParent(parentKey: string): string {
    const idx = parentKey.lastIndexOf("-");
    if (idx <= 0) {
      throw new Error(`Invalid parent key: ${parentKey}`);
    }
    return parentKey.slice(0, idx).toUpperCase();
  }

  async createStoryUnderParent(
    params: JiraCreateStoryParams
  ): Promise<JiraCreateStoryResult> {
    const ctx = await this.getParentContext(params.parentKey);
    if (!ctx) {
      throw new Error(`Parent issue not found or inaccessible: ${params.parentKey}`);
    }

    const description = plainTextToAdf(params.description);

    const baseFields: Record<string, unknown> = {
      project: { key: ctx.projectKey },
      summary: params.summary.slice(0, 255),
      description,
      issuetype: { name: "Story" },
    };

    const acMarkdown = params.acceptanceCriteria?.trim();
    if (acMarkdown) {
      const acField = await this.resolveAcceptanceCriteriaFieldForStory(ctx.projectKey);
      if (!acField) {
        throw new Error(
          "Could not find an Acceptance Criteria field for Stories in this project. Set JIRA_ACCEPTANCE_CRITERIA_FIELD to your custom field id (e.g. customfield_10017)."
        );
      }
      baseFields[acField.key] = this.acceptanceCriteriaMarkdownToJiraValue(
        acMarkdown,
        acField.meta
      );
    }

    const attempts: Array<{ label: string; fields: Record<string, unknown> }> = [
      { label: "parent.key", fields: { ...baseFields, parent: { key: ctx.key } } },
      { label: "parent.id", fields: { ...baseFields, parent: { id: ctx.id } } },
    ];

    const parentIsEpic = ctx.issueTypeName.trim().toLowerCase() === "epic";
    if (parentIsEpic) {
      const epicField = await this.findEpicLinkFieldKey(ctx.projectKey);
      if (epicField) {
        attempts.push({
          label: `${epicField}=issueKey`,
          fields: { ...baseFields, [epicField]: ctx.key },
        });
        attempts.push({
          label: `${epicField}=issueId`,
          fields: { ...baseFields, [epicField]: ctx.id },
        });
      }
    }

    const errors: string[] = [];
    let lastStatus = 400;

    for (const attempt of attempts) {
      const { ok, status, body } = await this.fetchJson<{
        id?: string;
        key?: string;
        self?: string;
        errorMessages?: string[];
        errors?: Record<string, unknown>;
      }>(`/issue`, {
        method: "POST",
        body: JSON.stringify({ fields: attempt.fields }),
      });
      lastStatus = status;

      if (ok && body && typeof body === "object" && "key" in body && body.key) {
        const created = body as { id: string; key: string; self: string };
        const browseUrl = `${this.config.siteBaseUrl.replace(/\/$/, "")}/browse/${created.key}`;
        return {
          id: created.id,
          key: created.key,
          self: created.self,
          browseUrl,
        };
      }

      const errBody = body as { errorMessages?: string[]; errors?: Record<string, unknown> };
      errors.push(`${attempt.label}: ${this.formatCreateError(status, errBody)}`);
    }

    throw new Error(
      `Jira could not create the Story under ${ctx.key}. Tried: ${attempts.map((a) => a.label).join(", ")}. Details: ${errors.join(" || ")}`
    );
  }

  async getIssueForRefine(issueKey: string): Promise<JiraIssueForRefine | null> {
    const { ok: emOk, body: emBody } = await this.fetchJson<{
      fields?: Record<string, { name?: string; schema?: { type?: string } }>;
    }>(`/issue/${encodeURIComponent(issueKey)}/editmeta`);

    const resolvedAc = emOk
      ? this.findAcceptanceCriteriaFieldInMeta(
          (emBody as { fields?: Record<string, { name?: string; schema?: { type?: string } }> })
            .fields
        )
      : null;

    const fieldList = ["summary", "description", "issuetype", "status", "project"];
    if (resolvedAc) fieldList.push(resolvedAc.key);

    const { ok, body } = await this.fetchJson<{
      id?: string;
      key?: string;
      fields?: Record<string, unknown>;
    }>(`/issue/${encodeURIComponent(issueKey)}?fields=${fieldList.join(",")}`);

    if (!ok) return null;
    const b = body as {
      id: string;
      key: string;
      fields?: Record<string, unknown>;
    };
    if (!b.id || !b.key) return null;

    const rawDesc = b.fields?.description;
    let descriptionPlain = "";
    if (
      rawDesc &&
      typeof rawDesc === "object" &&
      (rawDesc as { type?: string }).type === "doc"
    ) {
      descriptionPlain = adfDocumentToPlainText(rawDesc);
    }

    let acceptanceCriteriaPlain = "";
    if (resolvedAc) {
      const rawAc = b.fields?.[resolvedAc.key];
      acceptanceCriteriaPlain = this.issueFieldValueToEditorPlain(rawAc).trim();
    }

    return {
      key: b.key,
      id: b.id,
      summary: (b.fields?.summary as string | undefined) ?? "",
      issueType:
        (b.fields?.issuetype as { name?: string } | undefined)?.name ?? "Unknown",
      status: (b.fields?.status as { name?: string } | undefined)?.name ?? "Unknown",
      descriptionPlain,
      acceptanceCriteriaPlain,
    };
  }

  async updateIssueDescription(
    issueKey: string,
    description: string,
    options?: { acceptanceCriteria?: string }
  ): Promise<void> {
    const fields: Record<string, unknown> = {
      description: plainTextToAdf(description),
    };

    const acMarkdown = options?.acceptanceCriteria?.trim();
    if (acMarkdown) {
      const { ok: emOk, body: emBody } = await this.fetchJson<{
        fields?: Record<string, { name?: string; schema?: { type?: string } }>;
      }>(`/issue/${encodeURIComponent(issueKey)}/editmeta`);
      if (!emOk) {
        throw new Error(`Could not load edit metadata for ${issueKey}`);
      }
      const resolved = this.findAcceptanceCriteriaFieldInMeta(
        (emBody as { fields?: Record<string, { name?: string; schema?: { type?: string } }> }).fields
      );
      if (!resolved) {
        throw new Error(
          "No Acceptance Criteria field found on this issue. Set JIRA_ACCEPTANCE_CRITERIA_FIELD in .env to your custom field id if discovery fails."
        );
      }
      fields[resolved.key] = this.acceptanceCriteriaMarkdownToJiraValue(
        acMarkdown,
        resolved.meta
      );
    }

    const { ok, status, body } = await this.fetchJson<{
      errorMessages?: string[];
      errors?: Record<string, unknown>;
    }>(`/issue/${encodeURIComponent(issueKey)}`, {
      method: "PUT",
      body: JSON.stringify({ fields }),
    });
    if (ok) return;
    const err = body as { errorMessages?: string[]; errors?: Record<string, unknown> };
    throw new Error(`Update failed (${status}): ${this.formatCreateError(status, err)}`);
  }
}
