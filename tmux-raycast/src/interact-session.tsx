import { Detail, ActionPanel, Action, Icon, Form, useNavigation, showToast, Toast, open } from "@raycast/api";
import { useState, useEffect, useCallback } from "react";
import { execSync, execFileSync } from "child_process";
import { readFileSync, existsSync, mkdirSync, writeFileSync } from "fs";
import { homedir } from "os";
import { join } from "path";

const TMUX = "/opt/homebrew/bin/tmux";
const QUICK_CMD_PATH = join(homedir(), ".config", "tmux-raycast", "quick-commands.json");

function loadQuickCmds(): { name: string; command: string }[] {
  const dir = join(homedir(), ".config", "tmux-raycast");
  if (!existsSync(QUICK_CMD_PATH)) {
    mkdirSync(dir, { recursive: true });
    writeFileSync(QUICK_CMD_PATH, JSON.stringify([
      { name: "git status", command: "git status" },
      { name: "git diff", command: "git diff --stat" },
    ], null, 2));
  }
  try { return JSON.parse(readFileSync(QUICK_CMD_PATH, "utf-8")); } catch { return []; }
}

function SendForm({ name, onSent }: { name: string; onSent: () => void }) {
  const { pop } = useNavigation();
  return (
    <Form
      navigationTitle={`${name} → send`}
      actions={
        <ActionPanel>
          <Action.SubmitForm title="Send" icon={Icon.Terminal} onSubmit={({ cmd }: { cmd: string }) => {
            if (cmd.trim()) {
              try {
                execFileSync(TMUX, ["send-keys", "-t", name, "-l", cmd.trim()]);
                execFileSync(TMUX, ["send-keys", "-t", name, "Enter"]);
              } catch { showToast({ style: Toast.Style.Failure, title: "failed to send" }); }
            }
            pop();
            setTimeout(onSent, 300);
          }} />
        </ActionPanel>
      }
    >
      <Form.TextField id="cmd" title="" placeholder="type a command..." autoFocus />
    </Form>
  );
}

export function InteractSession({ name }: { name: string }) {
  const [output, setOutput] = useState("");

  const refresh = useCallback(() => {
    try {
      const raw = execFileSync(TMUX, ["capture-pane", "-p", "-J", "-t", name, "-S", "-500"], { maxBuffer: 5 * 1024 * 1024 }).toString();
      const lines = raw.split("\n");
      let end = lines.length;
      while (end > 0 && lines[end - 1].trim() === "") end--;
      const trimmed = lines.slice(Math.max(0, end - 150), end);
      trimmed.reverse();
      setOutput(trimmed.join("\n"));
    } catch {
      setOutput("(session ended or not found)");
    }
  }, [name]);

  useEffect(() => {
    refresh();
    const id = setInterval(refresh, 1500);
    return () => clearInterval(id);
  }, [refresh]);

  const send = useCallback((cmd: string) => {
    try {
      execFileSync(TMUX, ["send-keys", "-t", name, "-l", cmd]);
      execFileSync(TMUX, ["send-keys", "-t", name, "Enter"]);
    } catch { showToast({ style: Toast.Style.Failure, title: "failed to send" }); }
    setTimeout(refresh, 300);
  }, [name, refresh]);

  const quickCmds = loadQuickCmds();

  const { body, status } = (() => {
    const lines = output.split("\n");
    let credits = "", time = "", pct = "", completed = "";
    const clean: string[] = [];
    for (const line of lines) {
      const cm = line.match(/Credits:\s*([\d.]+)/);
      const tm = line.match(/Time:\s*(\d+s)/);
      const pm = line.match(/(\d+)%\s*!?>/);
      const dm = line.match(/Completed in ([\d.]+s)/);
      if (cm) credits = cm[1];
      if (tm) time = tm[1];
      if (pm) pct = pm[1] + "%";
      if (dm) completed = dm[1];
      if (cm || tm || pm || dm || /^[▸•]\s/.test(line.trim()) || /^\s*!>\s*$/.test(line)) continue;
      clean.push(line);
    }
    const parts = [pct, credits ? `${credits} credits` : "", time, completed ? `done ${completed}` : ""].filter(Boolean);
    return { body: clean.join("\n"), status: parts.length ? parts.join(" · ") : "" };
  })();

  const md = status ? `*${status}*\n\n---\n\n${body}` : body;

  return (
    <Detail
      navigationTitle={name}
      markdown={md}
      actions={
        <ActionPanel>
          <Action.Push title="Send Command" icon={Icon.Terminal} target={<SendForm name={name} onSent={refresh} />} />
          <Action title="Paste Clipboard" icon={Icon.Clipboard} shortcut={{ modifiers: ["cmd", "shift"], key: "v" }} onAction={() => {
            try { const c = execSync("pbpaste").toString().trim(); if (c) send(c); } catch {/* */}
          }} />
          <Action title="Refresh" icon={Icon.ArrowClockwise} shortcut={{ modifiers: ["cmd"], key: "r" }} onAction={refresh} />
          <Action title="Send Ctrl+C" icon={Icon.XMarkCircle} shortcut={{ modifiers: ["ctrl"], key: "c" }} onAction={() => {
            try { execFileSync(TMUX, ["send-keys", "-t", name, "C-c"]); } catch {/* */}
            setTimeout(refresh, 300);
          }} />
          <Action title="Clear Screen" icon={Icon.Eraser} shortcut={{ modifiers: ["cmd"], key: "k" }} onAction={() => {
            try { execFileSync(TMUX, ["send-keys", "-t", name, "C-l"]); } catch {/* */}
            setTimeout(refresh, 300);
          }} />
          <Action title="Edit Quick Commands" icon={Icon.Pencil} shortcut={{ modifiers: ["cmd"], key: "e" }} onAction={() => open(QUICK_CMD_PATH)} />
          {quickCmds.map((qc, i) => (
            <Action key={i} title={qc.name} icon={Icon.Bolt} onAction={() => send(qc.command)} />
          ))}
        </ActionPanel>
      }
    />
  );
}
