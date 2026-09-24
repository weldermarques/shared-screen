import { useEffect, useRef, useState, type FormEvent } from 'react'
import { VoicePanel } from '../components/VoicePanel'
import { canShareScreen } from '../lib/rtc'
import { useScreen, type ViewerStatus } from '../lib/screen'
import { useVoice } from '../lib/voice'
import { navigate } from '../router'

const STATUS_TEXT: Record<ViewerStatus, string> = {
  connecting: 'Entrando na sala…',
  waiting: 'Ninguém está compartilhando a tela agora.',
  negotiating: 'Conectando à transmissão…',
  watching: '',
  ended: 'Ninguém está compartilhando a tela agora.',
  error: 'Não foi possível conectar à sala.',
}

const MAX_NAME = 24

function load(key: string) {
  try {
    return localStorage.getItem(key) ?? ''
  } catch {
    return ''
  }
}

function save(key: string, value: string) {
  try {
    localStorage.setItem(key, value)
  } catch {}
}

/**
 * A sala: assiste a quem estiver compartilhando, compartilha (um por vez) e conversa por voz.
 * Mesmo comportamento da sala do app desktop (app/ui/room.py).
 */
export function Room({ code }: { code: string }) {
  const [name, setName] = useState(() => load('room-name'))
  const [entered, setEntered] = useState(false)
  const [draft, setDraft] = useState(name)
  const [allowSystemAudio, setAllowSystemAudio] = useState(false)
  const [copied, setCopied] = useState(false)
  const [muted, setMuted] = useState(false)
  const [volume, setVolume] = useState(() => {
    const saved = Number(load('viewer-volume'))
    return Number.isFinite(saved) && saved > 0 ? saved : 1
  })

  const videoRef = useRef<HTMLVideoElement>(null)
  const stageRef = useRef<HTMLDivElement>(null)
  const voice = useVoice(code, name)
  const screen = useScreen(code, videoRef, entered)
  const shareUrl = `${location.origin}/r/${code}`

  useEffect(() => voice.setSharing(screen.sharing), [screen.sharing]) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    const video = videoRef.current
    if (!video || screen.sharing) return
    video.volume = volume
    video.muted = muted
  }, [volume, muted, screen.sharing, screen.status])

  function enter(e: FormEvent) {
    e.preventDefault()
    const clean = draft.trim().slice(0, MAX_NAME)
    if (!clean) return
    save('room-name', clean)
    setName(clean)
    setEntered(true)
    // Este clique libera o áudio e o pedido de microfone. Entra na voz mutado, como no app.
    void voice.join({ muted: true, name: clean })
  }

  function rename() {
    const next = window.prompt('Como você aparece na sala:', name)?.trim().slice(0, MAX_NAME)
    if (next) {
      save('room-name', next)
      setName(next)
    }
  }

  async function copyLink() {
    await navigator.clipboard.writeText(shareUrl)
    setCopied(true)
    setTimeout(() => setCopied(false), 1500)
  }

  function changeVolume(value: number) {
    setVolume(value)
    setMuted(value === 0)
    save('viewer-volume', String(value))
  }

  function toggleMute() {
    if (muted && volume === 0) changeVolume(0.5)
    else setMuted(!muted)
  }

  function fullscreen() {
    const el = stageRef.current
    if (!el) return
    if (document.fullscreenElement) void document.exitFullscreen()
    else void el.requestFullscreen?.()
  }

  if (!entered) {
    return (
      <main className="page center">
        <form className="card join-card" onSubmit={enter}>
          <p className="label">Sala {code}</p>
          <h2>Como você quer aparecer?</h2>
          <input
            autoFocus
            placeholder="Seu nome"
            value={draft}
            maxLength={MAX_NAME}
            onChange={(e) => setDraft(e.target.value)}
          />
          <button className="btn big" type="submit" disabled={!draft.trim()}>Entrar na sala</button>
          <p className="hint">Você entra com o microfone mutado. O navegador vai pedir permissão para usá-lo.</p>
          <button type="button" className="link" onClick={() => navigate('/')}>← Início</button>
        </form>
      </main>
    )
  }

  const watching = screen.status === 'watching' && !screen.sharing
  const volumeIcon = muted || volume === 0 ? '🔇' : volume < 0.5 ? '🔉' : '🔊'
  const shareStatus = screen.sharing
    ? 'Você está compartilhando. Todos na sala estão vendo sua tela.'
    : screen.status === 'watching' || screen.status === 'negotiating'
      ? `${voice.sharer ?? 'Alguém'} está compartilhando agora. Se você compartilhar, passa a ser a sua tela.`
      : 'Ninguém está compartilhando. Clique abaixo para mostrar sua tela para a sala.'

  return (
    <main className="room">
      <section className="room-stage">
        <div className="stage" ref={stageRef} onDoubleClick={fullscreen}>
          <video ref={videoRef} autoPlay playsInline />
          {!watching && !screen.sharing && (
            <div className="overlay">
              {(screen.status === 'connecting' || screen.status === 'negotiating') && <div className="spinner" />}
              <p>{STATUS_TEXT[screen.status]}</p>
            </div>
          )}
        </div>
        <footer className="viewer-bar">
          {screen.sharing ? <span className="badge live">● VOCÊ ESTÁ COMPARTILHANDO</span> : <span />}
          <div className="actions">
            {watching && screen.hasAudio && (
              <div className="volume">
                <span className="muted small">Transmissão</span>
                <button className="btn secondary icon" onClick={toggleMute} title={muted ? 'Ativar som' : 'Silenciar'}>
                  {volumeIcon}
                </button>
                <input
                  type="range"
                  min={0}
                  max={1}
                  step={0.01}
                  value={muted ? 0 : volume}
                  onChange={(e) => changeVolume(Number(e.target.value))}
                  aria-label="Volume da transmissão"
                />
              </div>
            )}
            {(watching || screen.sharing) && (
              <button className="btn secondary" onClick={fullscreen}>⛶ Tela cheia</button>
            )}
          </div>
        </footer>
      </section>

      <aside className="room-side">
        <div className="card">
          <div className="room-title">
            <h2>Sala {code}</h2>
            <button className="link icon-link" onClick={copyLink} title={`Copiar o link da sala: ${shareUrl}`}>
              {copied ? '✅' : '📎'}
            </button>
          </div>

          <p className="label section">Na sala</p>
          <VoicePanel voice={voice} onRename={rename} />
          <p className="hint tight">Use fone de ouvido para não dar eco.</p>

          <p className="label section">Compartilhar a tela</p>
          {!canShareScreen ? (
            <p className="muted small">Compartilhar a tela exige um navegador de computador. Daqui você pode assistir e conversar.</p>
          ) : (
            <>
              <div className="info-box">{shareStatus}</div>
              {!screen.sharing ? (
                <>
                  <label className="check">
                    <input type="checkbox" checked={allowSystemAudio} onChange={(e) => setAllowSystemAudio(e.target.checked)} />
                    <span>
                      Incluir áudio do PC inteiro
                      <small>Só marque se for compartilhar janela/tela e quiser mandar todo o som do computador.</small>
                    </span>
                  </label>
                  <button
                    className="btn big"
                    disabled={screen.starting}
                    onClick={() => void screen.startSharing(allowSystemAudio)}
                  >
                    {screen.starting ? 'Iniciando…' : 'Compartilhar minha tela'}
                  </button>
                </>
              ) : (
                <>
                  <div className={`audio-status ${screen.audioSource === 'system' && !screen.audioMuted ? 'warn' : ''}`}>
                    <span>
                      {screen.audioSource === 'none' && '🔇 Sem áudio na transmissão'}
                      {screen.audioSource === 'tab' && (screen.audioMuted ? '🔇 Áudio da aba mutado' : '🔊 Enviando áudio da aba')}
                      {screen.audioSource === 'system' &&
                        (screen.audioMuted ? '🔇 Áudio do PC mutado' : '⚠️ Enviando TODO o áudio do PC')}
                    </span>
                    {screen.audioSource !== 'none' && (
                      <button className="btn secondary icon" onClick={screen.toggleAudio}>
                        {screen.audioMuted ? 'Ativar áudio' : 'Mutar áudio'}
                      </button>
                    )}
                  </div>
                  <p className="muted small">👀 {screen.watchers} assistindo</p>
                  <div className="actions">
                    <button className="btn secondary" onClick={() => void screen.switchSource(allowSystemAudio)}>
                      Trocar tela
                    </button>
                    <button className="btn danger" onClick={() => screen.stopSharing()}>Parar de compartilhar</button>
                  </div>
                </>
              )}
              {screen.notice && <p className="error">{screen.notice}</p>}
              {screen.error && <p className="error">{screen.error}</p>}
              <p className="hint">
                Para mandar só o som de um vídeo/filme, escolha uma <strong>aba</strong> e marque “Compartilhar áudio
                da aba”.
              </p>
            </>
          )}
          <button className="link back-link" onClick={() => navigate('/')}>← Início</button>
        </div>
      </aside>
    </main>
  )
}
