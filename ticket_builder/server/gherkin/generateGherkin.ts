/**
 * Deterministic, well-structured Gherkin-style story from free-form input.
 * Keywords use markdown **bold** for the editor; ADF conversion turns them into real bold in Jira.
 * Replace with an LLM behind the same export for richer output.
 */

export interface GherkinGenerationInput {
  rawText: string;
}

export interface GherkinGenerationResult {
  gherkin: string;
  suggestedSummary: string;
}

function nonEmptyLines(text: string): string[] {
  return text
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l.length > 0);
}

function collapseWs(s: string): string {
  return s.replace(/\s+/g, " ").trim();
}

function sentences(text: string): string[] {
  return text
    .split(/(?<=[.!?])\s+/)
    .map((s) => s.trim())
    .filter(Boolean);
}

function clip(s: string, max: number): string {
  const t = s.trim();
  if (t.length <= max) return t;
  return `${t.slice(0, Math.max(0, max - 1))}…`;
}

/** Avoid breaking **…** parsing in the editor / ADF when the source text contains asterisks. */
function plainForEmbedding(s: string): string {
  return s.replace(/\*\*/g, "");
}

export function generateGherkinFromText(input: GherkinGenerationInput): GherkinGenerationResult {
  const raw = input.rawText.trim();
  if (!raw) {
    throw new Error("Input text is empty");
  }

  const lines = nonEmptyLines(raw);
  const featureTitle = lines[0] ?? raw;
  const detailBody = collapseWs(lines.slice(1).join(" "));
  const sens = sentences(raw);
  const restAfterFirst = sens.slice(1);

  const iWant = plainForEmbedding(
    detailBody.length > 0
      ? clip(detailBody, 400)
      : clip(collapseWs(sens[0] ?? featureTitle), 400)
  );

  const soThat = plainForEmbedding(
    restAfterFirst.length > 0
      ? clip(collapseWs(restAfterFirst.join(" ")), 400)
      : "I can proceed knowing the described need is met and the workflow can continue."
  );

  const scenarioTitle = plainForEmbedding(clip(featureTitle, 88));

  const givenClause = plainForEmbedding(
    detailBody.length > 24
      ? clip(detailBody, 300)
      : "the preconditions described in the requirement are in place"
  );

  const gherkin = [
    `Feature: ${plainForEmbedding(featureTitle)}`,
    "",
    "**As a** user",
    `**I want** ${iWant}`,
    `**So that** ${soThat}`,
    "",
    `Scenario: ${scenarioTitle}`,
    "",
    `**Given** ${givenClause}`,
    "**When** the user follows the product flow associated with this requirement",
    "**Then** the system delivers the described behaviour and outcomes",
    "**And** the user can confirm the result through the UI or connected systems",
    "**But** behaviour outside the scope of this requirement remains unchanged",
  ].join("\n");

  const suggestedSummary =
    featureTitle.length <= 120 ? featureTitle : `${featureTitle.slice(0, 117)}…`;

  return { gherkin, suggestedSummary };
}
