import { useState } from "react";
import { Loader2, Download, ExternalLink, AlertTriangle } from "lucide-react";
import { ipc } from "@/lib/ipc";
import { useAppStore } from "@/stores/app";
import { Button } from "@/components/ui/button";
import { useToast } from "@/components/ui/toaster";

export function IpatoolMissingPage() {
  const setIpatool = useAppStore((s) => s.setIpatool);
  const toast = useToast().toast;
  const [installing, setInstalling] = useState(false);

  async function install() {
    setInstalling(true);
    try {
      const info = await ipc.ipatoolEnsure();
      setIpatool(info);
      toast({
        title: "ipatool installed",
        description: `Version ${info.version}`,
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

  return (
    <div className="flex h-screen flex-col items-center justify-center gap-6 p-8 text-center">
      <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-amber-500/10">
        <AlertTriangle className="h-8 w-8 text-amber-500" />
      </div>
      <div className="max-w-md space-y-2">
        <h1 className="text-2xl font-semibold tracking-tight">ipatool is not installed</h1>
        <p className="text-sm text-muted-foreground">
          ipatool-gui wraps the <code>ipatool</code> command-line tool. To use
          this app, either let us install it from GitHub releases automatically,
          or install it manually with Homebrew / Scoop / Go and relaunch.
        </p>
      </div>
      <div className="flex flex-col gap-2">
        <Button onClick={install} disabled={installing} size="lg">
          {installing ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />}
          {installing ? "Installing…" : "Install automatically"}
        </Button>
        <a
          href="https://github.com/majd/ipatool#installation"
          target="_blank"
          rel="noreferrer"
          className="inline-flex items-center justify-center gap-1 text-xs text-muted-foreground hover:text-foreground"
          onClick={(e) => {
            e.preventDefault();
            ipc.openExternal("https://github.com/majd/ipatool#installation");
          }}
        >
          <ExternalLink className="h-3 w-3" /> Manual install instructions
        </a>
      </div>
    </div>
  );
}
