import { Routes, Route, Navigate } from "react-router-dom";
import { useSigner } from "./hooks/useSigner.ts";
import { useVault } from "./hooks/useVault.ts";
import { Sidebar } from "./components/Sidebar.tsx";
import { StatusBar } from "./components/StatusBar.tsx";
import { ConnectPage } from "./pages/Connect.tsx";
import { SecretsExplorer } from "./pages/SecretsExplorer.tsx";
import { WriteSecretPage } from "./pages/WriteSecret.tsx";
import { ReadSecretPage } from "./pages/ReadSecret.tsx";
import { AuditLogPage } from "./pages/AuditLog.tsx";
import { AccessControlPage } from "./pages/AccessControl.tsx";
import { SettingsPage } from "./pages/Settings.tsx";
import { EnginesPage } from "./pages/Engines.tsx";
import { effectiveConfig } from "./store/config.ts";
import { NetworkBar } from "./components/NetworkBar.tsx";

export default function App() {
  const { signer, address, signerType, connecting, error, howto, walletAvailable, chainId,
    connectMetaMask, connectTrezor, connectYubiKey, forgetYubiKey, disconnect } = useSigner();
  const vault = useVault(signer, chainId ?? null);
  const cfg = effectiveConfig(chainId);

  // Not connected — show connect screen
  if (!address) {
    return (
      <ConnectPage
        onConnectMetaMask={connectMetaMask}
        onConnectTrezor={connectTrezor}
        onConnectYubiKey={connectYubiKey}
        onForgetYubiKey={forgetYubiKey}
        connecting={connecting}
        error={error}
        howto={howto}
        walletAvailable={walletAvailable}
      />
    );
  }

  return (
    <div className="flex h-screen overflow-hidden bg-vault-bg">
      <Sidebar
        signerState={{ signer, address, signerType, connecting, error, walletAvailable }}
        onDisconnect={disconnect}
      />
      <div className="flex-1 flex flex-col overflow-hidden">
        <StatusBar address={address} signerType={signerType} chainId={cfg.chainId} />
        <NetworkBar chainId={chainId ?? null} walletBacked={signerType === "metamask" || signerType === "yubikey"} />
        <main className="flex-1 flex overflow-hidden">
          <Routes>
            <Route path="/" element={<Navigate to="/secrets" replace />} />
            <Route path="/secrets" element={<SecretsExplorer vault={vault} />} />
            <Route path="/secrets/write" element={<WriteSecretPage vault={vault} />} />
            <Route path="/secrets/read" element={<ReadSecretPage vault={vault} />} />
            <Route path="/engines" element={<EnginesPage />} />
            <Route path="/access" element={<AccessControlPage vault={vault} />} />
            <Route path="/audit" element={<AuditLogPage vault={vault} />} />
            <Route path="/settings" element={<SettingsPage />} />
            <Route path="*" element={<Navigate to="/secrets" replace />} />
          </Routes>
        </main>
      </div>
    </div>
  );
}
