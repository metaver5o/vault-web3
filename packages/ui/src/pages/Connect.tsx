import { Shield, Wallet, HardDrive, KeyRound, ExternalLink, AlertCircle, CheckCircle2, XCircle, Loader2 } from "lucide-react";
import { hasRegisteredYubiKey } from "../hooks/useSigner.ts";
import clsx from "clsx";
import { useEffect, useState } from "react";

// ─── Trezor Bridge probe ──────────────────────────────────────────────────────
// Trezor Bridge (trezord) runs on 21325 and exposes simple HTTP endpoints.
// We probe it from the browser to show device status before the user clicks.

interface TrezorBridgeInfo {
  version?: string;
  devices: Array<{ path: string; session?: string; type?: number; label?: string }>;
}

type BridgeStatus = "checking" | "unavailable" | "no-device" | "ready";

async function probeTrezorBridge(): Promise<TrezorBridgeInfo> {
  // Requests go through the Vite proxy (/trezor-bridge → localhost:21325)
  // to avoid Trezor Bridge 3.x CORS restrictions on non-whitelisted origins.
  const infoRes = await fetch("/trezor-bridge/", { method: "POST" });
  const info = await infoRes.json() as { version?: string };

  const enumRes = await fetch("/trezor-bridge/enumerate", { method: "POST" });
  const enumData = await enumRes.json();
  // Bridge 2.x returns a flat array; Bridge 3.x may wrap in { devices: [...] }
  const devices: TrezorBridgeInfo["devices"] = Array.isArray(enumData)
    ? enumData
    : (enumData?.devices ?? []);

  return { version: info.version, devices };
}

function useTrezorBridge() {
  const [status, setStatus] = useState<BridgeStatus>("checking");
  const [info, setInfo] = useState<TrezorBridgeInfo>({ devices: [] });

  useEffect(() => {
    let cancelled = false;

    async function check() {
      try {
        const result = await probeTrezorBridge();
        if (cancelled) return;
        setInfo(result);
        setStatus(result.devices.length > 0 ? "ready" : "no-device");
      } catch {
        if (!cancelled) setStatus("unavailable");
      }
    }

    check();
    // Re-probe every 3s so device plug/unplug is reflected live
    const interval = setInterval(check, 3000);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, []);

  return { status, info };
}

// ─── Component ────────────────────────────────────────────────────────────────

interface ConnectProps {
  onConnectMetaMask: () => void;
  onConnectTrezor: () => void;
  onConnectYubiKey: () => void;
  onForgetYubiKey: () => void;
  connecting: boolean;
  error: string | null;
  howto?: string | null;
  walletAvailable: "metamask" | "other-eip1193" | "none";
}

const YUBIKEY_DOC = "https://github.com/metaver5o/vault-web3/blob/main/docs/yubikey.md";
const webauthnAvailable = () => typeof window !== "undefined" && "PublicKeyCredential" in window && window.isSecureContext;

export function ConnectPage({ onConnectMetaMask, onConnectTrezor, onConnectYubiKey, onForgetYubiKey, connecting, error, howto, walletAvailable }: ConnectProps) {
  const [yubiRegistered, setYubiRegistered] = useState(hasRegisteredYubiKey());
  const yubiUsable = webauthnAvailable() && walletAvailable !== "none";
  const { status: bridgeStatus, info: bridgeInfo } = useTrezorBridge();

  const trezorReady = bridgeStatus === "ready" && !connecting;
  const device = bridgeInfo.devices[0];

  return (
    <div className="min-h-screen bg-vault-bg flex items-center justify-center p-6">
      <div className="w-full max-w-md space-y-8">

        {/* Header */}
        <div className="text-center space-y-3">
          <div className="w-16 h-16 rounded-2xl bg-vault-accent/10 border border-vault-accent/20
                          flex items-center justify-center mx-auto">
            <Shield className="w-8 h-8 text-vault-accent" />
          </div>
          <h1 className="text-2xl font-semibold text-vault-text">vault-web3</h1>
          <a
            href="https://www.criptografia.app"
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1 text-xs font-mono text-vault-neon hover:opacity-80 transition-opacity"
            style={{ textShadow: "0 0 8px #39ff1466" }}
          >
            by CRIPTOGRAFIA <ExternalLink className="w-2.5 h-2.5" />
          </a>
          <p className="text-sm text-vault-muted max-w-sm mx-auto">
            Decentralized secrets vault.<br />
            Choose your signing method to continue.
          </p>
        </div>

        {/* Error */}
        {error && (
          <div id="connect-error" className="flex items-start gap-3 p-4 rounded-lg bg-vault-red/10 border border-vault-red/20">
            <AlertCircle className="w-4 h-4 text-vault-red mt-0.5 shrink-0" />
            <div className="space-y-2">
              <p className="text-sm text-vault-red">{error}</p>
              {howto && howto !== error && (
                <p className="text-xs text-vault-text leading-relaxed"><span className="font-semibold">How to fix: </span>{howto}</p>
              )}
              {howto && (
                <a href={YUBIKEY_DOC} target="_blank" rel="noopener noreferrer" className="text-xs text-vault-accent hover:underline inline-flex items-center gap-1">
                  YubiKey setup guide <ExternalLink className="w-3 h-3" />
                </a>
              )}
            </div>
          </div>
        )}

        {/* Wallet options */}
        <div className="space-y-3">

          {/* ── MetaMask ── */}
          <button
            id="btn-connect-metamask"
            onClick={onConnectMetaMask}
            disabled={connecting || walletAvailable === "none"}
            className={clsx(
              "w-full vault-card text-left transition-all duration-150",
              walletAvailable !== "none"
                ? "hover:border-vault-accent cursor-pointer"
                : "opacity-50 cursor-not-allowed"
            )}
          >
            <div className="flex items-center gap-4">
              <div className="w-10 h-10 rounded-xl bg-vault-yellow/10 flex items-center justify-center shrink-0">
                <Wallet className="w-5 h-5 text-vault-yellow" />
              </div>
              <div className="flex-1">
                <div className="flex items-center gap-2">
                  <span className="text-sm font-medium text-vault-text">
                    {walletAvailable === "metamask" ? "MetaMask" : "Browser Wallet"}
                  </span>
                  {walletAvailable !== "none"
                    ? <span className="vault-badge-green">Detected</span>
                    : <span className="vault-badge-muted">Not found</span>}
                </div>
                <p className="text-xs text-vault-muted mt-0.5">
                  {walletAvailable !== "none"
                    ? "EIP-1193 browser extension — software key custody"
                    : "Install MetaMask or a compatible browser wallet"}
                </p>
              </div>
              {connecting && (
                <Loader2 className="w-4 h-4 text-vault-accent animate-spin shrink-0" />
              )}
            </div>
          </button>

          {/* ── Trezor ── */}
          <button
            id="btn-connect-trezor"
            onClick={onConnectTrezor}
            disabled={!trezorReady}
            className={clsx(
              "w-full vault-card text-left transition-all duration-150",
              trezorReady
                ? "hover:border-vault-green cursor-pointer"
                : "opacity-60 cursor-not-allowed"
            )}
          >
            <div className="flex items-center gap-4">
              <div className="w-10 h-10 rounded-xl bg-vault-green/10 flex items-center justify-center shrink-0">
                <HardDrive className="w-5 h-5 text-vault-green" />
              </div>
              <div className="flex-1">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="text-sm font-medium text-vault-text">Trezor</span>
                  {bridgeStatus === "checking" && (
                    <span className="vault-badge-muted flex items-center gap-1">
                      <Loader2 className="w-2.5 h-2.5 animate-spin" /> Detecting…
                    </span>
                  )}
                  {bridgeStatus === "unavailable" && (
                    <span className="vault-badge-muted flex items-center gap-1">
                      <XCircle className="w-2.5 h-2.5 text-vault-red" /> Bridge offline
                    </span>
                  )}
                  {bridgeStatus === "no-device" && (
                    <span className="vault-badge-muted flex items-center gap-1">
                      <XCircle className="w-2.5 h-2.5 text-vault-yellow" /> No device
                    </span>
                  )}
                  {bridgeStatus === "ready" && (
                    <span className="vault-badge-green flex items-center gap-1">
                      <CheckCircle2 className="w-2.5 h-2.5" /> Ready
                    </span>
                  )}
                  {bridgeInfo.version && (
                    <span className="vault-badge-muted">Bridge v{bridgeInfo.version}</span>
                  )}
                </div>

                {/* Device detail row */}
                {bridgeStatus === "ready" && device && (
                  <p className="text-xs text-vault-green mt-0.5 font-mono">
                    {device.label ? `"${device.label}" ` : ""}
                    path: {device.path}
                    {device.session ? " (in use)" : ""}
                  </p>
                )}
                {bridgeStatus === "unavailable" && (
                  <p className="text-xs text-vault-muted mt-0.5">
                    Install{" "}
                    <a
                      href="https://suite.trezor.io/web/bridge/"
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-vault-accent hover:underline"
                      onClick={(e) => e.stopPropagation()}
                    >
                      Trezor Bridge
                    </a>{" "}
                    and plug in your device
                  </p>
                )}
                {bridgeStatus === "no-device" && (
                  <p className="text-xs text-vault-muted mt-0.5">
                    Bridge running — plug in your Trezor device
                  </p>
                )}
                {bridgeStatus === "checking" && (
                  <p className="text-xs text-vault-muted mt-0.5">
                    Probing localhost:21325…
                  </p>
                )}
              </div>
              {connecting && (
                <Loader2 className="w-4 h-4 text-vault-green animate-spin shrink-0" />
              )}
            </div>
          </button>

          {/* ── YubiKey ── */}
          <button
            id="btn-connect-yubikey"
            onClick={() => { onConnectYubiKey(); setTimeout(() => setYubiRegistered(hasRegisteredYubiKey()), 1500); }}
            disabled={connecting || !yubiUsable}
            className={clsx(
              "w-full vault-card text-left transition-all duration-150",
              yubiUsable ? "hover:border-vault-accent cursor-pointer" : "opacity-60 cursor-not-allowed"
            )}
          >
            <div className="flex items-center gap-4">
              <div className="w-10 h-10 rounded-xl bg-vault-accent/10 flex items-center justify-center shrink-0">
                <KeyRound className="w-5 h-5 text-vault-accent" />
              </div>
              <div className="flex-1">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="text-sm font-medium text-vault-text">YubiKey</span>
                  {!webauthnAvailable()
                    ? <span className="vault-badge-muted flex items-center gap-1"><XCircle className="w-2.5 h-2.5 text-vault-red" /> No WebAuthn here</span>
                    : yubiRegistered
                      ? <span className="vault-badge-green flex items-center gap-1"><CheckCircle2 className="w-2.5 h-2.5" /> Registered</span>
                      : <span className="vault-badge-muted">Not registered</span>}
                  <span className="vault-badge-muted">FIDO2 PRF</span>
                </div>
                <p className="text-xs text-vault-muted mt-0.5">
                  {walletAvailable === "none"
                    ? "Needs a browser wallet too: the YubiKey protects secrets, the wallet signs transactions"
                    : yubiRegistered
                      ? "Touch your key to unlock — a browser wallet signs the on-chain writes"
                      : "First use registers the key (set a FIDO2 PIN first) — "}
                  {!yubiRegistered && walletAvailable !== "none" && (
                    <a href={YUBIKEY_DOC} target="_blank" rel="noopener noreferrer" className="text-vault-accent hover:underline" onClick={(e) => e.stopPropagation()}>setup guide</a>
                  )}
                </p>
              </div>
              {connecting && <Loader2 className="w-4 h-4 text-vault-accent animate-spin shrink-0" />}
            </div>
          </button>
          {yubiRegistered && (
            <button onClick={() => { onForgetYubiKey(); setYubiRegistered(false); }} className="text-xs text-vault-muted hover:text-vault-text -mt-1 ml-1">
              Use a different YubiKey (forget the registered one)
            </button>
          )}
        </div>

        {/* Footer links */}
        <div className="flex items-center justify-center gap-6 text-xs text-vault-muted flex-wrap">
          <a
            href="https://www.criptografia.app"
            target="_blank"
            rel="noopener noreferrer"
            className="hover:opacity-80 flex items-center gap-1 transition-opacity font-mono text-vault-neon"
            style={{ textShadow: "0 0 8px #39ff1466" }}
          >
            CRIPTOGRAFIA <ExternalLink className="w-3 h-3" />
          </a>
          <a
            href="https://github.com/metaver5o/vault-web3"
            target="_blank"
            rel="noopener noreferrer"
            className="hover:text-vault-accent flex items-center gap-1 transition-colors"
          >
            GitHub <ExternalLink className="w-3 h-3" />
          </a>
        </div>
      </div>
    </div>
  );
}
