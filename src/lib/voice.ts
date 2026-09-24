import { useEffect, useRef, useState } from 'react'
import { randomId, rtcConfig } from './rtc'
import { joinRoom, type Meta, type Room, type Signal } from './signaling'

/**
 * Chat de voz da sala: malha de conexões WebRTC só de áudio no canal voice:<código>.
 * Mesmo protocolo do app desktop (app/voice.py):
 * - estar no canal (presence) = estar na voz; a presence publica { name, muted, sharing };
 * - em cada par, quem tem o id MENOR manda o offer;
 * - sinais offer / answer / ice com from/to.
 */

export type Person = { id: string; name: string; muted: boolean; sharing: boolean; me: boolean; connected: boolean }

type VoicePeer = { pc: RTCPeerConnection; audio: HTMLAudioElement; meter?: LevelMeter }

const RECONNECT_DELAY = 2000

// ------------------------------------------------------------------ detecção de fala

let audioContext: AudioContext | null = null
function getAudioContext() {
  audioContext ??= new AudioContext()
  if (audioContext.state === 'suspended') void audioContext.resume()
  return audioContext
}

/** Diz se há som olhando o volume (RMS); o limite acompanha o ruído de fundo. Igual ao LevelMeter do desktop. */
class LevelMeter {
  static THRESHOLD = 0.015 // ~ -36 dBFS
  static NOISE_FACTOR = 4
  static HOLD = 300 // ms aceso depois do último pico, para não piscar entre as palavras

  private analyser: AnalyserNode
  private source: MediaStreamAudioSourceNode
  private buf: Float32Array<ArrayBuffer>
  private floor = LevelMeter.THRESHOLD
  private lastLoud = 0

  constructor(stream: MediaStream) {
    const ctx = getAudioContext()
    this.source = ctx.createMediaStreamSource(stream)
    this.analyser = ctx.createAnalyser()
    this.analyser.fftSize = 1024
    this.buf = new Float32Array(this.analyser.fftSize)
    this.source.connect(this.analyser)
  }

  get active() {
    this.analyser.getFloatTimeDomainData(this.buf)
    let sum = 0
    for (const v of this.buf) sum += v * v
    const rms = Math.sqrt(sum / this.buf.length)
    // Piso de ruído: desce na hora, sobe devagar.
    this.floor = rms < this.floor ? rms : this.floor + (rms - this.floor) * 0.01
    if (rms > Math.max(LevelMeter.THRESHOLD, this.floor * LevelMeter.NOISE_FACTOR)) this.lastLoud = performance.now()
    return performance.now() - this.lastLoud < LevelMeter.HOLD
  }

  close() {
    this.source.disconnect()
  }
}

// ------------------------------------------------------------------ hook

export function useVoice(code: string, name: string) {
  const [joined, setJoined] = useState(false)
  const [joining, setJoining] = useState(false)
  const [micMuted, setMicMuted] = useState(true)
  const [hasMic, setHasMic] = useState(false)
  const [volume, setVolume] = useState(1)
  const [people, setPeople] = useState<Person[]>([])
  const [speaking, setSpeaking] = useState<Set<string>>(new Set())
  const [error, setError] = useState('')

  const myId = useRef(randomId())
  const roomRef = useRef<Room | null>(null)
  const micRef = useRef<MediaStream | null>(null)
  const micMeterRef = useRef<LevelMeter | null>(null)
  const peersRef = useRef(new Map<string, VoicePeer>())
  const othersRef = useRef(new Map<string, Meta>())
  const pendingIceRef = useRef(new Map<string, RTCIceCandidateInit[]>())
  const metaRef = useRef({ name, muted: true, sharing: false })
  const volumeRef = useRef(1)
  const activeRef = useRef(false)

  function refresh() {
    const me: Person = { id: myId.current, ...metaRef.current, me: true, connected: true }
    const others: Person[] = [...othersRef.current].map(([id, meta]) => ({
      id,
      name: typeof meta.name === 'string' && meta.name ? meta.name : 'Navegador',
      muted: Boolean(meta.muted),
      sharing: Boolean(meta.sharing),
      me: false,
      connected: peersRef.current.get(id)?.pc.connectionState === 'connected',
    }))
    others.sort((a, b) => a.name.localeCompare(b.name))
    setPeople(activeRef.current ? [me, ...others] : [])
  }

  function publish(changes: Partial<typeof metaRef.current>) {
    metaRef.current = { ...metaRef.current, ...changes }
    roomRef.current?.updateMeta(changes)
    refresh()
  }

  function closePeer(id: string) {
    const peer = peersRef.current.get(id)
    if (peer) {
      peer.pc.close()
      peer.meter?.close()
      peer.audio.srcObject = null
      peersRef.current.delete(id)
    }
    pendingIceRef.current.delete(id)
    refresh()
  }

  function newPeer(id: string) {
    const pc = new RTCPeerConnection(rtcConfig)
    const audio = new Audio()
    audio.autoplay = true
    audio.volume = volumeRef.current
    const peer: VoicePeer = { pc, audio }
    peersRef.current.set(id, peer)

    const mic = micRef.current?.getAudioTracks()[0]
    // Sem microfone (permissão negada) ainda dá para ouvir: transceiver só de recebimento.
    if (mic) pc.addTrack(mic, micRef.current!)
    else pc.addTransceiver('audio', { direction: 'recvonly' })

    pc.ontrack = (e) => {
      const stream = e.streams[0] ?? new MediaStream([e.track])
      audio.srcObject = stream
      void audio.play().catch(() => {})
      peer.meter?.close()
      peer.meter = new LevelMeter(stream)
    }
    pc.onicecandidate = (e) => {
      if (e.candidate) roomRef.current?.send({ type: 'ice', from: myId.current, to: id, candidate: e.candidate.toJSON() })
    }
    pc.onconnectionstatechange = () => {
      if (peersRef.current.get(id)?.pc !== pc) return
      console.debug(`voz ${id.slice(0, 8)}: ${pc.connectionState}`)
      refresh()
      if (pc.connectionState === 'failed') {
        closePeer(id)
        // Quem oferta tenta de novo; o outro lado espera o novo offer.
        setTimeout(() => {
          if (activeRef.current && othersRef.current.has(id) && id > myId.current && !peersRef.current.has(id)) {
            void offer(id)
          }
        }, RECONNECT_DELAY)
      }
    }
    return peer
  }

  async function offer(id: string) {
    const { pc } = newPeer(id)
    await pc.setLocalDescription(await pc.createOffer())
    if (peersRef.current.get(id)?.pc === pc) {
      roomRef.current?.send({ type: 'offer', from: myId.current, to: id, sdp: pc.localDescription!.toJSON() })
    }
  }

  async function flushIce(id: string, pc: RTCPeerConnection) {
    const queued = pendingIceRef.current.get(id) ?? []
    pendingIceRef.current.delete(id)
    for (const c of queued) await pc.addIceCandidate(c).catch(() => {})
  }

  async function handleSignal(signal: Signal) {
    if (!activeRef.current) return
    switch (signal.type) {
      case 'offer': {
        const queued = pendingIceRef.current.get(signal.from) ?? []
        closePeer(signal.from)
        pendingIceRef.current.set(signal.from, queued)
        const { pc } = newPeer(signal.from)
        await pc.setRemoteDescription(signal.sdp)
        await flushIce(signal.from, pc)
        await pc.setLocalDescription(await pc.createAnswer())
        if (peersRef.current.get(signal.from)?.pc === pc) {
          roomRef.current?.send({ type: 'answer', from: myId.current, to: signal.from, sdp: pc.localDescription!.toJSON() })
        }
        break
      }
      case 'answer': {
        const pc = peersRef.current.get(signal.from)?.pc
        if (!pc) return
        await pc.setRemoteDescription(signal.sdp)
        await flushIce(signal.from, pc)
        break
      }
      case 'ice': {
        const pc = peersRef.current.get(signal.from)?.pc
        if (pc?.remoteDescription) {
          await pc.addIceCandidate(signal.candidate).catch(() => {})
        } else {
          const queue = pendingIceRef.current.get(signal.from) ?? []
          queue.push(signal.candidate)
          pendingIceRef.current.set(signal.from, queue)
        }
        break
      }
    }
  }

  function handlePeers(peers: { id: string; meta: Meta }[]) {
    othersRef.current = new Map(peers.map((p) => [p.id, p.meta]))
    // O primeiro "sync" pode chegar antes do joinRoom resolver; conecta depois (ver join).
    if (roomRef.current) {
      for (const id of [...peersRef.current.keys()]) if (!othersRef.current.has(id)) closePeer(id)
      for (const { id } of peers) {
        if (id > myId.current && !peersRef.current.has(id)) void offer(id).catch(console.error)
      }
    }
    refresh()
  }

  /** Entra na voz. Precisa vir de um clique (o navegador exige para tocar áudio e pedir o microfone). */
  async function join({ muted = true, name: joinName }: { muted?: boolean; name?: string } = {}) {
    if (joining || joined) return
    setError('')
    setJoining(true)
    getAudioContext()
    try {
      try {
        micRef.current = await navigator.mediaDevices.getUserMedia({
          audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
        })
        micMeterRef.current = new LevelMeter(micRef.current)
        setHasMic(true)
      } catch (err) {
        micRef.current = null
        setHasMic(false)
        setError(
          (err as Error).name === 'NotAllowedError'
            ? 'Sem permissão para o microfone: você só ouve.'
            : 'Microfone indisponível: você só ouve.',
        )
      }
      const mute = muted || !micRef.current
      micRef.current?.getAudioTracks().forEach((t) => (t.enabled = !mute))
      setMicMuted(mute)
      // O nome pode vir junto (acabou de ser digitado e o estado do React ainda não atualizou).
      metaRef.current = { ...metaRef.current, name: joinName ?? name, muted: mute }
      activeRef.current = true
      myId.current = randomId()
      // Sinais/presença podem chegar antes do joinRoom resolver: guarda e trata depois.
      const early: Signal[] = []
      roomRef.current = await joinRoom({
        code,
        id: myId.current,
        role: 'voice',
        topic: 'voice',
        meta: metaRef.current,
        onSignal: (s) => (roomRef.current ? void handleSignal(s).catch(console.error) : early.push(s)),
        onPeers: handlePeers,
        onPeerLeave: closePeer,
      })
      handlePeers([...othersRef.current].map(([id, meta]) => ({ id, meta })))
      for (const s of early) await handleSignal(s).catch(console.error)
      setJoined(true)
    } catch (err) {
      leave()
      setError((err as Error).message || String(err))
    } finally {
      setJoining(false)
    }
  }

  function leave() {
    activeRef.current = false
    for (const id of [...peersRef.current.keys()]) closePeer(id)
    othersRef.current = new Map()
    roomRef.current?.leave()
    roomRef.current = null
    micMeterRef.current?.close()
    micMeterRef.current = null
    micRef.current?.getTracks().forEach((t) => t.stop())
    micRef.current = null
    setJoined(false)
    setSpeaking(new Set())
    refresh()
  }

  function toggleMic() {
    if (!micRef.current) return
    const next = !micMuted
    setMicMuted(next)
    micRef.current.getAudioTracks().forEach((t) => (t.enabled = !next))
    publish({ muted: next })
  }

  function changeVolume(value: number) {
    volumeRef.current = value
    setVolume(value)
    peersRef.current.forEach(({ audio }) => (audio.volume = value))
  }

  function setSharing(sharing: boolean) {
    if (metaRef.current.sharing !== sharing) publish({ sharing })
  }

  useEffect(() => {
    if (metaRef.current.name !== name) publish({ name })
  }, [name]) // eslint-disable-line react-hooks/exhaustive-deps

  // Anel de "falando": mede o volume localmente a cada 100 ms, sem rede.
  useEffect(() => {
    if (!joined) return
    const timer = setInterval(() => {
      const ids = new Set<string>()
      if (micMeterRef.current?.active && !metaRef.current.muted) ids.add(myId.current)
      peersRef.current.forEach((peer, id) => peer.meter?.active && ids.add(id))
      setSpeaking((prev) => (prev.size === ids.size && [...ids].every((id) => prev.has(id)) ? prev : ids))
    }, 100)
    return () => clearInterval(timer)
  }, [joined])

  useEffect(() => leave, [code]) // eslint-disable-line react-hooks/exhaustive-deps

  const sharer = people.find((p) => p.sharing && !p.me)?.name ?? null

  return {
    joined,
    joining,
    micMuted,
    hasMic,
    volume,
    people,
    speaking,
    sharer,
    error,
    join,
    leave,
    toggleMic,
    changeVolume,
    setSharing,
  }
}

export type Voice = ReturnType<typeof useVoice>
