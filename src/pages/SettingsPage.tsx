import { useState } from "react";
import { Save, FolderOpen, Info, RefreshCw, Loader2, Download as DownloadIcon, CheckCircle2 } from "lucide-react";
import { ipc, type Settings as SettingsT, type IpatoolInfo } from "@/lib/ipc";
import { useAppStore } from "@/stores/app";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/components/ui/toaster";
import { open } from "@tauri-apps/plugin-dialog";

const COUNTRIES = [
  "us", "cn", "jp", "gb", "de", "fr", "kr", "ca", "au", "hk", "tw", "sg",
];

export function SettingsPage() {
  const current = useAppStore((s) => s.settings);
  const ipatool = useAppStore((s) => s.ipatool);
  const setSettings = useAppStore((s) => s.setSettings);
  const setIpatool = useAppStore((s) => s.setIpatool);
  const toast = useToast().toast;

  const [draft, setDraft] = useState<SettingsT | null>(current);
  const [saving, setSaving] = useState(false);
  const [installing, setInstalling] = useState(false);

  if (!draft || !current) {
    return (
      <div className="flex items-center justify-center p-12 text-sm text-muted-foreground">
        <Loader2 className="mr-2 h-4 w-4 animate-spin" /> Loading…
      </div>
    );
  }

  function update<K extends keyof SettingsT>(key: K, value: SettingsT[K]) {
    setDraft((d) => (d ? { ...d, [key]: value } : d));
  }

  async function pickDir() {
    try {
      const selected = await open({ directory: true, multiple: false });
      if (typeof selected === "string" && selected) {
        update("download_dir", selected);
      }
    } catch (e) {
      toast({ title: "Could not pick folder", description: String(e), variant: "destructive" });
    }
  }

  async function save() {
    if (!draft) return;
    setSaving(true);
    try {
      await ipc.setSettings(draft);
      setSettings(draft);
      toast({ title: "Settings saved", variant: "success" });
    } catch (e) {
      toast({ title: "Save failed", description: String(e), variant: "destructive" });
    } finally {
      setSaving(false);
    }
  }

  async function ensureIpatool() {
    setInstalling(true);
    try {
      const info = await ipc.ipatoolEnsure();
      setIpatool(info);
      toast({
        title: "ipatool installed",
        description: `Version ${info.version || "unknown"} (${info.found_via}).`,
        variant: "success",
      });
    } catch (e) {
      toast({
        title: "Install failed",
        description: String(e),
        variant: "destructive",
      });
    } finally {
      setInstalling(false);
    }
  }

  async function refresh() {
    const info = await ipc.ipatoolPath();
    setIpatool(info);
  }

  return (
    <div className="space-y-6 animate-fade-in">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Settings</h1>
        <p className="text-sm text-muted-foreground">
          Configure download directory, country, and notifications.
        </p>
      </div>

      {/* ipatool runtime */}
      <section className="glass-card p-6 space-y-3">
        <div className="flex items-center justify-between">
          <h2 className="flex items-center gap-2 text-base font-medium">
            <Info className="h-4 w-4 text-primary" /> ipatool runtime
          </h2>
          <Button variant="ghost" size="icon" onClick={refresh} title="Refresh">
            <RefreshCw className="h-4 w-4" />
          </Button>
        </div>
        <div className="grid gap-2 sm:grid-cols-3 text-sm">
          <Field label="Found via">
            <Badge variant={ipatool?.found_via === "missing" ? "destructive" : "success"}>
              {ipatool?.found_via ?? "—"}
            </Badge>
          </Field>
          <Field label="Version">
            <span className="font-mono">{ipatool?.version || "—"}</span>
          </Field>
          <Field label="Path">
            <span className="truncate font-mono text-xs" title={ipatool?.path || ""}>
              {ipatool?.path || "—"}
            </span>
          </Field>
        </div>
        {ipatool?.found_via === "missing" && (
          <div className="flex items-center gap-2 rounded-md border border-amber-700/40 bg-amber-950/30 p-3 text-sm text-amber-200">
            <Info className="h-4 w-4" />
            ipatool is not installed. Click below to fetch the latest release
            from GitHub automatically.
          </div>
        )}
        <Button onClick={ensureIpatool} disabled={installing}>
          {installing ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : ipatool?.found_via === "missing" ? (
            <DownloadIcon className="h-4 w-4" />
          ) : (
            <CheckCircle2 className="h-4 w-4" />
          )}
          {ipatool?.found_via === "missing"
            ? installing
              ? "Installing…"
              : "Install ipatool"
            : installing
            ? "Reinstalling…"
            : "Reinstall / Update"}
        </Button>
      </section>

      {/* Download prefs */}
      <section className="glass-card p-6 space-y-4">
        <h2 className="text-base font-medium">Downloads</h2>

        <div className="grid gap-2">
          <Label htmlFor="dl">Download directory</Label>
          <div className="flex gap-2">
            <Input
              id="dl"
              value={draft.download_dir}
              onChange={(e) => update("download_dir", e.target.value)}
              placeholder="Leave empty for ipatool default (~/Downloads)"
              className="flex-1"
              spellCheck={false}
            />
            <Button variant="outline" size="icon" onClick={pickDir} title="Browse">
              <FolderOpen className="h-4 w-4" />
            </Button>
          </div>
          <p className="text-xs text-muted-foreground">
            IPA files will be saved here. If empty, ipatool uses its built-in default.
          </p>
        </div>

        <div className="grid gap-2">
          <Label htmlFor="country">Country / Region</Label>
          <select
            id="country"
            value={draft.country}
            onChange={(e) => update("country", e.target.value)}
            className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            {COUNTRIES.map((c) => (
              <option key={c} value={c} className="bg-card">
                {c.toUpperCase()}
              </option>
            ))}
          </select>
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <ToggleRow
            label="Keep history"
            description="Persist a local list of downloaded IPAs."
            checked={draft.keep_history}
            onChange={(v) => update("keep_history", v)}
          />
          <ToggleRow
            label="Notify on finish"
            description="Show a desktop notification when a download completes."
            checked={draft.notify_on_finish}
            onChange={(v) => update("notify_on_finish", v)}
          />
        </div>
      </section>

      <div className="flex justify-end gap-2">
        <Button variant="outline" onClick={() => setDraft(current)}>
          Reset
        </Button>
        <Button onClick={save} disabled={saving}>
          {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
          Save
        </Button>
      </div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="text-[10px] uppercase tracking-wider text-muted-foreground">{label}</div>
      <div className="mt-0.5">{children}</div>
    </div>
  );
}

function ToggleRow({
  label,
  description,
  checked,
  onChange,
}: {
  label: string;
  description: string;
  checked: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <div className="flex items-center justify-between rounded-lg border border-border bg-muted/20 px-3 py-2">
      <div>
        <div className="text-sm font-medium">{label}</div>
        <div className="text-xs text-muted-foreground">{description}</div>
      </div>
      <Switch checked={checked} onCheckedChange={onChange} />
    </div>
  );
}
