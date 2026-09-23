const turnUrl = import.meta.env.VITE_TURN_URL as string | undefined

const iceServers: RTCIceServer[] = [
  { urls: ['stun:stun.l.google.com:19302', 'stun:stun1.l.google.com:19302'] },
]

if (turnUrl) {
  iceServers.push({
    urls: turnUrl.split(',').map((u) => u.trim()),
    username: import.meta.env.VITE_TURN_USERNAME,
    credential: import.meta.env.VITE_TURN_CREDENTIAL,
  })
}

export const rtcConfig: RTCConfiguration = { iceServers }

const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'

export function randomCode(length = 6) {
  const bytes = crypto.getRandomValues(new Uint8Array(length))
  return Array.from(bytes, (b) => ALPHABET[b % ALPHABET.length]).join('')
}

export function randomId() {
  return crypto.randomUUID()
}

export const canShareScreen =
  typeof navigator !== 'undefined' && Boolean(navigator.mediaDevices?.getDisplayMedia)
