import type { Voice } from '../lib/voice'
import { Avatar } from './Avatar'

/** Voz da sala: mic, volume e a lista de quem está conectado (avatar, 🖥️, 🔇, anel de fala). */
export function VoicePanel({ voice, onRename }: { voice: Voice; onRename: () => void }) {
  if (!voice.joined) {
    return (
      <div className="voice">
        <button className="btn secondary" disabled={voice.joining} onClick={() => void voice.join()}>
          {voice.joining ? 'Entrando…' : '🎙️ Entrar na voz'}
        </button>
        {voice.error && <span className="error small">{voice.error}</span>}
      </div>
    )
  }

  return (
    <div className="voice-panel">
      <div className="voice">
        <button
          className="btn secondary"
          onClick={voice.toggleMic}
          disabled={!voice.hasMic}
          title={!voice.hasMic ? 'Sem microfone' : voice.micMuted ? 'Ativar microfone' : 'Mutar microfone'}
        >
          {voice.micMuted ? '🔇 Mic mutado' : '🎙️ Mutar mic'}
        </button>
        <button className="link" onClick={voice.leave}>Sair da voz</button>
      </div>
      <div className="volume">
        <span className="muted" title="Volume das vozes">🔈</span>
        <input
          type="range"
          min={0}
          max={1}
          step={0.01}
          value={voice.volume}
          onChange={(e) => voice.changeVolume(Number(e.target.value))}
          aria-label="Volume das vozes"
        />
      </div>
      {voice.error && <p className="error small">{voice.error}</p>}

      <ul className="people">
        {voice.people.map((p) => {
          const flags = [p.sharing && ['🖥️', 'compartilhando a tela'], p.muted && ['🔇', 'microfone mutado']].filter(
            Boolean,
          ) as [string, string][]
          return (
            <li key={p.id} className={p.connected ? '' : 'pending'}>
              <Avatar name={p.name} speaking={voice.speaking.has(p.id)} />
              <span className="person-name">
                {p.name}
                {p.me && ' (você)'}
              </span>
              {p.me && (
                <button className="link icon-link" onClick={onRename} title="Mudar seu nome">✏️</button>
              )}
              {!p.connected && <span className="hint small">conectando…</span>}
              {flags.length > 0 && (
                <span className="person-flags" title={flags.map((f) => f[1]).join(', ')}>
                  {flags.map((f) => f[0]).join(' ')}
                </span>
              )}
            </li>
          )
        })}
      </ul>
    </div>
  )
}
