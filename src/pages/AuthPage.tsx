import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { ShieldCheck, LogOut, User, Globe, Loader2 } from "lucide-react";
import { ipc } from "@/lib/ipc";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/components/ui/toaster";
import { useAppStore } from "@/stores/app";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Card } from "@/components/ui/card";

const COUNTRIES = [
  { code: "us", name: "United States" },
  { code: "cn", name: "China" },
  { code: "jp", name: "Japan" },
  { code: "gb", name: "United Kingdom" },
  { code: "de", name: "Germany" },
  { code: "fr", name: "France" },
  { code: "kr", name: "South Korea" },
  { code: "ca", name: "Canada" },
  { code: "au", name: "Australia" },
  { code: "hk", name: "Hong Kong" },
  { code: "tw", name: "Taiwan" },
  { code: "sg", name: "Singapore" },
];

export function AuthPage() {
  const settings = useAppStore((s) => s.settings);
  const authed = useAppStore((s) => s.authed);
  const setAuthed = useAppStore((s) => s.setAuthed);
  const toast = useToast().toast;

  const [email, setEmail] = useState(settings?.email ?? "");
  const [password, setPassword] = useState("");
  const [country, setCountry] = useState(settings?.country ?? "us");
  const [submitting, setSubmitting] = useState(false);
  const [show2fa, setShow2fa] = useState(false);
  const [code, setCode] = useState("");

  const account = useQuery({
    queryKey: ["auth", "account", authed],
    queryFn: () => ipc.authAccount(),
    enabled: authed,
    retry: false,
  });

  // Persist the email & country back into settings when changed.
  useEffect(() => {
    if (!settings) return;
    if (email !== settings.email || country !== settings.country) {
      const next = { ...settings, email, country };
      ipc.setSettings(next).then(() => useAppStore.getState().setSettings(next));
    }
  }, [email, country, settings]);

  async function doLogin() {
    if (!email || !password) {
      toast({
        title: "Missing fields",
        description: "Apple ID and password are required.",
        variant: "destructive",
      });
      return;
    }
    setSubmitting(true);
    try {
      const r = await ipc.authLogin(email, password, country);
      if (r.needs_2fa) {
        setShow2fa(true);
        toast({
          title: "2FA code required",
          description: "Enter the 6-digit code sent to your trusted device.",
        });
      } else if (r.exit_code === 0) {
        setAuthed(true);
        toast({ title: "Signed in", variant: "success" });
        setPassword("");
        account.refetch();
      } else {
        toast({
          title: "Login failed",
          description: r.stderr || r.stdout || "Check your credentials.",
          variant: "destructive",
        });
      }
    } catch (e) {
      toast({
        title: "Login error",
        description: String(e),
        variant: "destructive",
      });
    } finally {
      setSubmitting(false);
    }
  }

  async function doVerify2fa() {
    setSubmitting(true);
    try {
      const r = await ipc.auth2fa(email, password, country, code);
      if (r.exit_code === 0) {
        setShow2fa(false);
        setAuthed(true);
        setPassword("");
        setCode("");
        toast({ title: "Signed in", variant: "success" });
        account.refetch();
      } else {
        toast({
          title: "Verification failed",
          description: r.stderr || r.stdout || "Wrong code, try again.",
          variant: "destructive",
        });
      }
    } finally {
      setSubmitting(false);
    }
  }

  async function doLogout() {
    try {
      await ipc.authLogout();
      setAuthed(false);
      toast({ title: "Signed out" });
    } catch (e) {
      toast({
        title: "Logout failed",
        description: String(e),
        variant: "destructive",
      });
    }
  }

  return (
    <div className="space-y-6 animate-fade-in">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Account</h1>
        <p className="text-sm text-muted-foreground">
          Sign in with your Apple ID to download IPA packages from the App Store.
        </p>
      </div>

      <Card>
        <div className="space-y-5 p-6">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <ShieldCheck className="h-5 w-5 text-primary" />
              <h2 className="text-lg font-medium">Status</h2>
            </div>
            <Badge variant={authed ? "success" : "warning"}>
              {authed ? "Signed in" : "Not signed in"}
            </Badge>
          </div>

          {authed && account.data ? (
            <div className="grid gap-3 sm:grid-cols-2">
              <InfoRow label="Name" value={(account.data as { name?: string })?.name ?? "—"} />
              <InfoRow label="Email" value={(account.data as { email?: string })?.email ?? email} />
              <InfoRow
                label="Country"
                value={COUNTRIES.find((c) => c.code === country)?.name ?? country}
              />
              <InfoRow
                label="Account type"
                value={(account.data as { account_kind?: string })?.account_kind ?? "—"}
              />
              <Button variant="destructive" onClick={doLogout} className="sm:col-span-2">
                <LogOut className="h-4 w-4" /> Sign out
              </Button>
            </div>
          ) : authed ? (
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" /> Loading account info…
            </div>
          ) : (
            <div className="grid gap-4">
              <div className="grid gap-1.5">
                <Label htmlFor="email">Apple ID (email)</Label>
                <Input
                  id="email"
                  type="email"
                  placeholder="you@example.com"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  autoComplete="email"
                  spellCheck={false}
                />
              </div>
              <div className="grid gap-1.5">
                <Label htmlFor="password">Password</Label>
                <Input
                  id="password"
                  type="password"
                  placeholder="••••••••"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  autoComplete="current-password"
                  onKeyDown={(e) => {
                    if (e.key === "Enter") doLogin();
                  }}
                />
              </div>
              <div className="grid gap-1.5">
                <Label htmlFor="country">Country / Region</Label>
                <div className="flex items-center gap-2">
                  <Globe className="h-4 w-4 text-muted-foreground" />
                  <select
                    id="country"
                    value={country}
                    onChange={(e) => setCountry(e.target.value)}
                    className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  >
                    {COUNTRIES.map((c) => (
                      <option key={c.code} value={c.code} className="bg-card">
                        {c.name} ({c.code.toUpperCase()})
                      </option>
                    ))}
                  </select>
                </div>
              </div>
              <Button onClick={doLogin} disabled={submitting}>
                {submitting ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <User className="h-4 w-4" />
                )}
                {submitting ? "Signing in…" : "Sign in"}
              </Button>
            </div>
          )}
        </div>
      </Card>

      <Card>
        <div className="p-6 space-y-3">
          <h3 className="text-sm font-semibold">Security notes</h3>
          <ul className="list-disc space-y-1 pl-4 text-xs text-muted-foreground">
            <li>
              Credentials are forwarded directly to the <code>ipatool</code> CLI
              on this machine — they are never logged or sent to any third party
              by ipatool-gui.
            </li>
            <li>
              If 2FA is enabled on your Apple ID, you will be prompted for a
              6-digit code after pressing Sign in.
            </li>
            <li>
              The auth token is stored by <code>ipatool</code> in its default
              keychain / credential store. To revoke access, sign out here and
              remove the device from your Apple ID settings page.
            </li>
          </ul>
        </div>
      </Card>

      {/* 2FA dialog */}
      <Dialog open={show2fa} onOpenChange={setShow2fa}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Two-factor authentication</DialogTitle>
            <DialogDescription>
              Enter the 6-digit verification code sent to your trusted Apple
              device.
            </DialogDescription>
          </DialogHeader>
          <Input
            placeholder="123456"
            value={code}
            onChange={(e) => setCode(e.target.value.replace(/\D/g, "").slice(0, 6))}
            className="text-center text-lg tracking-[0.4em]"
            autoFocus
            onKeyDown={(e) => {
              if (e.key === "Enter") doVerify2fa();
            }}
          />
          <DialogFooter>
            <Button variant="outline" onClick={() => setShow2fa(false)}>
              Cancel
            </Button>
            <Button onClick={doVerify2fa} disabled={submitting || code.length !== 6}>
              {submitting ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
              Verify
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function InfoRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-border bg-muted/30 px-3 py-2">
      <div className="text-[10px] uppercase tracking-wider text-muted-foreground">
        {label}
      </div>
      <div className="text-sm font-medium">{value}</div>
    </div>
  );
}
