import { supabaseConfigured } from './lib/supabase'
import { Home } from './pages/Home'
import { Room } from './pages/Room'
import { randomCode } from './lib/rtc'
import { navigate, usePathname } from './router'

export function App() {
  const path = usePathname()

  if (!supabaseConfigured) {
    return (
      <main className="page center">
        <div className="card">
          <h2>Configuração pendente</h2>
          <p className="muted">
            Defina <code>VITE_SUPABASE_URL</code> e <code>VITE_SUPABASE_ANON_KEY</code> no arquivo <code>.env.local</code>{' '}
            (ou nas Environment Variables da Vercel) e reinicie o app.
          </p>
        </div>
      </main>
    )
  }

  const room = path.match(/^\/r\/([A-Za-z0-9]+)\/?$/)
  if (room) return <Room key={room[1]} code={room[1].toUpperCase()} />
  // Link antigo "/host": cria uma sala nova.
  if (path === '/host') {
    queueMicrotask(() => navigate(`/r/${randomCode()}`))
    return null
  }
  return <Home />
}
