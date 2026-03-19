import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import ReconWorkspace from "./workspaces/ReconWorkspace";
import ExploitWorkspace from "./workspaces/ExploitWorkspace";
import ReportingWorkspace from "./workspaces/ReportingWorkspace";
import ScopeWorkspace from "./workspaces/ScopeWorkspace";
import EvidenceWorkspace from "./workspaces/EvidenceWorkspace";
import SettingsWorkspace from "./workspaces/SettingsWorkspace";
import MainLayout from "./layouts/MainLayout";

export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<Navigate to="/recon" replace />} />
        <Route element={<MainLayout />}>
          <Route path="/recon" element={<ReconWorkspace />} />
          <Route path="/exploit" element={<ExploitWorkspace />} />
          <Route path="/reporting" element={<ReportingWorkspace />} />
          <Route path="/scope" element={<ScopeWorkspace />} />
          <Route path="/evidence" element={<EvidenceWorkspace />} />
          <Route path="/settings" element={<SettingsWorkspace />} />
        </Route>
      </Routes>
    </BrowserRouter>
  );
}
