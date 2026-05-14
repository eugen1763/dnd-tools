export enum LetterState {
  Miss = 0,
  Present = 1,
  Match = 2,
}

export function detectMode(secret: string): 'numbers' | 'letters' | 'mixed' {
  if (/^[0-9]+$/.test(secret)) return 'numbers';
  if (/^[A-Z]+$/.test(secret)) return 'letters';
  return 'mixed';
}

export function computeGuess(guess: string, answer: string): LetterState[] {
  const result: LetterState[] = new Array(guess.length).fill(LetterState.Miss);
  const answerChars = answer.split('');
  const guessChars = guess.split('');

  for (let i = 0; i < guessChars.length; i++) {
    if (guessChars[i] === answerChars[i]) {
      result[i] = LetterState.Match;
      answerChars[i] = '';
      guessChars[i] = '';
    }
  }

  for (let i = 0; i < guessChars.length; i++) {
    if (guessChars[i] === '') continue;
    const idx = answerChars.indexOf(guessChars[i]);
    if (idx !== -1) {
      result[i] = LetterState.Present;
      answerChars[idx] = '';
    }
  }

  return result;
}

export function isValidWord(guess: string, mode: string): boolean {
  switch (mode) {
    case 'numbers':
      return /^[0-9]+$/.test(guess);
    case 'letters':
      return /^[A-Z]+$/.test(guess);
    case 'mixed':
      return /^[A-Z0-9]+$/.test(guess);
    default:
      return false;
  }
}

export function getRandomWord(): string {
  const words = [
    'APPLE', 'BRAIN', 'CRANE', 'DREAM', 'EAGLE', 'FLAME', 'GRACE', 'HEART',
    'IMAGE', 'JUICE', 'KNIFE', 'LIGHT', 'MOUNT', 'NIGHT', 'OCEAN', 'PEACE',
    'QUEEN', 'RIVER', 'STONE', 'TIGER', 'UNDER', 'VOICE', 'WATER', 'YOUTH',
    'ZEBRA', 'BREAD', 'CLOUD', 'DANCE', 'EARTH', 'FROST',
  ];
  return words[Math.floor(Math.random() * words.length)];
}
