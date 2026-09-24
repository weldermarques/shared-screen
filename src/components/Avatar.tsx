// Mesmas cores e mesma regra do app desktop (app/ui/voice.py): cor = md5(nome) % 8,
// para cada pessoa ter a mesma cor no app e no navegador.
const AVATAR_COLORS = ['#5b8cff', '#e0679a', '#43b581', '#f0a04b', '#9b6bff', '#2fb3c7', '#e05d5d', '#8a9a3c']

export function initials(name: string) {
  const words = name.replace(/[_.]/g, ' ').split(/\s+/).filter(Boolean)
  if (words.length >= 2) return (words[0][0] + words[1][0]).toUpperCase()
  return (name.slice(0, 2) || '?').toUpperCase()
}

export function avatarColor(name: string) {
  const digest = md5(new TextEncoder().encode(name))
  // int(hex, 16) % 8 no Python = último byte % 8.
  return AVATAR_COLORS[digest[15] % AVATAR_COLORS.length]
}

export function Avatar({ name, speaking = false, size = 32 }: { name: string; speaking?: boolean; size?: number }) {
  return (
    <span
      className={`avatar${speaking ? ' speaking' : ''}`}
      style={{ width: size, height: size, ['--avatar-color' as string]: avatarColor(name) }}
      aria-hidden
    >
      <span>{initials(name)}</span>
    </span>
  )
}

// ------------------------------------------------------------------ MD5 (RFC 1321), só para a cor

const S = [7, 12, 17, 22, 5, 9, 14, 20, 4, 11, 16, 23, 6, 10, 15, 21]
const K = Array.from({ length: 64 }, (_, i) => Math.floor(Math.abs(Math.sin(i + 1)) * 2 ** 32) >>> 0)

function md5(bytes: Uint8Array): Uint8Array {
  const len = bytes.length
  const padded = new Uint8Array((((len + 8) >> 6) + 1) << 6)
  padded.set(bytes)
  padded[len] = 0x80
  const view = new DataView(padded.buffer)
  view.setUint32(padded.length - 8, (len * 8) >>> 0, true)
  view.setUint32(padded.length - 4, Math.floor(len / 0x20000000), true)

  let a0 = 0x67452301, b0 = 0xefcdab89, c0 = 0x98badcfe, d0 = 0x10325476
  for (let off = 0; off < padded.length; off += 64) {
    let a = a0, b = b0, c = c0, d = d0
    for (let i = 0; i < 64; i++) {
      let f: number, g: number
      if (i < 16) { f = (b & c) | (~b & d); g = i }
      else if (i < 32) { f = (d & b) | (~d & c); g = (5 * i + 1) % 16 }
      else if (i < 48) { f = b ^ c ^ d; g = (3 * i + 5) % 16 }
      else { f = c ^ (b | ~d); g = (7 * i) % 16 }
      const m = view.getUint32(off + g * 4, true)
      const s = S[(i >> 4) * 4 + (i % 4)]
      const sum = (a + f + K[i] + m) >>> 0
      a = d; d = c; c = b
      b = (b + ((sum << s) | (sum >>> (32 - s)))) >>> 0
    }
    a0 = (a0 + a) >>> 0; b0 = (b0 + b) >>> 0; c0 = (c0 + c) >>> 0; d0 = (d0 + d) >>> 0
  }
  const out = new Uint8Array(16)
  const ov = new DataView(out.buffer)
  ;[a0, b0, c0, d0].forEach((v, i) => ov.setUint32(i * 4, v, true))
  return out
}
