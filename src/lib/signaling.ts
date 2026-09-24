import { supabase } from './supabase'

export type Role = 'host' | 'viewer' | 'voice'

export type Signal =
  | { type: 'join'; from: string }
  // "at": quando começou a compartilhar; desempata quem assume a vez (o mais novo).
  | { type: 'host-ready'; from: string; at?: number }
  | { type: 'host-stopped'; from: string }
  | { type: 'offer'; from: string; to: string; sdp: RTCSessionDescriptionInit }
  | { type: 'answer'; from: string; to: string; sdp: RTCSessionDescriptionInit }
  | { type: 'ice'; from: string; to: string; candidate: RTCIceCandidateInit }

export type Meta = Record<string, unknown>

export type Peer = { id: string; role: Role; meta: Meta }

export type Room = {
  send: (signal: Signal) => void
  /** Atualiza os dados publicados na presence (todos recebem um novo "sync"). */
  updateMeta: (changes: Meta) => void
  leave: () => void
}

type JoinOptions = {
  code: string
  id: string
  role: Role
  onSignal: (signal: Signal) => void
  onPeers?: (peers: Peer[]) => void
  onPeerLeave?: (peerId: string) => void
  /** Canal: 'screen' (transmissão) ou 'voice' (chat de voz da sala). */
  topic?: 'screen' | 'voice'
  /** Dados extras publicados na presence (ex.: nome na voz). */
  meta?: Meta
}

/**
 * Entra numa sala usando Supabase Realtime.
 * Broadcast troca as mensagens de sinalização WebRTC (offer/answer/ice);
 * Presence informa quem está na sala e avisa quando alguém sai.
 */
export function joinRoom({
  code,
  id,
  role,
  onSignal,
  onPeers,
  onPeerLeave,
  topic = 'screen',
  meta = {},
}: JoinOptions): Promise<Room> {
  if (!supabase) return Promise.reject(new Error('Supabase não configurado'))
  const client = supabase
  let current: Meta = { ...meta }

  const channel = client.channel(`${topic}:${code}`, {
    config: { broadcast: { self: false }, presence: { key: id } },
  })

  channel.on('broadcast', { event: 'signal' }, ({ payload }) => {
    const signal = payload as Signal
    if ('to' in signal && signal.to !== id) return
    onSignal(signal)
  })

  channel.on('presence', { event: 'sync' }, () => {
    const state = channel.presenceState<Meta & { role: Role }>()
    onPeers?.(
      Object.entries(state)
        .filter(([key]) => key !== id)
        .map(([key, metas]) => ({
          id: key,
          role: metas[0]?.role ?? 'viewer',
          // Depois de um updateMeta pode haver mais de uma entrada: a última é a atual.
          meta: (metas[metas.length - 1] ?? {}) as Meta,
        })),
    )
  })

  channel.on('presence', { event: 'leave' }, ({ key, currentPresences }) => {
    // Atualizar a presence (updateMeta: mutar, compartilhar…) gera um "leave" da entrada antiga
    // seguido de um "join" da nova. Só saiu de verdade quando não sobra nenhuma entrada.
    if (key !== id && !currentPresences?.length) onPeerLeave?.(key)
  })

  return new Promise((resolve, reject) => {
    let settled = false
    channel.subscribe(async (status, err) => {
      if (status === 'SUBSCRIBED' && !settled) {
        settled = true
        await channel.track({ role, ...current })
        resolve({
          send: (signal) => {
            void channel.send({ type: 'broadcast', event: 'signal', payload: signal })
          },
          updateMeta: (changes) => {
            current = { ...current, ...changes }
            void channel.track({ role, ...current })
          },
          leave: () => {
            void client.removeChannel(channel)
          },
        })
      } else if ((status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') && !settled) {
        settled = true
        void client.removeChannel(channel)
        reject(err ?? new Error(`Falha ao conectar na sala (${status})`))
      }
    })
  })
}
