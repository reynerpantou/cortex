import type { Problem } from "./types";

function section(heading: string, body: string | undefined): string {
  if (!body?.trim()) return "";
  return `## ${heading}\n\n${body.trim()}\n\n`;
}

/** The whole problem — every section, used for both the clipboard copy and
 * the file export so the two are never inconsistent with each other. */
export function fullExportMarkdown(p: Problem, relatedTitles: Record<number, string> = {}): string {
  let md = `# #${p.id} ${p.title}\n\n`;
  md += `Status: ${p.status} · Scope: ${p.scope.join(", ")} · Source: ${p.source.join(", ")}\n\n`;
  if (p.body?.trim()) md += `${p.body.trim()}\n\n`;

  md += section("Context", p.context);

  if (p.evidence?.length) {
    md += `## Evidence\n\n`;
    for (const e of p.evidence) {
      const date = e.noted_at.slice(0, 10);
      md += `- ${e.text}${e.url ? ` ([source](${e.url}))` : ""} — ${date}\n`;
    }
    md += "\n";
  }

  md += section("Brainstorming", p.brainstorming);

  if (p.related_ids?.length) {
    md += `## Related problems\n\n`;
    for (const id of p.related_ids) {
      md += `- #${id}${relatedTitles[id] ? ` ${relatedTitles[id]}` : ""}\n`;
    }
    md += "\n";
  }

  md += section("Research brief", p.research_brief);
  md += section("Findings and decisions", p.findings);

  return md.trim() + "\n";
}

export async function copyToClipboard(text: string): Promise<void> {
  await navigator.clipboard.writeText(text);
}

export function downloadMarkdown(filename: string, text: string): void {
  const blob = new Blob([text], { type: "text/markdown;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}
