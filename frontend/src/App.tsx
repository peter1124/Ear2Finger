import { BrowserRouter as Router, Routes, Route, Navigate } from 'react-router-dom'
import Workspace from './components/Workspace'
import Dashboard from './components/Dashboard'
import Settings from './components/Settings'
import YouTubeProcessor from './components/YouTubeProcessor'

function App() {
  return (
    <Router>
      <Routes>
        <Route path="/workspace" element={<Workspace />} />
        <Route path="/dashboard" element={<Dashboard />} />
        <Route path="/settings" element={<Settings />} />
        <Route path="/youtube" element={<YouTubeProcessor />} />
        <Route path="/" element={<Navigate to="/workspace" replace />} />
      </Routes>
    </Router>
  )
}

export default App
