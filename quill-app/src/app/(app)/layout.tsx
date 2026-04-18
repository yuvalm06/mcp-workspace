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
        <div className="app-body">
          <Sidebar />
          <div className="app-content">
            {children}
          </div>
        </div>
        <RoutinesModal />
      </RoutineProvider>
    </NotifProvider>
    </UserProvider>
  )
}
