import { Detail, ActionPanel, Action, Icon, Color } from "@raycast/api";
import { useCachedPromise } from "@raycast/utils";
import { execSync } from "child_process";

const GH = "/opt/homebrew/bin/gh";

interface Review {
  id: number;
  author: { login: string };
  state: string;
  body: string;
  submittedAt: string;
}

interface Comment {
  id: string;
  author: { login: string };
  body: string;
  createdAt: string;
}

interface Commit {
  oid: string;
  messageHeadline: string;
  committedDate: string;
  authors: { name: string }[];
}

interface Check {
  __typename: string;
  name?: string;
  context?: string;
  conclusion?: string;
  state?: string;
  status?: string;
  workflowName?: string;
  detailsUrl?: string;
}

interface PRData {
  number: number;
  title: string;
  body: string;
  state: string;
  author: { login: string };
  headRefName: string;
  baseRefName: string;
  createdAt: string;
  reviewDecision: string;
  reviews: Review[];
  comments: Comment[];
  commits: Commit[];
  statusCheckRollup: Check[];
}

function fetchPR(repo: string, number: number): PRData {
  const out = execSync(
    `${GH} pr view ${number} --repo ${repo} --json number,title,body,state,author,headRefName,baseRefName,createdAt,reviewDecision,reviews,comments,commits,statusCheckRollup`,
    { timeout: 15000 },
  ).toString();
  return JSON.parse(out);
}

function fetchReviewComments(repo: string, number: number): { path: string; body: string; user: string; line: number | null }[] {
  try {
    const out = execSync(
      `${GH} api repos/${repo}/pulls/${number}/comments --jq '[.[] | {path: .path, body: .body, user: .user.login, line: .original_line}]'`,
      { timeout: 15000 },
    ).toString();
    return JSON.parse(out);
  } catch {
    return [];
  }
}

function checksIcon(conclusion?: string, state?: string): string {
  if (conclusion === "SUCCESS" || state === "SUCCESS") return "✅";
  if (conclusion === "FAILURE" || state === "FAILURE") return "❌";
  if (conclusion === "SKIPPED") return "⏭️";
  return "⏳";
}

function stripHtmlComments(text: string): string {
  return text.replace(/<!--[\s\S]*?-->/g, "").trim();
}

function truncateReview(body: string, maxLen = 8000): string {
  if (body.length <= maxLen) return body;
  return body.substring(0, maxLen) + "\n\n*... truncated (full review on github) ...*";
}

export function PRDetail({ repo, number }: { repo: string; number: number }) {
  const { data, isLoading } = useCachedPromise(
    () => {
      const pr = fetchPR(repo, number);
      const inlineComments = fetchReviewComments(repo, number);
      return { pr, inlineComments };
    },
    [],
    { keepPreviousData: true },
  );

  if (!data) return <Detail isLoading={isLoading} markdown="loading..." />;

  const { pr, inlineComments } = data;
  const checks = pr.statusCheckRollup ?? [];
  const coderabbitReviews = pr.reviews.filter((r) => r.author.login === "coderabbitai[bot]" && r.body.length > 100);
  const otherReviews = pr.reviews.filter((r) => r.author.login !== "coderabbitai[bot]" && r.body.length > 0);
  const coderabbitInline = inlineComments.filter((c) => c.user === "coderabbitai[bot]");
  const humanInline = inlineComments.filter((c) => c.user !== "coderabbitai[bot]");

  const sections: string[] = [];

  // header
  sections.push(`# #${pr.number} ${pr.title}\n`);
  sections.push(`\`${pr.headRefName}\` → \`${pr.baseRefName}\` · ${pr.author.login} · ${pr.state.toLowerCase()}\n`);

  // checks
  if (checks.length) {
    sections.push(`## checks\n`);
    const checkLines = checks
      .filter((c) => c.conclusion !== "SKIPPED")
      .map((c) => {
        const name = c.name || c.context || "unknown";
        const icon = checksIcon(c.conclusion, c.state);
        const workflow = c.workflowName ? ` (${c.workflowName})` : "";
        return `${icon} ${name}${workflow}`;
      });
    sections.push(checkLines.join("\n") + "\n");
  }

  // coderabbit reviews
  if (coderabbitReviews.length) {
    sections.push(`## 🐰 coderabbit reviews (${coderabbitReviews.length})\n`);
    for (const review of coderabbitReviews) {
      const cleaned = stripHtmlComments(review.body);
      sections.push(`---\n\n${truncateReview(cleaned)}\n`);
    }
  }

  // coderabbit inline comments
  if (coderabbitInline.length) {
    sections.push(`## 🐰 coderabbit inline comments (${coderabbitInline.length})\n`);
    for (const c of coderabbitInline.slice(0, 30)) {
      const loc = c.line ? `:${c.line}` : "";
      sections.push(`### \`${c.path}${loc}\`\n\n${truncateReview(c.body, 2000)}\n`);
    }
  }

  // human reviews
  if (otherReviews.length) {
    sections.push(`## reviews\n`);
    for (const review of otherReviews) {
      sections.push(`**${review.author.login}** (${review.state.toLowerCase()})\n\n${review.body}\n`);
    }
  }

  // human inline comments
  if (humanInline.length) {
    sections.push(`## inline comments (${humanInline.length})\n`);
    for (const c of humanInline.slice(0, 20)) {
      const loc = c.line ? `:${c.line}` : "";
      sections.push(`### \`${c.path}${loc}\`\n\n${c.body}\n`);
    }
  }

  // commits
  if (pr.commits.length) {
    sections.push(`## commits (${pr.commits.length})\n`);
    const commitLines = pr.commits
      .slice(-20)
      .map((c) => `- \`${c.oid.substring(0, 7)}\` ${c.messageHeadline}`);
    sections.push(commitLines.join("\n") + "\n");
  }

  // pr body
  const cleanBody = stripHtmlComments(pr.body);
  if (cleanBody.length > 10) {
    sections.push(`## description\n\n${cleanBody}\n`);
  }

  const md = sections.join("\n");

  return (
    <Detail
      isLoading={isLoading}
      markdown={md}
      navigationTitle={`#${pr.number} ${pr.title}`}
      metadata={
        <Detail.Metadata>
          <Detail.Metadata.Label title="author" text={pr.author.login} />
          <Detail.Metadata.Label title="branch" text={pr.headRefName} />
          <Detail.Metadata.Label title="state" text={pr.state.toLowerCase()} />
          <Detail.Metadata.Label title="review" text={pr.reviewDecision || "none"} />
          <Detail.Metadata.Label title="commits" text={`${pr.commits.length}`} />
          <Detail.Metadata.Label title="coderabbit" text={coderabbitReviews.length ? `${coderabbitReviews.length} reviews` : "none"} />
          <Detail.Metadata.Separator />
          {checks.filter((c) => c.conclusion !== "SKIPPED").map((c, i) => (
            <Detail.Metadata.Label
              key={i}
              title={c.name || c.context || "check"}
              text={`${checksIcon(c.conclusion, c.state)} ${(c.conclusion || c.state || "pending").toLowerCase()}`}
            />
          ))}
        </Detail.Metadata>
      }
      actions={
        <ActionPanel>
          <Action.OpenInBrowser url={`https://github.com/${repo}/pull/${number}`} />
          <Action.CopyToClipboard title="Copy PR URL" content={`https://github.com/${repo}/pull/${number}`} shortcut={{ modifiers: ["cmd"], key: "c" }} />
        </ActionPanel>
      }
    />
  );
}
