import { createContext, useContext, useState, useEffect, ReactNode, useCallback } from 'react'

interface AuthContextType {
  isAuthenticated: boolean
  password: string
  login: (password: string) => void
  logout: () => void
  getAuthHeaders: () => Record<string, string>
}

const AuthContext = createContext<AuthContextType | undefined>(undefined)

const AUTH_KEY = 'shogun-relay-admin-password'

export function AuthProvider({ children }: { children: ReactNode }) {
  const [password, setPassword] = useState<string>(() => {
    return localStorage.getItem(AUTH_KEY) || ''
  })

  const isAuthenticated = password.length > 0

  // Listen for changes from other tabs/windows
  useEffect(() => {
    const handleStorageChange = (e: StorageEvent) => {
      if (e.key === AUTH_KEY) {
        setPassword(e.newValue || '')
      }
    }
    window.addEventListener('storage', handleStorageChange)
    return () => window.removeEventListener('storage', handleStorageChange)
  }, [])

  const login = useCallback((newPassword: string) => {
    localStorage.setItem(AUTH_KEY, newPassword)
    setPassword(newPassword)
  }, [])

  const logout = useCallback(() => {
    localStorage.removeItem(AUTH_KEY)
    setPassword('')
  }, [])

  const getAuthHeaders = useCallback((): Record<string, string> => {
    if (!password) return {}
    return { 'Authorization': `Bearer ${password}` }
  }, [password])

  return (
    <AuthContext.Provider value={{ isAuthenticated, password, login, logout, getAuthHeaders }}>
      {children}
    </AuthContext.Provider>
  )
}

export function useAuth() {
  const context = useContext(AuthContext)
  if (!context) {
    throw new Error('useAuth must be used within an AuthProvider')
  }
  return context
}
