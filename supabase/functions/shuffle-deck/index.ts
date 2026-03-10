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
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: CORS })
  }

  const { roomId } = await req.json()
  if (!roomId) {
    return new Response(JSON.stringify({ error: 'roomId required' }), {
      status: 400,
      headers: { ...CORS, 'Content-Type': 'application/json' },
    })
  }

  const supabase = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    { auth: { persistSession: false } }
  )

  // 1. Fetch current deck (or fresh ordered deck if room is new)
  const { data: room } = await supabase
    .from('rooms')
    .select('deck')
    .eq('id', roomId)
    .maybeSingle()

  const currentDeck: string[] = room?.deck?.length ? room.deck : createDeck()

  // 2. Shuffle server-side
  const shuffled = fisherYates(currentDeck)
  const now = new Date().toISOString()

  // 3. Persist to DB — the DB change triggers Realtime on all subscribed clients
  const { error: dbError } = await supabase
    .from('rooms')
    .upsert({ id: roomId, deck: shuffled, shuffled_at: now }, { onConflict: 'id' })

  if (dbError) {
    return new Response(JSON.stringify({ error: dbError.message }), {
      status: 500,
      headers: { ...CORS, 'Content-Type': 'application/json' },
    })
  }

  return new Response(JSON.stringify({ ok: true, shuffled_at: now }), {
    headers: { ...CORS, 'Content-Type': 'application/json' },
  })
})
