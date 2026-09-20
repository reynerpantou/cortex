import type { Problem } from "./types";

function section(heading: string, body: string | undefined): string {
  if (!body?.trim()) return "";
  return `## ${heading}\n\n${body.trim()}\n\n`;
}

/** The research brief alone, formatted to hand to an external AI/agent. */
export function researchBriefMarkdown(p: Problem): string {
  let md = `# #${p.id} ${p.title}\n\n`;
  if (p.body?.trim()) md += `${p.body.trim()}\n\n`;
  md += section("Context", p.context);
  md += section("Research brief", p.research_brief);
  if (p.evidence?.length) {
    md += `## Evidence\n\n`;
    for (const e of p.evidence) {
      const date = e.noted_at.slice(0, 10);
      md += `- ${e.text}${e.url ? ` ([source](${e.url}))` : ""} — ${date}\n`;
    }
    md += "\n";
  }
  return md.trim() + "\n";
}

/** The whole problem, for a complete standalone .md export. */
export function fullExportMarkdown(p: Problem): string {
  let md = `# #${p.id} ${p.title}\n\n`;
  md += `Status: ${p.status} · Scope: ${p.scope.join(", ")} · Source: ${p.source.join(", ")}`;
  md += p.ai_assisted ? " · AI-assisted\n\n" : "\n\n";
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
  md += section("Research brief", p.research_brief);
  md += section("Findings and decisions", p.findings);

  if (p.related_ids?.length) {
    md += `## Related problems\n\n${p.related_ids.map((id) => `#${id}`).join(", ")}\n\n`;
  }

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
