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

  const { roomId, playerIds } = await req.json() as { roomId: string; playerIds: string[] }

  if (!roomId || !playerIds?.length) {
    return new Response(JSON.stringify({ error: 'roomId and playerIds required' }), {
      status: 400, headers: { ...CORS, 'Content-Type': 'application/json' },
    })
  }

  const supabase = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    { auth: { persistSession: false } }
  )

  // Shuffle a fresh 52-card deck
  const deck = fisherYates(createDeck())

  // Deal 7 cards to each player from the top of the deck
  const hands: Record<string, string[]> = {}
  for (const playerId of playerIds) {
    hands[playerId] = deck.splice(0, 7)
  }
  // Remaining cards stay face-down in the deck

  const { error } = await supabase
    .from('games')
    .upsert({ id: roomId, deck, hands, updated_at: new Date().toISOString() }, { onConflict: 'id' })

  if (error) {
    return new Response(JSON.stringify({ error: error.message }), {
      status: 500, headers: { ...CORS, 'Content-Type': 'application/json' },
    })
  }

  return new Response(JSON.stringify({ ok: true, dealt: playerIds.length, remaining: deck.length }), {
    headers: { ...CORS, 'Content-Type': 'application/json' },
  })
})
