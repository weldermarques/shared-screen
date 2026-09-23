import { supabaseConfigured } from './lib/supabase'
import { Home } from './pages/Home'
import { Host } from './pages/Host'
import { Viewer } from './pages/Viewer'
import { usePathname } from './router'

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
  if (room) return <Viewer key={room[1]} code={room[1].toUpperCase()} />
  if (path === '/host') return <Host />
  return <Home />
}
