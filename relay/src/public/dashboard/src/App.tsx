import { Routes, Route, Navigate } from 'react-router-dom'
import Layout from './components/Layout'
import Status from './views/Status'
import LiveStats from './views/LiveStats'
import Services from './views/Services'
import Files from './views/Files'
import Drive from './views/Drive'
import Explore from './views/Explore'
import Network from './views/Network'
import Registry from './views/Registry'
import Torrents from './views/Torrents'
import Settings from './views/Settings'

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
        <Route path="registry" element={<Registry />} />
        <Route path="torrents" element={<Torrents />} />
        <Route path="settings" element={<Settings />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Route>
    </Routes>
  )
}

export default App
