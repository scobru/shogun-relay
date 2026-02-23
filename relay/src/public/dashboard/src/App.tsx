import { Routes, Route, Navigate } from "react-router-dom";
import Layout from "./components/Layout";
import Status from "./views/Status";
import LiveStats from "./views/LiveStats";
import Services from "./views/Services";
import Files from "./views/Files";
import Drive from "./views/Drive";
import Explore from "./views/Explore";
import Network from "./views/Network";
// Torrents import removed
import Settings from "./views/Settings";
import ApiKeys from "./views/ApiKeys";
import Charts from "./views/Charts";
import ApiDocs from "./views/ApiDocs";
import VisualGraph from "./views/VisualGraph";
import GraphExplorer from "./views/GraphExplorer";

function App() {
  return (
    <Routes>
      <Route path="/" element={<Layout />}>
        <Route index element={<Status />} />
        <Route path="stats" element={<LiveStats />} />
        <Route path="services" element={<Services />} />
        <Route path="files" element={<Files />} />
        <Route path="drive" element={<Drive />} />
        <Route path="explore" element={<Explore />} />
        <Route path="network" element={<Network />} />
        {/* Torrents route removed */}
        <Route path="api-keys" element={<ApiKeys />} />
        <Route path="charts" element={<Charts />} />
        <Route path="visual-graph" element={<VisualGraph />} />
        <Route path="graph-explorer" element={<GraphExplorer />} />
        <Route path="api-docs" element={<ApiDocs />} />

        <Route path="settings" element={<Settings />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Route>
    </Routes>
  );
}

export default App;
