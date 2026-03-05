import {
  Detail,
  ActionPanel,
  Action,
  Icon,
  getPreferenceValues,
  Clipboard,
  showToast,
  Toast,
  LocalStorage,
  closeMainWindow,
  popToRoot,
} from "@raycast/api";
import { useState, useEffect, useRef, useCallback } from "react";
import { spawn, execSync, ChildProcess } from "child_process";
import { readFileSync, writeFileSync, existsSync, unlinkSync } from "fs";

const WHISPER_STREAM = "/opt/homebrew/bin/whisper-stream";
const TMP_FILE = "/tmp/whisper-live.txt";
const PID_FILE = "/tmp/voice-note.pid";
const LAST_MODE_KEY = "voice-note-last-mode";

const NOISE_RE = /\[BLANK_AUDIO\]|\[ ?Silence ?\]|\[silence\]|\[blank\]|\(silence\)|\(blank\)|\[no audio\]/gi;
const FILLER_LINE = /^(you|um|uh|hmm|oh|ah)\s*[.,]?$/i;

const HALLUCINATIONS = [
  "i'm not a good person", "i'm not gonna die", "thanks for watching",
  "thank you for watching", "subscribe to my channel", "please subscribe",
  "see you in the next video", "like and subscribe", "don't forget to subscribe",
  "i'll see you in the next one", "in the next video", "peace", "thank you.",
];

interface Prefs { whisperModel: string; ollamaModel: string }
type Mode = "raw" | "paste" | "clean" | "tweet" | "research";

const MODE_LABELS: Record<Mode, string> = {
  raw: "raw (copy)", paste: "paste into app", clean: "clean up",
  tweet: "tweet", research: "research prompt",
};

const MODE_PROMPTS: Record<string, string> = {
  tweet: "turn this transcription into a tweet (max 280 chars). make it punchy and engaging. return only the tweet text, nothing else.",
  research: "the user dictated a research topic or question. expand on it: provide key points, relevant context, and actionable next steps. be concise but thorough.",
};

const MODES: Mode[] = ["raw", "paste", "clean", "tweet", "research"];

function supersedes(a: string, b: string): boolean {
  const al = a.toLowerCase().replace(/[^a-z0-9 ]/g, "").trim();
  const bl = b.toLowerCase().replace(/[^a-z0-9 ]/g, "").trim();
  if (al.length < 5) return false;
  if (bl.startsWith(al) || bl.includes(al)) return true;
  const wa = al.split(/\s+/);
  if (wa.length < 3) return bl.includes(al);
  for (let skip = 0; skip <= Math.ceil(wa.length * 0.5); skip++) {
    const suffix = wa.slice(skip).join(" ");
    if (suffix.length > 4 && bl.startsWith(suffix)) return true;
  }
  const wb = bl.split(/\s+/);
  return wa.filter((w) => wb.includes(w)).length >= wa.length * 0.7;
}

function dedup(lines: string[]): string[] {
  if (lines.length < 2) return lines;
  const out: string[] = [];
  for (let i = 0; i < lines.length; i++) {
    if (i < lines.length - 1 && supersedes(lines[i], lines[i + 1])) continue;
    if (out.length > 0 && lines[i].toLowerCase().trim() === out[out.length - 1].toLowerCase().trim()) continue;
    out.push(lines[i]);
  }
  return out;
}

function isHallucination(text: string): boolean {
  const lower = text.toLowerCase().trim();
  return HALLUCINATIONS.some((h) => lower.includes(h));
}

function cleanTranscript(raw: string): string {
  let text = raw.replace(NOISE_RE, "").replace(/\[.*?\]/g, "");
  let lines = text.split("\n").map((l) => l.trim()).filter((l) => l.length > 0 && !FILLER_LINE.test(l));
  lines = lines.filter((l) => !isHallucination(l));
  lines = dedup(lines);
  text = lines.join(" ").toLowerCase();
  text = text.replace(/\.{2,}/g, ".").replace(/\s+\./g, ".").replace(/\.\s*\./g, ".").replace(/\s+/g, " ").trim();
  text = text.replace(/(\.\s*)+$/g, ".").replace(/^\.\s*/, "").trim();
  return text;
}

function programmaticClean(text: string): string {
  let out = text;
  out = out.replace(/\b(um|uh|uh huh|hmm|like,?|you know,?|i mean,?|so,?|okay so,?|yeah,?|i'm sorry,?)\b/gi, "");
  out = out.replace(/\s+/g, " ").replace(/^\s*[,.]/, "").replace(/\s+\./g, ".").replace(/\s+,/g, ",").trim();
  out = out.replace(/(^|[.!?]\s+)([a-z])/g, (_, pre, ch) => pre + ch.toUpperCase());
  return out;
}

function readTranscript(): string {
  try {
    return existsSync(TMP_FILE) ? cleanTranscript(readFileSync(TMP_FILE, "utf-8")) : "";
  } catch { return ""; }
}

function isAlreadyRecording(): boolean {
  if (!existsSync(PID_FILE)) return false;
  try {
    const pid = parseInt(readFileSync(PID_FILE, "utf-8").trim());
    // check if process is alive
    process.kill(pid, 0);
    return true;
  } catch {
    // process dead, clean up stale pid file
    try { unlinkSync(PID_FILE); } catch { /* ok */ }
    return false;
  }
}

function killExistingRecording(): void {
  if (!existsSync(PID_FILE)) return;
  try {
    const pid = parseInt(readFileSync(PID_FILE, "utf-8").trim());
    process.kill(pid, "SIGTERM");
  } catch { /* already dead */ }
  try { unlinkSync(PID_FILE); } catch { /* ok */ }
}

async function processWithOllama(text: string, mode: Mode): Promise<string> {
  const prompt = MODE_PROMPTS[mode];
  if (!prompt) return text;
  const prefs = getPreferenceValues<Prefs>();
  const model = prefs.ollamaModel || "kimi-k2.5:cloud";
  const payload = JSON.stringify({
    model, messages: [{ role: "system", content: prompt }, { role: "user", content: text }], stream: false,
  });
  writeFileSync("/tmp/voice-note-ollama.json", payload);
  const out = execSync("curl -s http://localhost:11434/api/chat -d @/tmp/voice-note-ollama.json", { timeout: 60000 }).toString();
  const parsed = JSON.parse(out);
  if (parsed.error || parsed.StatusCode) throw new Error(parsed.error || parsed.Status || "ollama error");
  const content = parsed?.message?.content;
  if (!content) throw new Error("empty response");
  return content;
}

async function finishRecording(mode: Mode): Promise<void> {
  killExistingRecording();
  await new Promise((r) => setTimeout(r, 500));
  const final = readTranscript();

  if (!final) {
    await showToast(Toast.Style.Failure, "nothing recorded");
    await popToRoot(); await closeMainWindow();
    return;
  }

  let output = final;
  if (mode === "clean") {
    output = programmaticClean(final);
  } else if (mode === "tweet" || mode === "research") {
    try {
      output = await processWithOllama(final, mode);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      await showToast(Toast.Style.Failure, `ai failed, raw copied: ${msg}`);
    }
  }

  if (mode === "paste") {
    await closeMainWindow();
    await new Promise((r) => setTimeout(r, 200));
    await Clipboard.paste(output);
    await showToast(Toast.Style.Success, "pasted");
    await popToRoot();
  } else {
    await Clipboard.copy(output);
    await showToast(Toast.Style.Success, mode === "raw" ? "copied" : `${mode} & copied`);
    await popToRoot(); await closeMainWindow();
  }
}

export default function VoiceNote() {
  const [transcript, setTranscript] = useState("");
  const [recording, setRecording] = useState(false);
  const [ready, setReady] = useState(false);
  const [stopping, setStopping] = useState(false);
  const [result, setResult] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [mode, setMode] = useState<Mode>("raw");
  const proc = useRef<ChildProcess | null>(null);
  const poll = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    LocalStorage.getItem<string>(LAST_MODE_KEY).then((saved) => {
      if (saved && saved in MODE_LABELS) setMode(saved as Mode);
    });
  }, []);

  const updateMode = useCallback((m: Mode) => {
    setMode(m);
    LocalStorage.setItem(LAST_MODE_KEY, m);
  }, []);

  // on mount: if already recording → stop & process. otherwise → start recording.
  useEffect(() => {
    if (isAlreadyRecording()) {
      setStopping(true);
      // load mode first, then finish
      LocalStorage.getItem<string>(LAST_MODE_KEY).then(async (saved) => {
        const m = (saved && saved in MODE_LABELS ? saved : "raw") as Mode;
        await finishRecording(m);
      });
      return;
    }

    // start fresh recording
    const prefs = getPreferenceValues<Prefs>();
    const model = prefs.whisperModel || "/Users/kokayi/Library/Application Support/superwhisper/ggml-small.bin";
    // kill any leftover whisper-stream processes from previous runs
    try { execSync("pkill -f whisper-stream", { stdio: "ignore" }); } catch { /* none running */ }
    try { if (existsSync(TMP_FILE)) unlinkSync(TMP_FILE); } catch { /* ok */ }

    try {
      const child = spawn(WHISPER_STREAM,
        ["-m", model, "-f", TMP_FILE, "--keep-context", "-t", "6", "--step", "2000", "--length", "8000"],
        { stdio: "ignore" });
      proc.current = child;
      setRecording(true);

      // save PID for toggle detection
      if (child.pid) writeFileSync(PID_FILE, String(child.pid));

      child.on("error", (err) => setError(`whisper-stream failed: ${err.message}`));

      poll.current = setInterval(() => {
        if (!existsSync(TMP_FILE)) return;
        if (!ready) setReady(true);
        const text = readTranscript();
        if (text) setTranscript(text);
      }, 300);
    } catch (err: unknown) {
      setError(`failed to start: ${err instanceof Error ? err.message : String(err)}`);
    }

    return () => {
      if (poll.current) clearInterval(poll.current);
      // escape/cancel = kill whisper and clean up
      if (proc.current && proc.current.pid) {
        try { process.kill(proc.current.pid, "SIGTERM"); } catch { /* already dead */ }
      }
      try { if (existsSync(PID_FILE)) unlinkSync(PID_FILE); } catch { /* ok */ }
    };
  }, []);

  const handleStop = useCallback(async () => {
    if (poll.current) clearInterval(poll.current);
    setStopping(true);
    await finishRecording(mode);
  }, [mode]);

  const displayText = (() => {
    if (stopping) return "*processing...*";
    if (!ready) return "*loading model...*";
    if (!transcript) return "";
    const sentences = transcript.split(/(?<=[.!?])\s+/);
    if (sentences.length > 12) return "...\n\n" + sentences.slice(-12).join(" ");
    return transcript;
  })();

  let md: string;
  if (error) { md = `⚠️ ${error}`; }
  else if (result) { md = result; }
  else { md = displayText; }

  return (
    <Detail
      navigationTitle={`voice note — ${MODE_LABELS[mode]}`}
      markdown={md}
      actions={
        <ActionPanel>
          {recording && <Action title="stop & process" icon={Icon.Stop} onAction={handleStop} />}
          {result && (
            <Action title="copy & close" icon={Icon.Clipboard} onAction={async () => {
              await Clipboard.copy(result);
              await popToRoot(); await closeMainWindow();
            }} />
          )}
          {MODES.map((m, i) => (
            <Action
              key={m}
              title={`${m === mode ? "✓ " : ""}${MODE_LABELS[m]}`}
              icon={m === mode ? Icon.CheckCircle : Icon.Circle}
              shortcut={{ modifiers: ["cmd"], key: String(i + 1) as "1" | "2" | "3" | "4" | "5" }}
              onAction={() => updateMode(m)}
            />
          ))}
        </ActionPanel>
      }
    />
  );
}
