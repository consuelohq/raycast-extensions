import { List, ActionPanel, Action, Icon, Form, LocalStorage, showToast, Toast, popToRoot, useNavigation } from "@raycast/api";
import { useState, useEffect } from "react";
import { execSync } from "child_process";

const STORAGE_KEY = "starred-items";

interface StarredItem {
  id: string;
  name: string;
  subtitle?: string;
  deeplink: string; // raycast:// deeplink or app bundle id
  icon?: string;
}

function openDeeplink(link: string) {
  execSync(`open "${link}"`);
}

function AddItem({ onAdd }: { onAdd: () => void }) {
  const { pop } = useNavigation();
  return (
    <Form
      actions={
        <ActionPanel>
          <Action.SubmitForm
            title="Add"
            onSubmit={async (values: { name: string; deeplink: string; subtitle: string }) => {
              const name = values.name.trim();
              const deeplink = values.deeplink.trim();
              if (!name || !deeplink) {
                await showToast({ style: Toast.Style.Failure, title: "name and deeplink required" });
                return;
              }
              const raw = await LocalStorage.getItem<string>(STORAGE_KEY);
              const items: StarredItem[] = raw ? JSON.parse(raw) : [];
              items.push({ id: Date.now().toString(), name, deeplink, subtitle: values.subtitle.trim() || undefined });
              await LocalStorage.setItem(STORAGE_KEY, JSON.stringify(items));
              await showToast({ style: Toast.Style.Success, title: `added ${name}` });
              onAdd();
              pop();
            }}
          />
        </ActionPanel>
      }
    >
      <Form.TextField id="name" title="name" placeholder="voice note" />
      <Form.TextField id="subtitle" title="subtitle" placeholder="recording" />
      <Form.TextField
        id="deeplink"
        title="deeplink"
        placeholder="raycast://extensions/ko/voice-note/voice-note"
        info="raycast:// deeplink for extensions, or an app path like /Applications/Slack.app"
      />
    </Form>
  );
}

export default function Starred() {
  const [items, setItems] = useState<StarredItem[]>([]);
  const [loading, setLoading] = useState(true);

  const load = async () => {
    const raw = await LocalStorage.getItem<string>(STORAGE_KEY);
    setItems(raw ? JSON.parse(raw) : []);
    setLoading(false);
  };

  useEffect(() => { load(); }, []);

  const remove = async (id: string) => {
    const next = items.filter((i) => i.id !== id);
    await LocalStorage.setItem(STORAGE_KEY, JSON.stringify(next));
    setItems(next);
    await showToast({ style: Toast.Style.Success, title: "removed" });
  };

  const moveUp = async (index: number) => {
    if (index === 0) return;
    const next = [...items];
    [next[index - 1], next[index]] = [next[index], next[index - 1]];
    await LocalStorage.setItem(STORAGE_KEY, JSON.stringify(next));
    setItems(next);
  };

  return (
    <List isLoading={loading} searchBarPlaceholder="search starred...">
      {items.map((item, i) => (
        <List.Item
          key={item.id}
          title={item.name}
          subtitle={item.subtitle}
          icon={Icon.Star}
          actions={
            <ActionPanel>
              <Action title="Open" icon={Icon.ArrowRight} onAction={() => openDeeplink(item.deeplink)} />
              <Action title="Move Up" icon={Icon.ArrowUp} shortcut={{ modifiers: ["cmd", "opt"], key: "arrowUp" }} onAction={() => moveUp(i)} />
              <Action
                title="Remove"
                icon={Icon.Trash}
                style={Action.Style.Destructive}
                shortcut={{ modifiers: ["ctrl"], key: "x" }}
                onAction={() => remove(item.id)}
              />
              <Action.Push title="Add New" icon={Icon.Plus} target={<AddItem onAdd={load} />} shortcut={{ modifiers: ["cmd"], key: "n" }} />
            </ActionPanel>
          }
        />
      ))}
      {!loading && items.length === 0 && (
        <List.EmptyView title="no starred items" description="cmd+n to add one" actions={
          <ActionPanel>
            <Action.Push title="Add New" icon={Icon.Plus} target={<AddItem onAdd={load} />} />
          </ActionPanel>
        } />
      )}
    </List>
  );
}
