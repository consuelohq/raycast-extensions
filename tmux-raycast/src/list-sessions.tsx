import { List, ActionPanel, Action, Icon, Color, confirmAlert, showToast, Toast } from "@raycast/api";
import { useExec } from "@raycast/utils";
import { execSync } from "child_process";
import { InteractSession } from "./interact-session";
import NewSession from "./new-session";

const TMUX = "/opt/homebrew/bin/tmux";

interface TmuxSession {
  name: string;
  windows: number;
  attached: boolean;
  created: string;
  activity: number;
  path: string;
}

function parseSessions(output: string): TmuxSession[] {
  return output
    .trim()
    .split("\n")
    .filter(Boolean)
    .map((line) => {
      const [name, windows, attached, created, activity, path] = line.split("|");
      return { name, windows: parseInt(windows, 10), attached: attached === "1", created, activity: parseInt(activity, 10) || 0, path: path || "" };
    });
}

function activityAgo(epoch: number): string {
  const diff = Date.now() - epoch * 1000;
  const secs = Math.floor(diff / 1000);
  if (secs < 60) return `${secs}s ago`;
  const mins = Math.floor(secs / 60);
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

function sessionIcon(s: TmuxSession): { source: Icon; tintColor: Color } {
  if (s.attached) return { source: Icon.Circle, tintColor: Color.Green };
  if (Date.now() - s.activity * 1000 < 300000) return { source: Icon.Circle, tintColor: Color.Yellow };
  return { source: Icon.Circle, tintColor: Color.SecondaryText };
}

function shortPath(p: string): string {
  return p.replace(/^\/Users\/[^/]+/, "~");
}

export default function ListSessions() {
  const { data, isLoading, revalidate } = useExec(
    TMUX,
    ["ls", "-F", "#{session_name}|#{session_windows}|#{?session_attached,1,0}|#{session_created}|#{session_activity}|#{session_path}"],
    { onError: () => {} },
  );

  const sessions = data ? parseSessions(data).sort((a, b) => b.activity - a.activity) : [];

  return (
    <List isLoading={isLoading} searchBarPlaceholder="search sessions...">
      {sessions.map((s) => (
        <List.Item
          key={s.name}
          title={s.name}
          icon={sessionIcon(s)}
          accessories={[
            { text: shortPath(s.path), icon: Icon.Folder },
            { text: activityAgo(s.activity), tooltip: "last activity" },
          ]}
          actions={
            <ActionPanel>
              <Action.Push title="Interact" icon={Icon.Terminal} target={<InteractSession name={s.name} />} />
              <Action
                title="Kill Session"
                icon={Icon.Trash}
                style={Action.Style.Destructive}
                shortcut={{ modifiers: ["ctrl"], key: "x" }}
                onAction={async () => {
                  if (await confirmAlert({ title: `kill "${s.name}"?` })) {
                    try { execSync(`${TMUX} kill-session -t ${s.name}`); } catch {/* */}
                    showToast({ style: Toast.Style.Success, title: `killed ${s.name}` });
                    revalidate();
                  }
                }}
              />
              <Action title="Refresh" icon={Icon.ArrowClockwise} shortcut={{ modifiers: ["cmd"], key: "r" }} onAction={revalidate} />
              <Action.Push title="New Session" icon={Icon.Plus} target={<NewSession />} shortcut={{ modifiers: ["cmd"], key: "n" }} />
            </ActionPanel>
          }
        />
      ))}
      {!isLoading && sessions.length === 0 && <List.EmptyView title="no tmux sessions" description="cmd+n to create one" />}
    </List>
  );
}
