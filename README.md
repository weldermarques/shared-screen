# Shared Screen

App web de compartilhamento de tela. Vite + React + TypeScript, hospedado na Vercel,
com **Supabase Realtime** como servidor de sinalização (plano gratuito, sem tabelas).

## Como funciona

```
Apresentador ──getDisplayMedia──► RTCPeerConnection ══ vídeo P2P (WebRTC) ══► Espectador
      │                                                                         │
      └──────── offer / answer / ICE via Supabase Realtime (Broadcast) ─────────┘
                       Presence: quem está na sala / quem saiu
```

- O vídeo **não passa pelo Supabase**: vai direto do navegador do apresentador para cada espectador.
- O apresentador abre uma conexão por espectador (malha 1→N). Funciona bem para ~5–10 espectadores;
  acima disso o upload do apresentador vira gargalo (aí o caminho é um SFU, ex. LiveKit).

## Rodando localmente

1. Crie um projeto em https://supabase.com (free).
2. Em **Project Settings → API**, copie a *Project URL* e a *anon/publishable key*.
3. `cp .env.example .env.local` e preencha as variáveis.
4. `npm install && npm run dev` → abra http://localhost:5173

Para testar, abra `/host` numa aba e o link gerado em outra aba/janela ou outro dispositivo.

> Em **Realtime → Settings** do Supabase, deixe "Allow public access" habilitado
> (padrão) — o app usa canais públicos com a anon key.

## Deploy na Vercel

1. Suba o repositório no GitHub e importe na Vercel (framework detectado: **Vite**).
2. Em **Settings → Environment Variables**, adicione `VITE_SUPABASE_URL` e `VITE_SUPABASE_ANON_KEY`
   (e as de TURN, se usar).
3. Deploy. O `vercel.json` já redireciona `/r/CODIGO` e `/host` para o SPA.

Ou via CLI: `npx vercel` e depois `npx vercel --prod`.

## TURN (opcional, mas recomendado)

Só com STUN, ~10–20% das conexões falham (redes corporativas, 4G, NAT simétrico).
Para cobrir esses casos configure um TURN, ex. o free tier do https://www.metered.ca/stun-turn:

```
VITE_TURN_URL=turn:global.relay.metered.ca:80,turn:global.relay.metered.ca:443?transport=tcp
VITE_TURN_USERNAME=...
VITE_TURN_CREDENTIAL=...
```

## Limitações

- Compartilhar tela só funciona em navegadores de **desktop**; celular pode apenas assistir.
- Áudio: somente ao compartilhar uma **aba** (Chrome/Edge) ou a tela inteira no Windows.
- Salas não têm senha: quem tiver o código de 6 caracteres pode assistir.
