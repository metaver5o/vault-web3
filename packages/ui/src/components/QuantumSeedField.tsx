/**
 * Reusable Quantum Seed toggle + API key input.
 * Used on the Write Secret form and Settings page.
 */

import { ExternalLink, Zap, AlertCircle } from "lucide-react";
import clsx from "clsx";

interface QuantumSeedFieldProps {
  enabled: boolean;
  apiKey: string;
  apiUrl: string;
  onToggle: (enabled: boolean) => void;
  onApiKeyChange: (key: string) => void;
  onApiUrlChange?: (url: string) => void;
  /** Show the URL field (on Settings) or hide it (on Write form — inherits from config) */
  showUrlField?: boolean;
  /** Compact layout for inline use */
  compact?: boolean;
}

export function QuantumSeedField({
  enabled,
  apiKey,
  apiUrl,
  onToggle,
  onApiKeyChange,
  onApiUrlChange,
  showUrlField = false,
  compact = false,
}: QuantumSeedFieldProps) {
  return (
    <div className={clsx(
      "rounded-lg border transition-colors",
      enabled
        ? "border-vault-purple/40 bg-vault-purple/5"
        : "border-vault-border bg-transparent"
    )}>
      {/* Toggle row */}
      <div className="flex items-center justify-between p-4">
        <div className="flex items-center gap-3">
          <div className={clsx(
            "w-8 h-8 rounded-lg flex items-center justify-center transition-colors",
            enabled ? "bg-vault-purple/20" : "bg-vault-border/40"
          )}>
            <Zap className={clsx(
              "w-4 h-4 transition-colors",
              enabled ? "text-vault-purple" : "text-vault-muted"
            )} />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <span className={clsx(
                "text-sm font-medium",
                enabled ? "text-vault-text" : "text-vault-muted"
              )}>
                Quantum Seed
              </span>
              {enabled && (
                <span className="vault-badge-purple text-[10px]">ACTIVE</span>
              )}
            </div>
            {!compact && (
              <p className="text-xs text-vault-muted mt-0.5">
                Mix quantum entropy from{" "}
                <a
                  href="https://criptografia.net"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-vault-accent hover:underline inline-flex items-center gap-1"
                >
                  criptografia.net
                  <ExternalLink className="w-3 h-3" />
                </a>{" "}
                into DEK generation
              </p>
            )}
          </div>
        </div>

        {/* Toggle switch */}
        <button
          type="button"
          role="switch"
          aria-checked={enabled}
          onClick={() => onToggle(!enabled)}
          className={clsx(
            "relative w-11 h-6 rounded-full transition-colors focus:outline-none focus:ring-2 focus:ring-vault-purple/50",
            enabled ? "bg-vault-purple" : "bg-vault-border"
          )}
        >
          <span className={clsx(
            "absolute top-0.5 left-0.5 w-5 h-5 rounded-full bg-white shadow transition-transform",
            enabled ? "translate-x-5" : "translate-x-0"
          )} />
        </button>
      </div>

      {/* API key field — only shown when enabled */}
      {enabled && (
        <div className="px-4 pb-4 space-y-3 border-t border-vault-purple/20 pt-4">
          <div>
            <label className="block text-xs text-vault-muted mb-1.5">
              QSHaaS API Key
              <a
                href="https://criptografia.net"
                target="_blank"
                rel="noopener noreferrer"
                className="ml-2 text-vault-accent hover:underline inline-flex items-center gap-1"
              >
                Get key <ExternalLink className="w-3 h-3" />
              </a>
            </label>
            <input
              type="password"
              value={apiKey}
              onChange={(e) => onApiKeyChange(e.target.value)}
              placeholder="qsh_…"
              className="vault-input font-mono text-xs"
              autoComplete="off"
            />
            {!apiKey && (
              <div className="flex items-center gap-1.5 mt-1.5 text-vault-yellow text-xs">
                <AlertCircle className="w-3.5 h-3.5 shrink-0" />
                API key required — will fall back to CSPRNG without it
              </div>
            )}
          </div>

          {showUrlField && onApiUrlChange && (
            <div>
              <label className="block text-xs text-vault-muted mb-1.5">
                API Endpoint
              </label>
              <input
                type="text"
                value={apiUrl}
                onChange={(e) => onApiUrlChange(e.target.value)}
                placeholder="https://api.criptografia.net"
                className="vault-input font-mono text-xs"
              />
            </div>
          )}

          <p className="text-xs text-vault-muted leading-relaxed">
            Quantum entropy is XOR-mixed with your CSPRNG-derived key.
            If QSHaaS is unreachable, the DEK falls back to CSPRNG — no data loss.
          </p>
        </div>
      )}
    </div>
  );
}
