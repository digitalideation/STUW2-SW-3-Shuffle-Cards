import { createClient } from 'npm:@supabase/supabase-js@2'

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS })

  const { roomId, playerId, card } = await req.json() as {
    roomId: string
    playerId: string
    card: string
  }

  if (!roomId || !playerId || !card) {
    return new Response(JSON.stringify({ error: 'roomId, playerId and card required' }), {
      status: 400, headers: { ...CORS, 'Content-Type': 'application/json' },
    })
  }

  const supabase = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    { auth: { persistSession: false } }
  )

  // Single RPC call — the Postgres function handles everything atomically:
  //   1. SELECT ... FOR UPDATE  →  locks the row
  //   2. Validates card is in hand
  //   3. Removes card, draws replacement from deck
  //   4. UPDATE games           →  writes back and releases lock
  // Two simultaneous calls are serialised by the row lock, not interleaved.
  const { data, error } = await supabase.rpc('play_card', {
    p_room_id:   roomId,
    p_player_id: playerId,
    p_card:      card,
  })

  if (error) {
    const status = error.message.includes('not found') ? 404 : 400
    return new Response(JSON.stringify({ error: error.message }), {
      status, headers: { ...CORS, 'Content-Type': 'application/json' },
    })
  }

  return new Response(JSON.stringify({ ok: true, ...data }), {
    headers: { ...CORS, 'Content-Type': 'application/json' },
  })
})
