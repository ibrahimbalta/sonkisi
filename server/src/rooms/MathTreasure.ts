export interface MathClue {
  targetRow: number; // 0..11 (displayed as 1..12)
  targetCol: number; // 0..11 (displayed as 1..12)
  colExpr: string;
  rowExpr: string;
  difficultyLabel: string;
  rewardPoints: number;
}

function makeExprForValue(val: number, tier: number): string {
  // val is 1..12
  if (tier === 1) {
    // Easy: Addition or Subtraction
    if (Math.random() < 0.55 && val >= 2) {
      const a = 1 + Math.floor(Math.random() * (val - 1));
      const b = val - a;
      return `${a} + ${b}`;
    } else {
      const b = 2 + Math.floor(Math.random() * 8);
      const a = val + b;
      return `${a} - ${b}`;
    }
  }

  if (tier === 2) {
    // Medium: Multiplication, Division, or larger Add/Sub
    const divisors: [number, number][] = [];
    for (let a = 2; a <= 6; a++) {
      if (val % a === 0 && val / a >= 2) {
        divisors.push([a, val / a]);
      }
    }
    if (divisors.length > 0 && Math.random() < 0.5) {
      const [a, b] = divisors[Math.floor(Math.random() * divisors.length)];
      return `${a} × ${b}`;
    }
    const mult = 2 + Math.floor(Math.random() * 4);
    return `${val * mult} ÷ ${mult}`;
  }

  // Tier 3 (Hard / Final): Two-step operations & Square Roots
  const perfectSquares: Record<number, number> = {
    2: 4,
    3: 9,
    4: 16,
    5: 25,
    6: 36,
    7: 49,
    8: 64,
    9: 81,
    10: 100,
  };

  if (perfectSquares[val] && Math.random() < 0.35) {
    return `√${perfectSquares[val]}`;
  }

  if (Math.random() < 0.5) {
    const a = 2 + Math.floor(Math.random() * 4);
    const b = 2 + Math.floor(Math.random() * 4);
    const prod = a * b;
    if (prod >= val) {
      return `(${a} × ${b}) - ${prod - val}`;
    }
    return `(${a} × ${b}) + ${val - prod}`;
  } else {
    const mult = 2 + Math.floor(Math.random() * 3);
    const offset = 1 + Math.floor(Math.random() * 4);
    if (val > offset) {
      return `(${(val - offset) * mult} ÷ ${mult}) + ${offset}`;
    }
    return `(${(val + offset) * mult} ÷ ${mult}) - ${offset}`;
  }
}

export function generateTreasureClue(round: number, totalRounds: number): MathClue {
  // Keep treasures inside 1..10 (indices 1..10) so they are always reachable inside the arena!
  const targetCol = 1 + Math.floor(Math.random() * 10); // 1..10 -> display 2..11
  const targetRow = 1 + Math.floor(Math.random() * 10); // 1..10 -> display 2..11

  const displayCol = targetCol + 1;
  const displayRow = targetRow + 1;

  const isFinal = round >= totalRounds;
  const tier = isFinal ? 3 : round <= 2 ? 1 : round <= 4 ? 2 : 3;

  const difficultyLabel = isFinal
    ? '👑 FİNAL HAZİNESİ (2× PUAN)'
    : tier === 1
    ? '🗺️ KOLAY HARİTA'
    : tier === 2
    ? '🧭 ORTA HARİTA'
    : '🔥 ZOR HARİTA';

  return {
    targetRow,
    targetCol,
    colExpr: makeExprForValue(displayCol, tier),
    rowExpr: makeExprForValue(displayRow, tier),
    difficultyLabel,
    rewardPoints: isFinal ? 300 : 150,
  };
}
