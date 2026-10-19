import { NavLink } from "react-router-dom";
import {
  KeyRound, Shield, ScrollText, Users, Settings,
  Database, Zap, ChevronRight, LogOut
} from "lucide-react";
import clsx from "clsx";
import type { SignerState } from "../hooks/useSigner.ts";

interface SidebarProps {
  signerState: SignerState;
  onDisconnect: () => void;
}

const NAV_ITEMS = [
  { to: "/secrets", label: "Secrets", icon: KeyRound },
  { to: "/engines", label: "Secret Engines", icon: Database },
  { to: "/access", label: "Access Control", icon: Users },
  { to: "/audit", label: "Audit Log", icon: ScrollText },
  { to: "/settings", label: "Settings", icon: Settings },
];

export function Sidebar({ signerState, onDisconnect }: SidebarProps) {
  const { address, signerType } = signerState;

  return (
    <aside className="w-60 shrink-0 flex flex-col bg-vault-surface border-r border-vault-border min-h-screen">
      {/* Logo */}
      <div className="flex items-center gap-3 px-5 py-4 border-b border-vault-border">
        <div className="w-8 h-8 rounded-lg bg-vault-accent/20 flex items-center justify-center">
          <Shield className="w-4 h-4 text-vault-accent" />
        </div>
        <div>
          <div className="text-sm font-semibold text-vault-text">vault-web3</div>
          <a
            href="https://www.criptografia.app"
            target="_blank"
            rel="noopener noreferrer"
            className="text-xs font-mono text-vault-neon hover:opacity-80 transition-opacity"
            style={{ textShadow: "0 0 6px #39ff1450" }}
          >
            by CRIPTOGRAFIA
          </a>
        </div>
      </div>

      {/* Nav */}
      <nav className="flex-1 py-4 px-2 space-y-0.5">
        {NAV_ITEMS.map(({ to, label, icon: Icon }) => (
          <NavLink
            key={to}
            to={to}
            className={({ isActive }) =>
              clsx(
                "flex items-center gap-3 px-3 py-2 rounded text-sm transition-colors",
                isActive
                  ? "bg-vault-accent/10 text-vault-accent"
                  : "text-vault-muted hover:text-vault-text hover:bg-vault-border/40"
              )
            }
          >
            <Icon className="w-4 h-4 shrink-0" />
            <span>{label}</span>
          </NavLink>
        ))}
      </nav>

      {/* Signer info */}
      <div className="border-t border-vault-border p-4 space-y-3">
        {address ? (
          <>
            <div className="flex items-center gap-2">
              <div className={clsx(
                "w-2 h-2 rounded-full",
                signerType === "metamask" ? "bg-vault-yellow" : signerType === "yubikey" ? "bg-vault-accent" : "bg-vault-green"
              )} />
              <span className="text-xs text-vault-muted capitalize">{signerType}</span>
            </div>
            <div className="font-mono text-xs text-vault-text truncate" title={address}>
              {address.slice(0, 6)}…{address.slice(-4)}
            </div>
            <button
              onClick={onDisconnect}
              className="flex items-center gap-2 text-xs text-vault-muted hover:text-vault-red transition-colors w-full"
            >
              <LogOut className="w-3.5 h-3.5" />
              Disconnect
            </button>
          </>
        ) : (
          <div className="text-xs text-vault-muted">Not connected</div>
        )}
      </div>
    </aside>
  );
}
