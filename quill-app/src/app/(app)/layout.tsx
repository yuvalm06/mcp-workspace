import { NotifProvider } from '@/lib/notifContext'
import { RoutineProvider } from '@/lib/routineContext'
import { UserProvider } from '@/lib/userContext'
import Sidebar from '@/components/Sidebar'
import RoutinesModal from '@/components/RoutinesModal'

export default function AppLayout({ children }: { children: React.ReactNode }) {
  return (
    <UserProvider>
    <NotifProvider>
      <RoutineProvider>
        <div style={{ display: 'flex', height: '100vh', overflow: 'hidden' }}>
          <Sidebar />
          <div style={{ flex: 1, overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
            {children}
          </div>
        </div>
        <RoutinesModal />
      </RoutineProvider>
    </NotifProvider>
    </UserProvider>
  )
}
