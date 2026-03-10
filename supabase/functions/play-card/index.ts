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

  // Fetch current game state
  const { data: game, error: fetchError } = await supabase
    .from('games')
    .select('deck, hands')
    .eq('id', roomId)
    .single()

  if (fetchError || !game) {
    return new Response(JSON.stringify({ error: 'Game not found' }), {
      status: 404, headers: { ...CORS, 'Content-Type': 'application/json' },
    })
  }

  const deck = game.deck as string[]
  const hands = game.hands as Record<string, string[]>
  const playerHand = hands[playerId] ?? []

  // Validate the card is actually in the player's hand
  const cardIndex = playerHand.indexOf(card)
  if (cardIndex === -1) {
    return new Response(JSON.stringify({ error: 'Card not in hand' }), {
      status: 400, headers: { ...CORS, 'Content-Type': 'application/json' },
    })
  }

  // Discard the played card
  playerHand.splice(cardIndex, 1)

  // Draw a replacement from the top of the deck (if any remain)
  const drawnCard = deck.length > 0 ? deck.shift()! : null
  if (drawnCard) playerHand.push(drawnCard)

  hands[playerId] = playerHand

  const { error: updateError } = await supabase
    .from('games')
    .update({ deck, hands, updated_at: new Date().toISOString() })
    .eq('id', roomId)

  if (updateError) {
    return new Response(JSON.stringify({ error: updateError.message }), {
      status: 500, headers: { ...CORS, 'Content-Type': 'application/json' },
    })
  }

  return new Response(JSON.stringify({ ok: true, drew: drawnCard, deckRemaining: deck.length }), {
    headers: { ...CORS, 'Content-Type': 'application/json' },
  })
})
