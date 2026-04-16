'use client'
import { createContext, useContext, useEffect, useState } from 'react'

type UserInfo = { name: string; initials: string; email: string }

const UserContext = createContext<UserInfo>({ name: '', initials: '?', email: '' })

export function UserProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<UserInfo>({ name: '', initials: '?', email: '' })

  useEffect(() => {
    fetch('/api/me')
      .then(r => r.ok ? r.json() : null)
      .then(d => { if (d?.name) setUser(d) })
      .catch(() => {})
  }, [])

  return <UserContext.Provider value={user}>{children}</UserContext.Provider>
}

export function useUser() {
  return useContext(UserContext)
}
