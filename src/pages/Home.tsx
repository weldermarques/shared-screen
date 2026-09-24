import { useState, type FormEvent } from 'react'
import { randomCode } from '../lib/rtc'
import { navigate } from '../router'

const DESKTOP_DOWNLOAD_URL =
  'https://github.com/weldermarques/shared-screen-desktop/releases/latest/download/SharedScreen-Setup.exe'

export function Home() {
  const [code, setCode] = useState('')

  function watch(e: FormEvent) {
    e.preventDefault()
    const clean = code.trim().toUpperCase().replace(/[^A-Z0-9]/g, '')
    if (clean) navigate(`/r/${clean}`)
  }

  return (
    <main className="page center">
      <div className="hero">
        <h1>🖥️ Shared Screen</h1>
        <p className="muted">Salas com voz e compartilhamento de tela, direto do navegador. Sem instalar nada, sem criar conta.</p>
      </div>

      <div className="home-grid">
        <div className="card">
          <h2>Criar uma sala</h2>
          <p className="muted">Gera um link para chamar as pessoas. Na sala, todos conversam por voz e qualquer um pode compartilhar a tela.</p>
          <button className="btn big" onClick={() => navigate(`/r/${randomCode()}`)}>Criar sala</button>
        </div>

        <form className="card" onSubmit={watch}>
          <h2>Entrar numa sala</h2>
          <p className="muted">Digite o código da sala (ou abra o link que recebeu).</p>
          <input
            className="code-input"
            placeholder="EX: K7P2QX"
            value={code}
            maxLength={12}
            onChange={(e) => setCode(e.target.value.toUpperCase())}
          />
          <button className="btn big secondary" type="submit" disabled={!code.trim()}>Entrar</button>
        </form>
      </div>

      <a className="download" href={DESKTOP_DOWNLOAD_URL}>
        <span className="download-icon" aria-hidden>⬇</span>
        <span>
          <strong>Baixar app para Windows</strong>
          <small>Transmite o áudio do PC em qualquer modo · Windows 10/11</small>
        </span>
      </a>

      <p className="hint">A transmissão é ponto a ponto (WebRTC): o vídeo vai direto para quem assiste.</p>
    </main>
  )
}
