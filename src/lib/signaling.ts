import { supabase } from './supabase'

export type Role = 'host' | 'viewer'

export type Signal =
  | { type: 'join'; from: string }
  | { type: 'host-ready'; from: string }
  | { type: 'host-stopped'; from: string }
  | { type: 'offer'; from: string; to: string; sdp: RTCSessionDescriptionInit }
  | { type: 'answer'; from: string; to: string; sdp: RTCSessionDescriptionInit }
  | { type: 'ice'; from: string; to: string; candidate: RTCIceCandidateInit }

export type Peer = { id: string; role: Role }

export type Room = {
  send: (signal: Signal) => void
  leave: () => void
}

type JoinOptions = {
  code: string
  id: string
  role: Role
  onSignal: (signal: Signal) => void
  onPeers?: (peers: Peer[]) => void
  onPeerLeave?: (peerId: string) => void
}

/**
 * Entra numa sala usando Supabase Realtime.
 * Broadcast troca as mensagens de sinalização WebRTC (offer/answer/ice);
 * Presence informa quem está na sala e avisa quando alguém sai.
 */
export function joinRoom({ code, id, role, onSignal, onPeers, onPeerLeave }: JoinOptions): Promise<Room> {
  if (!supabase) return Promise.reject(new Error('Supabase não configurado'))
  const client = supabase

  const channel = client.channel(`screen:${code}`, {
    config: { broadcast: { self: false }, presence: { key: id } },
  })

  channel.on('broadcast', { event: 'signal' }, ({ payload }) => {
    const signal = payload as Signal
    if ('to' in signal && signal.to !== id) return
    onSignal(signal)
  })

  channel.on('presence', { event: 'sync' }, () => {
    const state = channel.presenceState<{ role: Role }>()
    onPeers?.(
      Object.entries(state)
        .filter(([key]) => key !== id)
        .map(([key, metas]) => ({ id: key, role: metas[0]?.role ?? 'viewer' })),
    )
  })

  channel.on('presence', { event: 'leave' }, ({ key }) => {
    if (key !== id) onPeerLeave?.(key)
  })

  return new Promise((resolve, reject) => {
    let settled = false
    channel.subscribe(async (status, err) => {
      if (status === 'SUBSCRIBED' && !settled) {
        settled = true
        await channel.track({ role })
        resolve({
          send: (signal) => {
            void channel.send({ type: 'broadcast', event: 'signal', payload: signal })
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
