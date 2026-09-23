import { useEffect, useMemo, useRef, useState } from 'react'
import { canShareScreen, randomCode, randomId, rtcConfig } from '../lib/rtc'
import { joinRoom, type Room, type Signal } from '../lib/signaling'
import { navigate } from '../router'

type Status = 'idle' | 'starting' | 'live' | 'error'

const DISPLAY_OPTIONS: DisplayMediaStreamOptions = {
  video: { frameRate: { ideal: 30, max: 60 } },
  audio: true,
}

export function Host() {
  const code = useMemo(() => randomCode(), [])
  const hostId = useMemo(() => randomId(), [])
  const shareUrl = `${location.origin}/r/${code}`

  const [status, setStatus] = useState<Status>('idle')
  const [error, setError] = useState('')
  const [viewers, setViewers] = useState(0)
  const [connected, setConnected] = useState(0)
  const [copied, setCopied] = useState(false)

  const previewRef = useRef<HTMLVideoElement>(null)
  const streamRef = useRef<MediaStream | null>(null)
  const roomRef = useRef<Room | null>(null)
  const peersRef = useRef(new Map<string, RTCPeerConnection>())
  const iceQueueRef = useRef(new Map<string, RTCIceCandidateInit[]>())

  function refreshConnected() {
    let n = 0
    peersRef.current.forEach((pc) => pc.connectionState === 'connected' && n++)
    setConnected(n)
  }

  function closePeer(viewerId: string) {
    peersRef.current.get(viewerId)?.close()
    peersRef.current.delete(viewerId)
    iceQueueRef.current.delete(viewerId)
    refreshConnected()
  }

  async function connectViewer(viewerId: string) {
    const stream = streamRef.current
    const room = roomRef.current
    if (!stream || !room) return

    closePeer(viewerId)
    const pc = new RTCPeerConnection(rtcConfig)
    peersRef.current.set(viewerId, pc)

    stream.getTracks().forEach((track) => pc.addTrack(track, stream))

    pc.onicecandidate = (e) => {
      if (e.candidate) room.send({ type: 'ice', from: hostId, to: viewerId, candidate: e.candidate.toJSON() })
    }
    pc.onconnectionstatechange = () => {
      refreshConnected()
      if (pc.connectionState === 'connected') preferResolution(pc)
    }

    const offer = await pc.createOffer()
    await pc.setLocalDescription(offer)
    room.send({ type: 'offer', from: hostId, to: viewerId, sdp: pc.localDescription!.toJSON() })
  }

  async function handleSignal(signal: Signal) {
    switch (signal.type) {
      case 'join':
        await connectViewer(signal.from)
        break
      case 'answer': {
        const pc = peersRef.current.get(signal.from)
        if (!pc) return
        await pc.setRemoteDescription(signal.sdp)
        const queued = iceQueueRef.current.get(signal.from) ?? []
        iceQueueRef.current.delete(signal.from)
        for (const c of queued) await pc.addIceCandidate(c).catch(() => {})
        break
      }
      case 'ice': {
        const pc = peersRef.current.get(signal.from)
        if (pc?.remoteDescription) {
          await pc.addIceCandidate(signal.candidate).catch(() => {})
        } else {
          const queue = iceQueueRef.current.get(signal.from) ?? []
          queue.push(signal.candidate)
          iceQueueRef.current.set(signal.from, queue)
        }
        break
      }
    }
  }

  function watchStream(stream: MediaStream) {
    const video = stream.getVideoTracks()[0]
    if (video) {
      // Prioriza nitidez (texto/código) em vez de fluidez.
      video.contentHint = 'detail'
      // Usuário clicou em "Parar compartilhamento" na barra do navegador.
      video.onended = () => {
        if (streamRef.current === stream) stop()
      }
    }
    streamRef.current = stream
    if (previewRef.current) previewRef.current.srcObject = stream
  }

  async function start() {
    setError('')
    setStatus('starting')
    try {
      const stream = await navigator.mediaDevices.getDisplayMedia(DISPLAY_OPTIONS)
      watchStream(stream)

      const room = await joinRoom({
        code,
        id: hostId,
        role: 'host',
        onSignal: (s) => void handleSignal(s).catch(console.error),
        onPeers: (peers) => setViewers(peers.filter((p) => p.role === 'viewer').length),
        onPeerLeave: closePeer,
      })
      roomRef.current = room
      // Avisa espectadores que já estavam esperando na sala.
      room.send({ type: 'host-ready', from: hostId })
      setStatus('live')
    } catch (err) {
      streamRef.current?.getTracks().forEach((t) => t.stop())
      streamRef.current = null
      const e = err as Error
      if (e.name === 'NotAllowedError') {
        setStatus('idle')
      } else {
        setError(e.message || String(err))
        setStatus('error')
      }
    }
  }

  async function switchSource() {
    const old = streamRef.current
    if (!old) return
    let next: MediaStream
    try {
      next = await navigator.mediaDevices.getDisplayMedia(DISPLAY_OPTIONS)
    } catch {
      return
    }
    watchStream(next)
    // Troca a trilha nas conexões existentes sem renegociar.
    for (const pc of peersRef.current.values()) {
      for (const sender of pc.getSenders()) {
        const kind = sender.track?.kind
        if (!kind) continue
        const replacement = next.getTracks().find((t) => t.kind === kind) ?? null
        await sender.replaceTrack(replacement).catch(console.error)
      }
    }
    old.getTracks().forEach((t) => t.stop())
  }

  function stop() {
    roomRef.current?.send({ type: 'host-stopped', from: hostId })
    for (const id of [...peersRef.current.keys()]) closePeer(id)
    roomRef.current?.leave()
    roomRef.current = null
    streamRef.current?.getTracks().forEach((t) => t.stop())
    streamRef.current = null
    if (previewRef.current) previewRef.current.srcObject = null
    setViewers(0)
    setStatus('idle')
  }

  useEffect(() => stop, []) // eslint-disable-line react-hooks/exhaustive-deps

  async function copyLink() {
    await navigator.clipboard.writeText(shareUrl)
    setCopied(true)
    setTimeout(() => setCopied(false), 1500)
  }

  if (!canShareScreen) {
    return (
      <main className="page center">
        <div className="card">
          <h2>Navegador sem suporte</h2>
          <p className="muted">
            Compartilhar a tela exige um navegador de desktop (Chrome, Edge, Firefox ou Safari). Em celulares você
            ainda pode <strong>assistir</strong> a uma transmissão.
          </p>
          <button className="btn" onClick={() => navigate('/')}>Voltar</button>
        </div>
      </main>
    )
  }

  const live = status === 'live'

  return (
    <main className="page">
      <header className="topbar">
        <button className="link" onClick={() => { stop(); navigate('/') }}>← Início</button>
        {live && <span className="badge live">● AO VIVO</span>}
      </header>

      <section className="host-grid">
        <div className="card">
          <p className="label">Código da sala</p>
          <p className="code">{code}</p>

          <p className="label">Link para os espectadores</p>
          <div className="copy-row">
            <input readOnly value={shareUrl} onFocus={(e) => e.target.select()} />
            <button className="btn secondary" onClick={copyLink}>{copied ? 'Copiado!' : 'Copiar'}</button>
          </div>

          <div className="stats">
            <div><strong>{viewers}</strong><span>na sala</span></div>
            <div><strong>{connected}</strong><span>assistindo</span></div>
          </div>

          {!live ? (
            <button className="btn big" disabled={status === 'starting'} onClick={start}>
              {status === 'starting' ? 'Iniciando…' : 'Compartilhar minha tela'}
            </button>
          ) : (
            <div className="actions">
              <button className="btn secondary" onClick={switchSource}>Trocar tela</button>
              <button className="btn danger" onClick={stop}>Parar</button>
            </div>
          )}
          {error && <p className="error">{error}</p>}
          <p className="hint">
            Dica: para transmitir o áudio, escolha uma <strong>aba</strong> do Chrome/Edge e marque “Compartilhar
            áudio”.
          </p>
        </div>

        <div className="preview">
          <video ref={previewRef} autoPlay muted playsInline />
          {!live && <div className="placeholder">A pré-visualização aparece aqui</div>}
        </div>
      </section>
    </main>
  )
}

function preferResolution(pc: RTCPeerConnection) {
  for (const sender of pc.getSenders()) {
    if (sender.track?.kind !== 'video') continue
    const params = sender.getParameters()
    params.degradationPreference = 'maintain-resolution'
    sender.setParameters(params).catch(() => {})
  }
}
