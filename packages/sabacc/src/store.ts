import { create } from 'zustand';
import type { FloatDelta, GameState, RevealEntry } from './types';

interface SabaccStore {
  connected: boolean;
  state: GameState | null;
  youId: string | null;
  reconnecting: boolean;
  joinError: string | null;
  errorMsg: string | null;

  // Transient animation state.
  floatingDeltas: FloatDelta[];
  diceNonce: number;
  shiftNonce: number;
  showdownReveals: RevealEntry[] | null;

  send: ((msg: unknown) => void) | null;

  setSend: (fn: ((msg: unknown) => void) | null) => void;
  setConnected: (b: boolean) => void;
  setReconnecting: (b: boolean) => void;
  applyServer: (msg: any) => void;
  dismissDelta: (id: number) => void;
  clearError: () => void;
}

let deltaCounter = 0;

export const useStore = create<SabaccStore>((set, get) => ({
  connected: false,
  state: null,
  youId: null,
  reconnecting: false,
  joinError: null,
  errorMsg: null,
  floatingDeltas: [],
  diceNonce: 0,
  shiftNonce: 0,
  showdownReveals: null,
  send: null,

  setSend: (fn) => set({ send: fn }),
  setConnected: (b) => set({ connected: b }),
  setReconnecting: (b) => set({ reconnecting: b }),

  applyServer: (msg) => {
    switch (msg.type) {
      case 'joined': {
        const prev = get().state;
        set({
          youId: msg.you.playerId,
          reconnecting: false,
          joinError: null,
          state: msg.state ?? prev,
        });
        break;
      }

      case 'state': {
        const prevPhase = get().state?.phase;
        const nextState: GameState = msg.state;
        const patch: Partial<SabaccStore> = { state: nextState };
        // A fresh hand wipes the previous showdown reveal.
        if (nextState.phase === 'card' && prevPhase !== 'card') patch.showdownReveals = null;
        set(patch);
        break;
      }

      case 'delta': {
        const deltas = (msg.deltaEvent?.deltas ?? []) as { playerId: string; amount: number; reason: string }[];
        const floats: FloatDelta[] = deltas
          .filter((d) => d.amount !== 0)
          .map((d) => ({ id: ++deltaCounter, playerId: d.playerId, amount: d.amount, reason: d.reason }));
        if (floats.length) set({ floatingDeltas: [...get().floatingDeltas, ...floats] });
        break;
      }

      case 'dice_rolled':
        set({ diceNonce: get().diceNonce + 1 });
        break;

      case 'sabacc_shift':
        set({ shiftNonce: get().shiftNonce + 1 });
        break;

      case 'showdown':
        set({ showdownReveals: msg.reveals ?? [] });
        break;

      case 'error': {
        if (msg.code === 'join_failed' || msg.code === 'reconnect_failed') {
          set({ joinError: msg.message, reconnecting: false });
        } else {
          set({ errorMsg: msg.message });
        }
        break;
      }

      default:
        break;
    }
  },

  dismissDelta: (id) => set({ floatingDeltas: get().floatingDeltas.filter((d) => d.id !== id) }),
  clearError: () => set({ errorMsg: null }),
}));
