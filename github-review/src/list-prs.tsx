import { List, ActionPanel, Action, Icon, Color, getPreferenceValues } from "@raycast/api";
import { useCachedPromise } from "@raycast/utils";
import { execSync } from "child_process";
import { PRDetail } from "./pr-detail";

const GH = "/opt/homebrew/bin/gh";

interface PR {
  number: number;
  title: string;
  state: string;
  isDraft: boolean;
  author: { login: string };
  headRefName: string;
  baseRefName: string;
  createdAt: string;
  updatedAt: string;
  url: string;
  labels: { name: string; color: string }[];
  reviewDecision: string;
  statusCheckRollup: Check[];
}

interface Check {
  __typename: string;
  name?: string;
  context?: string;
  conclusion?: string;
  state?: string;
  status?: string;
}

function fetchPRs(repo: string): PR[] {
  const out = execSync(
    `${GH} pr list --repo ${repo} --state all --limit 30 --json number,title,state,isDraft,author,headRefName,baseRefName,createdAt,updatedAt,url,labels,reviewDecision,statusCheckRollup`,
    { timeout: 15000 },
  ).toString();
  return JSON.parse(out);
}

function hasCodeRabbit(pr: PR): boolean {
  return pr.statusCheckRollup?.some(
    (c) => c.name === "CodeRabbit" || c.context === "CodeRabbit" || c.name?.includes("coderabbit"),
  ) ?? false;
}

function checksStatus(pr: PR): { icon: Icon; color: Color; text: string } {
  const checks = pr.statusCheckRollup ?? [];
  if (!checks.length) return { icon: Icon.Circle, color: Color.SecondaryText, text: "no checks" };
  const failed = checks.some((c) => c.conclusion === "FAILURE" || c.state === "FAILURE");
  const pending = checks.some((c) => c.status === "IN_PROGRESS" || c.status === "QUEUED" || c.state === "PENDING");
  if (failed) return { icon: Icon.XMarkCircle, color: Color.Red, text: "failing" };
  if (pending) return { icon: Icon.Clock, color: Color.Yellow, text: "running" };
  return { icon: Icon.CheckCircle, color: Color.Green, text: "passing" };
}

function stateIcon(pr: PR): { source: Icon; tintColor: Color } {
  if (pr.state === "MERGED") return { source: Icon.CheckCircle, tintColor: Color.Purple };
  if (pr.state === "CLOSED") return { source: Icon.XMarkCircle, tintColor: Color.Red };
  if (pr.isDraft) return { source: Icon.Circle, tintColor: Color.SecondaryText };
  return { source: Icon.Circle, tintColor: Color.Green };
}

function timeAgo(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 60) return `${mins}m`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h`;
  return `${Math.floor(hours / 24)}d`;
}

export default function ListPRs() {
  const prefs = getPreferenceValues<{ repos: string }>();
  const repos = prefs.repos.split(",").map((r) => r.trim()).filter(Boolean);
  const [selectedRepo, setSelectedRepo] = React.useState(repos[0]);

  const { data, isLoading, revalidate } = useCachedPromise(() => fetchPRs(selectedRepo), [], {
    keepPreviousData: true,
  });

  const prs = data ?? [];

  return (
    <List
      isLoading={isLoading}
      searchBarPlaceholder="search pull requests..."
      searchBarAccessory={
        repos.length > 1 ? (
          <List.Dropdown tooltip="repository" onChange={setSelectedRepo}>
            {repos.map((r) => (
              <List.Dropdown.Item key={r} title={r} value={r} />
            ))}
          </List.Dropdown>
        ) : undefined
      }
    >
      <List.Section title="open" subtitle={`${prs.filter((p) => p.state === "OPEN").length}`}>
        {prs
          .filter((p) => p.state === "OPEN")
          .map((pr) => (
            <PRItem key={pr.number} pr={pr} repo={selectedRepo} revalidate={revalidate} />
          ))}
      </List.Section>
      <List.Section title="recently closed" subtitle={`${prs.filter((p) => p.state !== "OPEN").length}`}>
        {prs
          .filter((p) => p.state !== "OPEN")
          .slice(0, 10)
          .map((pr) => (
            <PRItem key={pr.number} pr={pr} repo={selectedRepo} revalidate={revalidate} />
          ))}
      </List.Section>
    </List>
  );
}

function PRItem({ pr, repo, revalidate }: { pr: PR; repo: string; revalidate: () => void }) {
  const checks = checksStatus(pr);
  const rabbit = hasCodeRabbit(pr);

  return (
    <List.Item
      title={`#${pr.number} ${pr.title}`}
      subtitle={pr.headRefName}
      icon={stateIcon(pr)}
      accessories={[
        ...(rabbit ? [{ icon: { source: Icon.Stars, tintColor: Color.Orange }, tooltip: "coderabbit reviewed" }] : []),
        ...pr.labels.map((l) => ({ tag: { value: l.name, color: Color.Blue } })),
        { icon: { source: checks.icon, tintColor: checks.color }, tooltip: checks.text },
        { text: timeAgo(pr.updatedAt), tooltip: `updated ${pr.updatedAt}` },
      ]}
      actions={
        <ActionPanel>
          <Action.Push title="View Details" icon={Icon.Eye} target={<PRDetail repo={repo} number={pr.number} />} />
          <Action.OpenInBrowser url={pr.url} shortcut={{ modifiers: ["cmd"], key: "o" }} />
          <Action title="Refresh" icon={Icon.ArrowClockwise} shortcut={{ modifiers: ["cmd"], key: "r" }} onAction={revalidate} />
        </ActionPanel>
      }
    />
  );
}

import React from "react";
