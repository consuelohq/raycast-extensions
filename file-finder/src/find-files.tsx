import { List, Detail, ActionPanel, Action, Icon, getPreferenceValues } from "@raycast/api";
import { useCachedPromise } from "@raycast/utils";
import { useState } from "react";
import { execSync } from "child_process";
import { readFileSync, statSync } from "fs";
import { basename, dirname, extname, join } from "path";
import { homedir } from "os";

const GIT = "/usr/bin/git";
const FD = "/opt/homebrew/bin/fd";

interface RecentFile {
  path: string;
  repo: string;
  repoName: string;
  timestamp: number;
  relativePath: string;
}

function expandHome(p: string): string {
  return p.replace(/^~/, homedir());
}

function discoverRepos(scanDirs: string[], maxDepth: number): string[] {
  const repos: string[] = [];
  for (const dir of scanDirs) {
    const expanded = expandHome(dir.trim());
    try {
      const out = execSync(`${FD} -td -H --no-ignore --max-depth ${maxDepth} "^\\.git$" "${expanded}"`, {
        timeout: 5000,
      }).toString();
      for (const line of out.trim().split("\n").filter(Boolean)) {
        repos.push(dirname(line));
      }
    } catch {
      /* dir might not exist */
    }
  }
  return repos;
}

function getRecentFiles(repos: string[], limit: number): RecentFile[] {
  const files: RecentFile[] = [];

  for (const repo of repos) {
    try {
      const repoName = basename(repo);
      // limit to 500 most recent log entries per repo to avoid choking on huge repos
      const out = execSync(
        `${GIT} -C "${repo}" log --all --diff-filter=ACMR --pretty=format:'%at' --name-only -500 2>/dev/null`,
        { timeout: 10000 },
      ).toString();

      const lines = out.trim().split("\n");
      let currentTimestamp = 0;
      const seen = new Set<string>();

      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed) continue;
        if (/^\d+$/.test(trimmed)) {
          currentTimestamp = parseInt(trimmed, 10);
          continue;
        }
        if (seen.has(trimmed)) continue;
        seen.add(trimmed);

        const fullPath = join(repo, trimmed);
        try {
          statSync(fullPath);
        } catch {
          continue;
        }

        files.push({ path: fullPath, repo, repoName, timestamp: currentTimestamp, relativePath: trimmed });
      }
    } catch {
      /* skip broken repos */
    }
  }

  // sort by most recent first, dedupe by path (keep most recent)
  files.sort((a, b) => b.timestamp - a.timestamp);
  const deduped: RecentFile[] = [];
  const pathsSeen = new Set<string>();
  for (const f of files) {
    if (pathsSeen.has(f.path)) continue;
    pathsSeen.add(f.path);
    deduped.push(f);
    if (deduped.length >= limit) break;
  }
  return deduped;
}

function filePreview(path: string): string {
  try {
    const content = readFileSync(path, "utf-8");
    const ext = extname(path).slice(1) || "text";
    const lines = content.split("\n").slice(0, 80).join("\n");
    return `\`\`\`${ext}\n${lines}\n\`\`\``;
  } catch {
    return "*unable to read file*";
  }
}

function timeAgo(epoch: number): string {
  const diff = Date.now() - epoch * 1000;
  const mins = Math.floor(diff / 60000);
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

function iconForExt(path: string): Icon {
  const ext = extname(path).slice(1);
  const map: Record<string, Icon> = {
    ts: Icon.Code, tsx: Icon.Code, js: Icon.Code, jsx: Icon.Code,
    py: Icon.Code, rs: Icon.Code, go: Icon.Code,
    json: Icon.Document, yaml: Icon.Document, yml: Icon.Document, toml: Icon.Document,
    md: Icon.Book, mdx: Icon.Book,
    css: Icon.Brush, scss: Icon.Brush,
    sh: Icon.Terminal, bash: Icon.Terminal, zsh: Icon.Terminal,
    sql: Icon.HardDrive,
    html: Icon.Globe,
  };
  return map[ext] ?? Icon.Document;
}

function FileDetail({ file }: { file: RecentFile }) {
  const content = (() => {
    try {
      const raw = readFileSync(file.path, "utf-8");
      const ext = extname(file.path).slice(1);
      const lang = ext || "text";
      // markdown renders natively, code gets fenced blocks
      if (["md", "mdx"].includes(lang)) return raw;
      return `\`\`\`${lang}\n${raw}\n\`\`\``;
    } catch {
      return "*unable to read file*";
    }
  })();

  return (
    <Detail
      markdown={content}
      navigationTitle={file.relativePath}
      metadata={
        <Detail.Metadata>
          <Detail.Metadata.Label title="repo" text={file.repoName} />
          <Detail.Metadata.Label title="path" text={file.relativePath} />
          <Detail.Metadata.Label title="modified" text={timeAgo(file.timestamp)} />
        </Detail.Metadata>
      }
      actions={
        <ActionPanel>
          <Action.Open title="Open in Editor" target={file.path} />
          <Action.ShowInFinder path={file.path} />
          <Action.CopyToClipboard title="Copy Path" content={file.path} shortcut={{ modifiers: ["cmd"], key: "c" }} />
          <Action.OpenWith path={file.path} shortcut={{ modifiers: ["cmd", "shift"], key: "o" }} />
          <Action.Open
            title="Open in Terminal"
            target={dirname(file.path)}
            application="com.apple.Terminal"
            shortcut={{ modifiers: ["cmd"], key: "t" }}
          />
        </ActionPanel>
      }
    />
  );
}

export default function FindFiles() {
  const prefs = getPreferenceValues<{ scanDirs: string; maxDepth: string }>();
  const raw = prefs.scanDirs || `${homedir()}/Dev`;
  const dirs = raw.split(",").map((d) => d.trim()).filter(Boolean);
  const depth = parseInt(prefs.maxDepth, 10) || 2;
  const [repo, setRepo] = useState("all");

  const { data, isLoading } = useCachedPromise(
    () => Promise.resolve(getRecentFiles(discoverRepos(dirs, depth), 200)),
    [],
    { keepPreviousData: true },
  );

  const files = data ?? [];
  const repos = [...new Set(files.map((f) => f.repoName))].sort();
  const filtered = repo === "all" ? files : files.filter((f) => f.repoName === repo);

  return (
    <List
      isLoading={isLoading}
      searchBarPlaceholder="search recent files..."
      searchBarAccessory={
        <List.Dropdown tooltip="repository" value={repo} onChange={setRepo}>
          <List.Dropdown.Item title="all repositories" value="all" />
          <List.Dropdown.Section title="repos">
            {repos.map((r) => (
              <List.Dropdown.Item key={r} title={r} value={r} />
            ))}
          </List.Dropdown.Section>
        </List.Dropdown>
      }
    >
      {filtered.map((f) => (
        <List.Item
          key={f.path}
          title={basename(f.path)}
          subtitle={f.relativePath}
          icon={iconForExt(f.path)}
          keywords={[f.repoName, f.relativePath, ...f.relativePath.split("/")]}
          accessories={[{ text: f.repoName }, { text: timeAgo(f.timestamp) }]}
          actions={
            <ActionPanel>
              <Action.Push title="Preview" icon={Icon.Eye} target={<FileDetail file={f} />} />
              <Action.Open title="Open in Editor" target={f.path} />
              <Action.ShowInFinder path={f.path} />
              <Action.CopyToClipboard title="Copy Path" content={f.path} shortcut={{ modifiers: ["cmd"], key: "c" }} />
              <Action.OpenWith path={f.path} shortcut={{ modifiers: ["cmd", "shift"], key: "o" }} />
              <Action.Open
                title="Open in Terminal"
                target={dirname(f.path)}
                application="com.apple.Terminal"
                shortcut={{ modifiers: ["cmd"], key: "t" }}
              />
            </ActionPanel>
          }
        />
      ))}
      {!isLoading && filtered.length === 0 && (
        <List.EmptyView title="no recent files" description="no git repos found or no recent changes" />
      )}
    </List>
  );
}
