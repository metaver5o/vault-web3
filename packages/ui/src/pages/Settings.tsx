import { useState } from "react";
import { Settings as SettingsIcon, CheckCircle, ExternalLink, Wifi, WifiOff, AlertCircle } from "lucide-react";
import { QuantumSeedField } from "../components/QuantumSeedField.tsx";
import { loadConfig, saveConfig, type UIConfig } from "../store/config.ts";
import { checkQSHaaSStatus } from "@vault-web3/core";

export function SettingsPage() {
  const [cfg, setCfg] = useState<UIConfig>(loadConfig);
  const [saved, setSaved] = useState(false);
  const [qsStatus, setQsStatus] = useState<"idle" | "checking" | "online" | "offline">("idle");

  function update(key: keyof UIConfig, value: unknown) {
    setCfg((c) => ({ ...c, [key]: value }));
  }

  function save() {
    saveConfig(cfg);
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  }

  async function testQSHaaS() {
    setQsStatus("checking");
    const result = await checkQSHaaSStatus({
      apiUrl: cfg.qshaasApiUrl,
      apiKey: cfg.qshaasApiKey,
    });
    setQsStatus(result.online ? "online" : "offline");
  }

  return (
    <div className="flex-1 overflow-y-auto">
      <div className="px-6 py-5 border-b border-vault-border">
        <h2 className="text-lg font-semibold text-vault-text flex items-center gap-2">
          <SettingsIcon className="w-5 h-5 text-vault-accent" />
          Settings
        </h2>
      </div>

      <div className="max-w-2xl mx-auto px-6 py-8 space-y-8">
        {/* Network */}
        <section className="space-y-4">
          <h3 className="text-sm font-semibold text-vault-muted uppercase tracking-wider">Network</h3>
          <div className="vault-card space-y-4">
            <Field label="RPC URL" value={cfg.rpcUrl} onChange={(v) => update("rpcUrl", v)}
              placeholder="http://localhost:8545" />
            <Field label="Chain ID" value={String(cfg.chainId)} onChange={(v) => update("chainId", Number(v))}
              placeholder="31337" type="number" />
            {/* Registry Address — highlighted when unconfigured */}
            <div>
              <label className="block text-xs text-vault-muted mb-1.5">Registry Address</label>
              <input
                type="text"
                value={cfg.registryAddress}
                onChange={(e) => update("registryAddress", e.target.value)}
                placeholder="0x…"
                className={`vault-input text-sm font-mono ${cfg.registryAddress === "0x0000000000000000000000000000000000000000"
                    ? "border-vault-yellow/60 focus:border-vault-yellow"
                    : ""
                  }`}
              />
              {cfg.registryAddress === "0x0000000000000000000000000000000000000000" && (
                <p className="flex items-center gap-1.5 mt-1.5 text-xs text-vault-yellow">
                  <AlertCircle className="w-3 h-3 shrink-0" />
                  Paste the deployed VaultRegistry Diamond address here.
                  Deploy it with:{" "}
                  <code className="font-mono bg-vault-bg px-1 rounded">
                    DEPLOYER_PRIVATE_KEY=0x… npx hardhat run scripts/deploy.ts --network polygon
                  </code>
                </p>
              )}
            </div>
          </div>
        </section>

        {/* IPFS */}
        <section className="space-y-4">
          <h3 className="text-sm font-semibold text-vault-muted uppercase tracking-wider">IPFS</h3>
          <div className="vault-card">
            <Field label="IPFS API URL" value={cfg.ipfsApiUrl}
              onChange={(v) => update("ipfsApiUrl", v)}
              placeholder="http://localhost:5001" />
          </div>
        </section>

        {/* Vault */}
        <section className="space-y-4">
          <h3 className="text-sm font-semibold text-vault-muted uppercase tracking-wider">Vault</h3>
          <div className="vault-card space-y-4">
            <Field label="Default Namespace" value={cfg.defaultNamespace}
              onChange={(v) => update("defaultNamespace", v)} placeholder="secret" />
            <Field label="Trezor Account Index" value={String(cfg.accountIndex)}
              onChange={(v) => update("accountIndex", Number(v))} type="number" />
          </div>
        </section>

        {/* Quantum Seed */}
        <section className="space-y-4">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-semibold text-vault-muted uppercase tracking-wider">
              Quantum Seed (QSHaaS)
            </h3>
            <a href="https://criptografia.net" target="_blank" rel="noopener noreferrer"
              className="text-xs text-vault-accent hover:underline flex items-center gap-1">
              Get API key <ExternalLink className="w-3 h-3" />
            </a>
          </div>
          <QuantumSeedField
            enabled={cfg.useQuantumSeedByDefault}
            apiKey={cfg.qshaasApiKey}
            apiUrl={cfg.qshaasApiUrl}
            onToggle={(v) => update("useQuantumSeedByDefault", v)}
            onApiKeyChange={(v) => update("qshaasApiKey", v)}
            onApiUrlChange={(v) => update("qshaasApiUrl", v)}
            showUrlField
          />
          <button
            onClick={testQSHaaS}
            disabled={qsStatus === "checking"}
            className="vault-btn-secondary text-sm"
          >
            {qsStatus === "checking" ? (
              <><Wifi className="w-4 h-4 animate-pulse" /> Testing…</>
            ) : qsStatus === "online" ? (
              <><Wifi className="w-4 h-4 text-vault-green" /> Connected</>
            ) : qsStatus === "offline" ? (
              <><WifiOff className="w-4 h-4 text-vault-red" /> Unreachable</>
            ) : (
              <><Wifi className="w-4 h-4" /> Test Connection</>
            )}
          </button>
        </section>

        {/* Save */}
        <button onClick={save} className="vault-btn-primary w-full justify-center py-2.5">
          {saved ? (
            <><CheckCircle className="w-4 h-4" /> Saved — reconnect your wallet to apply</>
          ) : (
            "Save Settings"
          )}
        </button>
      </div>
    </div>
  );
}

function Field({
  label, value, onChange, placeholder, type = "text", mono = false,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  type?: string;
  mono?: boolean;
}) {
  return (
    <div>
      <label className="block text-xs text-vault-muted mb-1.5">{label}</label>
      <input
        type={type}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className={`vault-input text-sm ${mono ? "font-mono" : ""}`}
      />
    </div>
  );
}
