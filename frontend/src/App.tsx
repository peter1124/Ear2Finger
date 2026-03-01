import { BrowserRouter as Router, Routes, Route, Navigate, Outlet } from 'react-router-dom'
import { AuthProvider } from './contexts/AuthContext'
import { WorkspaceProvider } from './contexts/WorkspaceContext'
import ProtectedRoute from './components/ProtectedRoute'
import Login from './components/Login'
import Register from './components/Register'
import Workspace from './components/Workspace'
import Dashboard from './components/Dashboard'
import Settings from './components/Settings'
import YouTubeProcessor from './components/YouTubeProcessor'

function App() {
  return (
    <Router>
      <AuthProvider>
        <Routes>
          <Route path="/login" element={<Login />} />
          <Route path="/register" element={<Register />} />
          <Route
            path="/"
            element={
              <ProtectedRoute>
                <WorkspaceProvider>
                  <Outlet />
                </WorkspaceProvider>
              </ProtectedRoute>
            }
          >
            <Route index element={<Navigate to="/workspace" replace />} />
            <Route path="workspace" element={<Workspace />} />
            <Route path="dashboard" element={<Dashboard />} />
            <Route path="settings" element={<Settings />} />
            <Route path="youtube" element={<YouTubeProcessor />} />
          </Route>
        </Routes>
      </AuthProvider>
    </Router>
  )
}

export default App
