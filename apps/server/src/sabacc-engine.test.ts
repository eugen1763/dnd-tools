import { describe, it, expect } from 'bun:test';
import {
  buildDeck,
  evaluateHand,
  compareHands,
  rankShowdown,
  startHand,
  applyCardAction,
  applyBetAction,
  type Card,
  type Suit,
  type Player,
  type SabaccGame,
  DEFAULT_CONFIG,
} from './sabacc-engine';

// --- helpers ---------------------------------------------------------------

let n = 0;
function card(value: number, suit: Suit = 'circle'): Card {
  return { id: `c${n++}:${suit}:${value}`, kind: 'suit', suit, value };
}
function sylop(): Card {
  return { id: `s${n++}`, kind: 'sylop', suit: null, value: 0 };
}

function evalCat(cards: Card[]) {
  return evaluateHand(cards).category;
}

// A deterministic RNG (xorshift) so hands/dice are reproducible in flow tests.
function seededRng(seed: number): () => number {
  let s = seed >>> 0 || 1;
  return () => {
    s ^= s << 13;
    s ^= s >>> 17;
    s ^= s << 5;
    s >>>= 0;
    return s / 0xffffffff;
  };
}

function makePlayer(id: string, seatIndex: number, credits: number): Player {
  return {
    id,
    token: `tok-${id}`,
    name: id,
    seatIndex,
    credits,
    hand: [],
    currentBet: 0,
    committedThisHand: 0,
    status: 'active',
    acted: false,
    stood: false,
    connected: true,
    isHost: seatIndex === 0,
    joinedAt: seatIndex,
  };
}

function makeGame(players: Player[]): SabaccGame {
  return {
    id: 'g1',
    createdAt: new Date(0),
    config: { ...DEFAULT_CONFIG },
    phase: 'lobby',
    handNumber: 0,
    round: null,
    players,
    hostId: players[0]?.id ?? null,
    deck: [],
    discard: [],
    pots: { main: 0, sabacc: 0 },
    actorId: null,
    dealerSeatIndex: 0,
    betting: null,
    dice: { rolled: false, faces: null, isMatch: false },
    deltaSeq: 0,
    lastWinnerIds: [],
    lastWinDescription: null,
  };
}

// --- deck ------------------------------------------------------------------

describe('deck', () => {
  it('has 62 cards: 60 suit + 2 sylop', () => {
    const deck = buildDeck();
    expect(deck.length).toBe(62);
    expect(deck.filter((c) => c.kind === 'sylop').length).toBe(2);
    expect(deck.filter((c) => c.kind === 'suit').length).toBe(60);
  });
  it('has every value 1..10 and -1..-10 in each suit, all ids unique', () => {
    const deck = buildDeck();
    const ids = new Set(deck.map((c) => c.id));
    expect(ids.size).toBe(62);
    for (const suit of ['circle', 'triangle', 'square'] as Suit[]) {
      const vals = deck.filter((c) => c.suit === suit).map((c) => c.value).sort((a, b) => a - b);
      const expected = [...Array(10)].map((_, i) => -(i + 1)).concat([...Array(10)].map((_, i) => i + 1)).sort((a, b) => a - b);
      expect(vals).toEqual(expected);
    }
  });
});

// --- hand categories -------------------------------------------------------

describe('hand categories', () => {
  it('detects every named specialty hand', () => {
    expect(evalCat([sylop(), sylop()])).toBe('pureSabacc');
    expect(evalCat([card(10), card(10, 'triangle'), card(-10), card(-10, 'triangle'), sylop()])).toBe('fullSabacc');
    expect(evalCat([card(5), card(5, 'triangle'), card(-5), card(-5, 'triangle'), sylop()])).toBe('fleet');
    expect(evalCat([card(4), card(-4), sylop()])).toBe('yeeHaa');
    expect(evalCat([card(2), card(2, 'triangle'), card(2, 'square'), card(-3), card(-3, 'triangle')])).toBe('rhylet');
    expect(evalCat([card(6), card(6, 'triangle'), card(-6), card(-6, 'triangle')])).toBe('squadron');
    expect(evalCat([card(1), card(2), card(3), card(4), card(-10)])).toBe('geeWhiz');
    expect(evalCat([card(-1), card(-2), card(-3), card(-4), card(10)])).toBe('geeWhiz');
    expect(evalCat([card(7), card(-8), card(-9), card(10)])).toBe('straightKhyron');
    expect(evalCat([card(4), card(4, 'triangle'), card(4, 'square'), card(-3), card(-9)])).toBe('banthasWild');
    expect(evalCat([card(-9), card(9), card(-4), card(4)])).toBe('ruleOfTwo');
    expect(evalCat([card(5), card(-5)])).toBe('sabaccPair');
  });

  it('classifies a zero-sum hand with no pattern as plainZero', () => {
    // +1,+2,-3 sums to 0 but matches no named hand.
    expect(evalCat([card(1), card(2), card(-3)])).toBe('plainZero');
  });

  it('classifies non-zero hands as nulrhek', () => {
    expect(evalCat([card(3), card(-1)])).toBe('nulrhek');
    expect(evalCat([card(-5), card(2)])).toBe('nulrhek');
  });
});

// --- ranking ---------------------------------------------------------------

describe('ranking', () => {
  it('orders the full hierarchy best -> worst', () => {
    const hands = [
      [sylop(), sylop()], // pureSabacc
      [card(10), card(10, 'triangle'), card(-10), card(-10, 'triangle'), sylop()], // fullSabacc
      [card(5), card(5, 'triangle'), card(-5), card(-5, 'triangle'), sylop()], // fleet
      [card(4), card(-4), sylop()], // yeeHaa
      [card(2), card(2, 'triangle'), card(2, 'square'), card(-3), card(-3, 'triangle')], // rhylet
      [card(6), card(6, 'triangle'), card(-6), card(-6, 'triangle')], // squadron
      [card(1), card(2), card(3), card(4), card(-10)], // geeWhiz
      [card(7), card(-8), card(-9), card(10)], // straightKhyron
      [card(4), card(4, 'triangle'), card(4, 'square'), card(-3), card(-9)], // banthasWild
      [card(-9), card(9), card(-4), card(4)], // ruleOfTwo
      [card(5), card(-5)], // sabaccPair
      [card(1), card(2), card(-3)], // plainZero
      [card(3), card(-1)], // nulrhek
    ];
    const evals = hands.map(evaluateHand);
    // Each hand must be strictly better than the next one down the list.
    for (let i = 0; i < evals.length - 1; i++) {
      expect(compareHands(evals[i], evals[i + 1])).toBeLessThan(0);
    }
  });

  it('nulrhek: positive total beats negative of equal magnitude', () => {
    const pos = evaluateHand([card(1)]); // +1
    const neg = evaluateHand([card(-1)]); // -1
    expect(compareHands(pos, neg)).toBeLessThan(0);
  });

  it('nulrhek: closer to zero wins', () => {
    const near = evaluateHand([card(1)]); // +1
    const far = evaluateHand([card(5)]); // +5
    expect(compareHands(near, far)).toBeLessThan(0);
  });

  it('zero tie: more cards wins', () => {
    const more = evaluateHand([card(1), card(2), card(-3)]); // 3 cards, plainZero
    const fewer = evaluateHand([card(3), card(-3)]); // sabaccPair (named) — should still beat plainZero
    // Named hand beats plainZero regardless of card count:
    expect(compareHands(fewer, more)).toBeLessThan(0);
    // Among two plainZero hands, more cards wins:
    const a = evaluateHand([card(1), card(2), card(-3)]); // 3 cards
    const b = evaluateHand([card(4), card(1), card(-2), card(-3)]); // 4 cards, plainZero
    expect(compareHands(b, a)).toBeLessThan(0);
  });

  it('rankShowdown picks the closest-to-zero winner', () => {
    const p1 = makePlayer('p1', 0, 100);
    const p2 = makePlayer('p2', 1, 100);
    const p3 = makePlayer('p3', 2, 100);
    p1.hand = [card(5), card(-2)]; // +3
    p2.hand = [card(1), card(-1)]; // 0 (sabacc pair)
    p3.hand = [card(8), card(-2)]; // +6
    const r = rankShowdown([p1, p2, p3]);
    expect(r.winnerIds).toEqual(['p2']);
    expect(r.winnerHitsZero).toBe(true);
  });
});

// --- full hand flow --------------------------------------------------------

describe('hand flow', () => {
  it('plays a hand to showdown with antes, betting and pot award', () => {
    const rng = seededRng(12345);
    const p1 = makePlayer('p1', 0, 100);
    const p2 = makePlayer('p2', 1, 100);
    const game = makeGame([p1, p2]);

    startHand(game, rng);
    expect(game.handNumber).toBe(1);
    expect(game.pots.main).toBe(2 * 2); // anteMain 2 each
    expect(game.pots.sabacc).toBe(2 * 1); // anteSabacc 1 each
    expect(p1.credits).toBe(97);
    expect(p2.credits).toBe(97);
    expect(p1.hand.length).toBe(2);
    expect(p2.hand.length).toBe(2);
    expect(game.phase).toBe('card');

    // Drive both players through all 3 rounds: everyone stands, then checks.
    let guard = 0;
    while (game.phase !== 'showdown' && game.phase !== 'handOver' && guard++ < 100) {
      const actor = game.actorId!;
      if (game.phase === 'card') {
        applyCardAction(game, actor, 'stand', undefined, rng);
      } else if (game.phase === 'betting') {
        applyBetAction(game, actor, 'check', undefined, rng);
      }
    }

    expect(['showdown', 'handOver']).toContain(game.phase);
    // All ante credits are distributed; no credits vanish.
    const total = p1.credits + p2.credits + game.pots.main + game.pots.sabacc;
    expect(total).toBe(200);
  });

  it('awards the pot to the last player when the other folds', () => {
    const rng = seededRng(99);
    const p1 = makePlayer('p1', 0, 100);
    const p2 = makePlayer('p2', 1, 100);
    const game = makeGame([p1, p2]);
    startHand(game, rng);

    // Round 1 card phase: both stand.
    applyCardAction(game, game.actorId!, 'stand', undefined, rng);
    applyCardAction(game, game.actorId!, 'stand', undefined, rng);
    expect(game.phase).toBe('betting');

    // First better bets, second folds.
    const better = game.actorId!;
    applyBetAction(game, better, 'bet', 5, rng);
    const folder = game.actorId!;
    applyBetAction(game, folder, 'fold', undefined, rng);

    expect(game.phase).toBe('handOver');
    const winner = game.players.find((p) => p.id === better)!;
    // Winner reclaims the pot (their own ante + bet + opponent's ante).
    expect(winner.credits).toBeGreaterThan(97);
    const total = p1.credits + p2.credits + game.pots.main + game.pots.sabacc;
    expect(total).toBe(200);
  });
});
