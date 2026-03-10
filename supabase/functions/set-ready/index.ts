import { createClient } from 'npm:@supabase/supabase-js@2'

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

const SUITS = ['♠', '♥', '♦', '♣']
const RANKS = ['A', '2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K']

function createDeck(): string[] {
  return SUITS.flatMap(suit => RANKS.map(rank => `${rank}${suit}`))
}

function fisherYates(arr: string[]): string[] {
  const a = [...arr]
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1))
    ;[a[i], a[j]] = [a[j], a[i]]
  }
  return a
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS })

  const { roomId, playerId } = await req.json() as { roomId: string; playerId: string }

  if (!roomId || !playerId) {
    return new Response(JSON.stringify({ error: 'roomId and playerId required' }), {
      status: 400, headers: { ...CORS, 'Content-Type': 'application/json' },
    })
  }

  const supabase = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    { auth: { persistSession: false } }
  )

  const { data: game, error: fetchError } = await supabase
    .from('games')
    .select('*')
    .eq('id', roomId)
    .single()

  if (fetchError || !game) {
    return new Response(JSON.stringify({ error: 'Game not found' }), {
      status: 404, headers: { ...CORS, 'Content-Type': 'application/json' },
    })
  }

  const players = game.players as Record<string, string>
  const ready = { ...(game.ready as Record<string, boolean>), [playerId]: true }
  const playerIds = Object.keys(players)

  // Check if all registered players (min 2) are now ready
  const allReady = playerIds.length >= 2 && playerIds.every(id => ready[id])

  if (allReady) {
    // Server deals: shuffle a fresh deck and give 7 cards to each player
    const deck = fisherYates(createDeck())
    const hands: Record<string, string[]> = {}
    for (const id of playerIds) {
      hands[id] = deck.splice(0, 7)
    }

    await supabase
      .from('games')
      .update({ ready, deck, hands, status: 'playing', updated_at: new Date().toISOString() })
      .eq('id', roomId)

    return new Response(JSON.stringify({ ok: true, started: true }), {
      headers: { ...CORS, 'Content-Type': 'application/json' },
    })
  }

  // Not everyone ready yet — just update the ready map
  await supabase
    .from('games')
    .update({ ready, updated_at: new Date().toISOString() })
    .eq('id', roomId)

  return new Response(JSON.stringify({ ok: true, started: false }), {
    headers: { ...CORS, 'Content-Type': 'application/json' },
  })
})
