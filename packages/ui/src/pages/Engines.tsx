import { Database, Key, Globe, FileKey, Zap } from "lucide-react";
import { useNavigate } from "react-router-dom";

const ENGINES = [
  {
    icon: Key,
    name: "KV Store",
    path: "secret/",
    status: "active",
    description: "Arbitrary key/value pairs. Versioned and encrypted.",
    color: "text-vault-accent",
    bg: "bg-vault-accent/10",
  },
  {
    icon: Globe,
    name: "SSH Keys",
    path: "ssh/",
    status: "active",
    description: "Store SSH keypairs. Sign challenges via Trezor.",
    color: "text-vault-green",
    bg: "bg-vault-green/10",
  },
  {
    icon: FileKey,
    name: "PKI / Certificates",
    path: "pki/",
    status: "active",
    description: "Certificate issuance signed by Trezor-held CA key.",
    color: "text-vault-yellow",
    bg: "bg-vault-yellow/10",
  },
  {
    icon: Zap,
    name: "API Keys",
    path: "apikey/",
    status: "active",
    description: "API key storage with auto-rotation webhook hooks.",
    color: "text-vault-purple",
    bg: "bg-vault-purple/10",
  },
];

export function EnginesPage() {
  const navigate = useNavigate();

  return (
    <div className="flex-1 overflow-y-auto">
      <div className="px-6 py-5 border-b border-vault-border">
        <h2 className="text-lg font-semibold text-vault-text flex items-center gap-2">
          <Database className="w-5 h-5 text-vault-accent" />
          Secret Engines
        </h2>
        <p className="text-sm text-vault-muted mt-1">Available secret storage engines</p>
      </div>

      <div className="max-w-3xl mx-auto px-6 py-8 grid grid-cols-1 sm:grid-cols-2 gap-4">
        {ENGINES.map((engine) => {
          const Icon = engine.icon;
          return (
            <div
              key={engine.name}
              onClick={() => navigate(`/secrets?prefix=${encodeURIComponent(engine.path)}`)}
              className="vault-card transition-all hover:border-vault-accent cursor-pointer"
            >
              <div className="flex items-start gap-4">
                <div className={`w-10 h-10 rounded-lg ${engine.bg} flex items-center justify-center shrink-0`}>
                  <Icon className={`w-5 h-5 ${engine.color}`} />
                </div>
                <div className="flex-1">
                  <div className="flex items-center gap-2 mb-1">
                    <span className="text-sm font-medium text-vault-text">{engine.name}</span>
                    <span className="vault-badge vault-badge-green">{engine.status}</span>
                  </div>
                  <code className="text-xs text-vault-accent font-mono">{engine.path}</code>
                  <p className="text-xs text-vault-muted mt-1.5 leading-relaxed">
                    {engine.description}
                  </p>
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
