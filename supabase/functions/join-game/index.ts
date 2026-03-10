import { createClient } from 'npm:@supabase/supabase-js@2'

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS })

  const { roomId, playerId, playerName } = await req.json() as {
    roomId: string
    playerId: string
    playerName: string
  }

  if (!roomId || !playerId || !playerName) {
    return new Response(JSON.stringify({ error: 'roomId, playerId and playerName required' }), {
      status: 400, headers: { ...CORS, 'Content-Type': 'application/json' },
    })
  }

  const supabase = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    { auth: { persistSession: false } }
  )

  // Fetch existing game (if any)
  const { data: existing } = await supabase
    .from('games')
    .select('players, ready, status')
    .eq('id', roomId)
    .maybeSingle()

  if (existing) {
    // Game already exists — only register the player if still in lobby
    if (existing.status === 'lobby') {
      const players = { ...(existing.players as Record<string, string>), [playerId]: playerName }
      await supabase.from('games').update({ players }).eq('id', roomId)
    }
    // If game is already playing, joining is read-only (spectate / rejoin)
  } else {
    // First player creates the game
    await supabase.from('games').insert({
      id: roomId,
      status: 'lobby',
      players: { [playerId]: playerName },
      ready: {},
      deck: [],
      hands: {},
    })
  }

  return new Response(JSON.stringify({ ok: true }), {
    headers: { ...CORS, 'Content-Type': 'application/json' },
  })
})
