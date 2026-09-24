import { useEffect, useRef, useState, type RefObject } from 'react'
import { randomId, rtcConfig } from './rtc'
import { joinRoom, type Room, type Signal } from './signaling'

/**
 * Transmissão de tela da sala (canal screen:<código>), igual ao app desktop (app/rtc.py):
 * - todo mundo assiste; qualquer um pode compartilhar, mas só um por vez;
 * - "host-ready" leva "at"; quem compartilhava e recebe um host-ready mais novo para sem avisar;
 * - quem assiste ignora offer/host-stopped que não vêm do último host-ready;
 * - quem compartilha não assiste a si mesmo (sai como espectador e volta ao parar).
 */

export type ViewerStatus = 'connecting' | 'waiting' | 'negotiating' | 'watching' | 'ended' | 'error'
export type AudioSource = 'none' | 'tab' | 'system'

// No Windows, áudio de janela/tela inteira = áudio do PC inteiro. Só aba isola o som.
function displayOptions(allowSystemAudio: boolean) {
  return {
    video: { frameRate: { ideal: 30, max: 60 } },
    // restrictOwnAudio: o áudio "do PC" não inclui o que esta página toca (a voz da sala).
    audio: { restrictOwnAudio: true } as MediaTrackConstraints,
    systemAudio: allowSystemAudio ? 'include' : 'exclude',
    // Chrome 141+: tenta capturar só o áudio da janela quando suportado.
    windowAudio: allowSystemAudio ? 'system' : 'window',
    selfBrowserSurface: 'exclude',
  } as DisplayMediaStreamOptions
}

function describeAudio(stream: MediaStream | null): AudioSource {
  if (!stream?.getAudioTracks().length) return 'none'
  const surface = (stream.getVideoTracks()[0]?.getSettings() as { displaySurface?: string }).displaySurface
  return surface === 'browser' ? 'tab' : 'system'
}

function preferResolution(pc: RTCPeerConnection) {
  for (const sender of pc.getSenders()) {
    if (sender.track?.kind !== 'video') continue
    const params = sender.getParameters()
    params.degradationPreference = 'maintain-resolution'
    sender.setParameters(params).catch(() => {})
  }
}

export function useScreen(code: string, videoRef: RefObject<HTMLVideoElement | null>, enabled: boolean) {
  const [status, setStatus] = useState<ViewerStatus>('connecting')
  const [hasAudio, setHasAudio] = useState(false)
  const [sharing, setSharing] = useState(false)
  const [starting, setStarting] = useState(false)
  const [audioSource, setAudioSource] = useState<AudioSource>('none')
  const [audioMuted, setAudioMuted] = useState(false)
  const [watchers, setWatchers] = useState(0)
  const [notice, setNotice] = useState('')
  const [error, setError] = useState('')

  // --- espectador
  const viewerIdRef = useRef(randomId())
  const viewerRoomRef = useRef<Room | null>(null)
  const viewerPcRef = useRef<RTCPeerConnection | null>(null)
  const hostIdRef = useRef<string | null>(null)
  const latestHostRef = useRef<string | null>(null)
  const viewerIceRef = useRef<RTCIceCandidateInit[]>([])

  // --- apresentador
  const hostIdMeRef = useRef(randomId())
  const hostRoomRef = useRef<Room | null>(null)
  const startedAtRef = useRef(0)
  const streamRef = useRef<MediaStream | null>(null)
  const peersRef = useRef(new Map<string, RTCPeerConnection>())
  const hostIceRef = useRef(new Map<string, RTCIceCandidateInit[]>())
  const audioMutedRef = useRef(false)
  const activeRef = useRef(false)

  // ================================================================ assistir

  function resetViewerPeer() {
    viewerPcRef.current?.close()
    viewerPcRef.current = null
    hostIdRef.current = null
    if (videoRef.current && !streamRef.current) videoRef.current.srcObject = null
    setHasAudio(false)
  }

  function requestStream() {
    viewerRoomRef.current?.send({ type: 'join', from: viewerIdRef.current })
  }

  async function handleOffer(signal: Extract<Signal, { type: 'offer' }>) {
    const room = viewerRoomRef.current
    if (!room) return
    resetViewerPeer()
    setStatus('negotiating')
    const pc = new RTCPeerConnection(rtcConfig)
    viewerPcRef.current = pc
    hostIdRef.current = signal.from

    pc.ontrack = (e) => {
      const stream = e.streams[0] ?? new MediaStream([e.track])
      const video = videoRef.current
      if (video && video.srcObject !== stream) {
        video.srcObject = stream
        void video.play().catch(() => {})
      }
      if (e.track.kind === 'audio') setHasAudio(true)
    }
    pc.onicecandidate = (e) => {
      if (e.candidate) room.send({ type: 'ice', from: viewerIdRef.current, to: signal.from, candidate: e.candidate.toJSON() })
    }
    pc.onconnectionstatechange = () => {
      if (viewerPcRef.current !== pc) return
      if (pc.connectionState === 'connected') setStatus('watching')
      if (pc.connectionState === 'failed') {
        resetViewerPeer()
        setStatus('negotiating')
        setTimeout(requestStream, 1000)
      }
    }

    await pc.setRemoteDescription(signal.sdp)
    const queued = viewerIceRef.current
    viewerIceRef.current = []
    for (const c of queued) await pc.addIceCandidate(c).catch(() => {})
    await pc.setLocalDescription(await pc.createAnswer())
    room.send({ type: 'answer', from: viewerIdRef.current, to: signal.from, sdp: pc.localDescription!.toJSON() })
  }

  async function handleViewerSignal(signal: Signal) {
    // Sinais de quem acabou de perder a vez são ignorados.
    if ((signal.type === 'offer' || signal.type === 'host-stopped') && latestHostRef.current && signal.from !== latestHostRef.current) {
      return
    }
    switch (signal.type) {
      case 'host-ready':
        latestHostRef.current = signal.from
        resetViewerPeer()
        viewerIceRef.current = []
        setStatus('negotiating')
        requestStream()
        break
      case 'host-stopped':
        resetViewerPeer()
        viewerIceRef.current = []
        setStatus('ended')
        break
      case 'offer':
        latestHostRef.current = signal.from
        await handleOffer(signal)
        break
      case 'ice': {
        const pc = viewerPcRef.current
        if (pc?.remoteDescription && hostIdRef.current === signal.from) {
          await pc.addIceCandidate(signal.candidate).catch(() => {})
        } else {
          viewerIceRef.current.push(signal.candidate)
        }
        break
      }
    }
  }

  async function startViewer() {
    if (viewerRoomRef.current || !activeRef.current) return
    viewerIdRef.current = randomId()
    latestHostRef.current = null
    setStatus('connecting')
    let hostOnline: boolean | null = null
    try {
      const room = await joinRoom({
        code,
        id: viewerIdRef.current,
        role: 'viewer',
        onSignal: (s) => void handleViewerSignal(s).catch(console.error),
        onPeers: (peers) => {
          hostOnline = peers.some((p) => p.role === 'host')
          if (!hostOnline) setStatus((s) => (s === 'connecting' || s === 'negotiating' ? 'waiting' : s))
        },
        onPeerLeave: (id) => {
          if (id === hostIdRef.current || (!hostIdRef.current && id === latestHostRef.current)) {
            resetViewerPeer()
            setStatus('ended')
          }
        },
      })
      if (!activeRef.current || streamRef.current) return room.leave()
      viewerRoomRef.current = room
      setStatus(hostOnline === false ? 'waiting' : 'negotiating')
      requestStream()
    } catch (err) {
      setError((err as Error).message)
      setStatus('error')
    }
  }

  function stopViewer() {
    resetViewerPeer()
    viewerRoomRef.current?.leave()
    viewerRoomRef.current = null
  }

  // ================================================================ compartilhar

  function refreshWatchers() {
    let n = 0
    peersRef.current.forEach((pc) => pc.connectionState === 'connected' && n++)
    setWatchers(n)
  }

  function closeHostPeer(id: string) {
    peersRef.current.get(id)?.close()
    peersRef.current.delete(id)
    hostIceRef.current.delete(id)
    refreshWatchers()
  }

  async function connectViewer(viewerId: string) {
    const stream = streamRef.current
    const room = hostRoomRef.current
    if (!stream || !room) return
    closeHostPeer(viewerId)
    const pc = new RTCPeerConnection(rtcConfig)
    peersRef.current.set(viewerId, pc)
    stream.getTracks().forEach((track) => pc.addTrack(track, stream))
    pc.onicecandidate = (e) => {
      if (e.candidate) room.send({ type: 'ice', from: hostIdMeRef.current, to: viewerId, candidate: e.candidate.toJSON() })
    }
    pc.onconnectionstatechange = () => {
      refreshWatchers()
      if (pc.connectionState === 'connected') preferResolution(pc)
    }
    await pc.setLocalDescription(await pc.createOffer())
    room.send({ type: 'offer', from: hostIdMeRef.current, to: viewerId, sdp: pc.localDescription!.toJSON() })
  }

  async function handleHostSignal(signal: Signal) {
    switch (signal.type) {
      case 'join':
        await connectViewer(signal.from)
        break
      case 'host-ready':
        // Outra pessoa começou a compartilhar depois de você: ela assume a vez.
        if (signal.from !== hostIdMeRef.current && (signal.at ?? Infinity) >= startedAtRef.current) {
          stopSharing(false)
          setNotice('Outra pessoa começou a compartilhar, então sua transmissão foi encerrada.')
        }
        break
      case 'answer': {
        const pc = peersRef.current.get(signal.from)
        if (!pc) return
        await pc.setRemoteDescription(signal.sdp)
        const queued = hostIceRef.current.get(signal.from) ?? []
        hostIceRef.current.delete(signal.from)
        for (const c of queued) await pc.addIceCandidate(c).catch(() => {})
        break
      }
      case 'ice': {
        const pc = peersRef.current.get(signal.from)
        if (pc?.remoteDescription) {
          await pc.addIceCandidate(signal.candidate).catch(() => {})
        } else {
          const queue = hostIceRef.current.get(signal.from) ?? []
          queue.push(signal.candidate)
          hostIceRef.current.set(signal.from, queue)
        }
        break
      }
    }
  }

  function watchStream(stream: MediaStream) {
    const video = stream.getVideoTracks()[0]
    if (video) {
      video.contentHint = 'detail' // prioriza nitidez (texto/código) em vez de fluidez
      video.onended = () => {
        // Usuário clicou em "Parar compartilhamento" na barra do navegador.
        if (streamRef.current === stream) stopSharing()
      }
    }
    streamRef.current = stream
    if (videoRef.current) {
      videoRef.current.srcObject = stream
      videoRef.current.muted = true // pré-visualização: não tocar o próprio áudio
      void videoRef.current.play().catch(() => {})
    }
    setAudioSource(describeAudio(stream))
    stream.getAudioTracks().forEach((t) => (t.enabled = !audioMutedRef.current))
  }

  async function startSharing(allowSystemAudio: boolean) {
    setError('')
    setNotice('')
    setStarting(true)
    let stream: MediaStream
    try {
      stream = await navigator.mediaDevices.getDisplayMedia(displayOptions(allowSystemAudio))
    } catch (err) {
      setStarting(false)
      if ((err as Error).name !== 'NotAllowedError') setError((err as Error).message)
      return
    }
    stopViewer()
    watchStream(stream)
    try {
      hostIdMeRef.current = randomId()
      const room = await joinRoom({
        code,
        id: hostIdMeRef.current,
        role: 'host',
        onSignal: (s) => void handleHostSignal(s).catch(console.error),
        onPeerLeave: closeHostPeer,
      })
      hostRoomRef.current = room
      startedAtRef.current = Date.now() / 1000
      // Avisa quem já estava na sala (e desempata com quem também começou agora).
      room.send({ type: 'host-ready', from: hostIdMeRef.current, at: startedAtRef.current })
      setSharing(true)
    } catch (err) {
      setError((err as Error).message)
      stopSharing(false)
    } finally {
      setStarting(false)
    }
  }

  async function switchSource(allowSystemAudio: boolean) {
    const old = streamRef.current
    if (!old) return
    let next: MediaStream
    try {
      next = await navigator.mediaDevices.getDisplayMedia(displayOptions(allowSystemAudio))
    } catch {
      return
    }
    watchStream(next)
    // Troca a trilha nas conexões existentes sem renegociar.
    for (const pc of peersRef.current.values()) {
      for (const sender of pc.getSenders()) {
        const kind = sender.track?.kind
        if (!kind) continue
        await sender.replaceTrack(next.getTracks().find((t) => t.kind === kind) ?? null).catch(console.error)
      }
    }
    old.getTracks().forEach((t) => t.stop())
  }

  function stopSharing(notify = true) {
    const room = hostRoomRef.current
    if (room && notify) room.send({ type: 'host-stopped', from: hostIdMeRef.current })
    for (const id of [...peersRef.current.keys()]) closeHostPeer(id)
    room?.leave()
    hostRoomRef.current = null
    streamRef.current?.getTracks().forEach((t) => t.stop())
    streamRef.current = null
    if (videoRef.current) {
      videoRef.current.srcObject = null
      videoRef.current.muted = false
    }
    setSharing(false)
    setAudioSource('none')
    setWatchers(0)
    void startViewer()
  }

  function toggleAudio() {
    const next = !audioMutedRef.current
    audioMutedRef.current = next
    setAudioMuted(next)
    streamRef.current?.getAudioTracks().forEach((t) => (t.enabled = !next))
  }

  useEffect(() => {
    if (!enabled) return
    activeRef.current = true
    void startViewer()
    return () => {
      activeRef.current = false
      if (hostRoomRef.current) stopSharing()
      stopViewer()
    }
  }, [code, enabled]) // eslint-disable-line react-hooks/exhaustive-deps

  return {
    status,
    hasAudio,
    sharing,
    starting,
    audioSource,
    audioMuted,
    watchers,
    notice,
    error,
    startSharing,
    switchSource,
    stopSharing,
    toggleAudio,
  }
}
