import { BrowserRouter, Routes, Route } from 'react-router-dom'
import { AuthProvider } from './contexts/AuthContext'
import Layout from './components/Layout'
import ProtectedRoute from './components/ProtectedRoute'
import LazyPage from './components/LazyPage'
import Login from './pages/Login'
import Stations from './pages/Stations'
import StationProfile from './pages/StationProfile'
import './App.css'

const loadImport = () => import('./pages/Import')
const loadAdminUsers = () => import('./pages/AdminUsers')

function App() {
  return (
    <AuthProvider>
      <BrowserRouter>
        <Routes>
          <Route path="/login" element={<Login />} />

          <Route
            element={
              <ProtectedRoute>
                <Layout />
              </ProtectedRoute>
            }
          >
            <Route path="/" element={<Stations />} />
            <Route path="/station/:stationNo" element={<StationProfile />} />
            <Route
              path="/import"
              element={
                <ProtectedRoute requireAdmin>
                  <LazyPage load={loadImport} />
                </ProtectedRoute>
              }
            />
            <Route
              path="/admin/users"
              element={
                <ProtectedRoute requireAdmin>
                  <LazyPage load={loadAdminUsers} />
                </ProtectedRoute>
              }
            />
          </Route>
        </Routes>
      </BrowserRouter>
    </AuthProvider>
  )
}

export default App
