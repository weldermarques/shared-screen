import { useEffect, useMemo, useRef, useState } from 'react'
import { randomId, rtcConfig } from '../lib/rtc'
import { joinRoom, type Room, type Signal } from '../lib/signaling'
import { navigate } from '../router'

type Status = 'connecting' | 'waiting' | 'negotiating' | 'watching' | 'ended' | 'error'

const STATUS_TEXT: Record<Status, string> = {
  connecting: 'Entrando na sala…',
  waiting: 'Aguardando o apresentador iniciar o compartilhamento…',
  negotiating: 'Conectando à transmissão…',
  watching: '',
  ended: 'A transmissão foi encerrada.',
  error: 'Não foi possível conectar.',
}

export function Viewer({ code }: { code: string }) {
  const myId = useMemo(() => randomId(), [])
  const [status, setStatus] = useState<Status>('connecting')
  const [error, setError] = useState('')
  const [muted, setMuted] = useState(true)
  const [hasAudio, setHasAudio] = useState(false)

  const videoRef = useRef<HTMLVideoElement>(null)
  const stageRef = useRef<HTMLDivElement>(null)
  const roomRef = useRef<Room | null>(null)
  const pcRef = useRef<RTCPeerConnection | null>(null)
  const hostIdRef = useRef<string | null>(null)
  const iceQueueRef = useRef<RTCIceCandidateInit[]>([])

  function resetPeer() {
    pcRef.current?.close()
    pcRef.current = null
    hostIdRef.current = null
    if (videoRef.current) videoRef.current.srcObject = null
    setHasAudio(false)
  }

  function requestStream() {
    roomRef.current?.send({ type: 'join', from: myId })
  }

  async function handleOffer(signal: Extract<Signal, { type: 'offer' }>) {
    const room = roomRef.current
    if (!room) return
    resetPeer()
    setStatus('negotiating')

    const pc = new RTCPeerConnection(rtcConfig)
    pcRef.current = pc
    hostIdRef.current = signal.from

    pc.ontrack = (e) => {
      const stream = e.streams[0] ?? new MediaStream([e.track])
      if (videoRef.current && videoRef.current.srcObject !== stream) {
        videoRef.current.srcObject = stream
      }
      if (e.track.kind === 'audio') setHasAudio(true)
    }
    pc.onicecandidate = (e) => {
      if (e.candidate) room.send({ type: 'ice', from: myId, to: signal.from, candidate: e.candidate.toJSON() })
    }
    pc.onconnectionstatechange = () => {
      if (pcRef.current !== pc) return
      if (pc.connectionState === 'connected') setStatus('watching')
      if (pc.connectionState === 'failed') {
        // Tenta renegociar do zero.
        resetPeer()
        setStatus('negotiating')
        setTimeout(requestStream, 1000)
      }
    }

    await pc.setRemoteDescription(signal.sdp)
    const queued = iceQueueRef.current
    iceQueueRef.current = []
    for (const c of queued) await pc.addIceCandidate(c).catch(() => {})

    const answer = await pc.createAnswer()
    await pc.setLocalDescription(answer)
    room.send({ type: 'answer', from: myId, to: signal.from, sdp: pc.localDescription!.toJSON() })
  }

  async function handleSignal(signal: Signal) {
    switch (signal.type) {
      case 'host-ready':
        resetPeer()
        iceQueueRef.current = []
        setStatus('negotiating')
        requestStream()
        break
      case 'host-stopped':
        resetPeer()
        iceQueueRef.current = []
        setStatus('ended')
        break
      case 'offer':
        await handleOffer(signal)
        break
      case 'ice': {
        const pc = pcRef.current
        if (pc?.remoteDescription && hostIdRef.current === signal.from) {
          await pc.addIceCandidate(signal.candidate).catch(() => {})
        } else {
          iceQueueRef.current.push(signal.candidate)
        }
        break
      }
    }
  }

  useEffect(() => {
    let cancelled = false
    joinRoom({
      code,
      id: myId,
      role: 'viewer',
      onSignal: (s) => void handleSignal(s).catch(console.error),
      onPeers: (peers) => {
        const hostOnline = peers.some((p) => p.role === 'host')
        setStatus((s) => (!hostOnline && (s === 'connecting' || s === 'negotiating') ? 'waiting' : s))
      },
      onPeerLeave: (id) => {
        if (id === hostIdRef.current) {
          resetPeer()
          setStatus('ended')
        }
      },
    })
      .then((room) => {
        if (cancelled) return room.leave()
        roomRef.current = room
        setStatus('negotiating')
        requestStream()
      })
      .catch((err: Error) => {
        if (cancelled) return
        setError(err.message)
        setStatus('error')
      })

    return () => {
      cancelled = true
      resetPeer()
      roomRef.current?.leave()
      roomRef.current = null
    }
  }, [code]) // eslint-disable-line react-hooks/exhaustive-deps

  function toggleMute() {
    const video = videoRef.current
    if (!video) return
    video.muted = !video.muted
    setMuted(video.muted)
    void video.play().catch(() => {})
  }

  function fullscreen() {
    const el = stageRef.current
    if (!el) return
    if (document.fullscreenElement) void document.exitFullscreen()
    else void el.requestFullscreen?.()
  }

  const watching = status === 'watching'

  return (
    <main className="viewer">
      <div className="stage" ref={stageRef} onDoubleClick={fullscreen}>
        <video ref={videoRef} autoPlay muted playsInline />
        {!watching && (
          <div className="overlay">
            {(status === 'connecting' || status === 'waiting' || status === 'negotiating') && <div className="spinner" />}
            <p>{STATUS_TEXT[status]}</p>
            {error && <p className="error">{error}</p>}
            {(status === 'ended' || status === 'error') && (
              <div className="actions">
                <button className="btn secondary" onClick={() => location.reload()}>Tentar novamente</button>
                <button className="btn" onClick={() => navigate('/')}>Início</button>
              </div>
            )}
          </div>
        )}
      </div>

      <footer className="viewer-bar">
        <button className="link" onClick={() => navigate('/')}>← Sair</button>
        <span className="muted">Sala <strong>{code}</strong></span>
        <div className="actions">
          {watching && hasAudio && (
            <button className="btn secondary" onClick={toggleMute}>{muted ? '🔇 Ativar som' : '🔊 Silenciar'}</button>
          )}
          {watching && <button className="btn secondary" onClick={fullscreen}>⛶ Tela cheia</button>}
        </div>
      </footer>
    </main>
  )
}
