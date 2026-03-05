import { Form, ActionPanel, Action, showToast, Toast, popToRoot } from "@raycast/api";
import { execSync } from "child_process";

const TMUX = "/opt/homebrew/bin/tmux";

export default function NewSession() {
  return (
    <Form
      actions={
        <ActionPanel>
          <Action.SubmitForm
            title="Create Session"
            onSubmit={(values: { name: string; cwd: string }) => {
              const name = values.name.trim();
              if (!name) {
                showToast({ style: Toast.Style.Failure, title: "name required" });
                return;
              }
              const cwd = values.cwd.trim() || "/Users/kokayi/Dev/opensaas";
              execSync(`${TMUX} new-session -d -s "${name}" -c "${cwd}"`);
              showToast({ style: Toast.Style.Success, title: `created ${name}` });
              popToRoot();
            }}
          />
        </ActionPanel>
      }
    >
      <Form.TextField id="name" title="session name" placeholder="kiro-6" />
      <Form.TextField id="cwd" title="working directory" placeholder="/Users/kokayi/Dev/opensaas" defaultValue="/Users/kokayi/Dev/opensaas" />
    </Form>
  );
}
