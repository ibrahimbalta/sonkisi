import { ARENA_CONFIG } from '../../../shared/src/index';

/**
 * Returns true if tile (row, col) exists as solid floor in the given Level (1..10),
 * or false if it is an open void/pit (giving every level a distinct 3D arena shape!).
 */
export function isTileActiveInLevel(level: number, row: number, col: number): boolean {
  const cols = ARENA_CONFIG.GRID_COLS; // 12
  const rows = ARENA_CONFIG.GRID_ROWS; // 12
  const cx = (cols - 1) / 2; // 5.5
  const cy = (rows - 1) / 2; // 5.5
  const dx = Math.abs(col - cx);
  const dy = Math.abs(row - cy);
  const dist = Math.hypot(dx, dy);

  switch (Math.max(1, Math.min(10, Math.floor(level)))) {
    case 1:
      // Lv.1 Bulut Tapınağı: Classic full 12x12 square
      return true;

    case 2:
      // Lv.2 Büyülü Orman: Octagon (cut corners)
      return dx + dy <= 8.6;

    case 3:
      // Lv.3 Buzul Zirvesi: Hollow Center Pit (Donut arena!)
      return !(dx < 1.6 && dy < 1.6);

    case 4:
      // Lv.4 Lav Kalesi: Giant Cross / Plus shape (4 corner lava pits)
      return !(dx > 3.4 && dy > 3.4);

    case 5:
      // Lv.5 Siber Arena: Twin platforms connected by 2 neon bridges
      if (col >= 5 && col <= 6) {
        return row === 2 || row === 3 || row === 8 || row === 9;
      }
      return true;

    case 6:
      // Lv.6 Altın Çöl: 4 Symmetrical Sand Pits
      if ((row === 2 || row === 3) && (col === 2 || col === 3)) return false;
      if ((row === 2 || row === 3) && (col === 8 || col === 9)) return false;
      if ((row === 8 || row === 9) && (col === 2 || col === 3)) return false;
      if ((row === 8 || row === 9) && (col === 8 || col === 9)) return false;
      return true;

    case 7:
      // Lv.7 Kozmik Boşluk: Circular Floating Space Disk!
      return dist <= 5.85;

    case 8:
      // Lv.8 Kristal Labirent: Scattered Abyss Holes
      if ((row === 1 || row === 10) && (col === 1 || col === 10)) return false;
      if ((row === 5 || row === 6) && (col === 2 || col === 9)) return false;
      if ((row === 2 || row === 9) && (col === 5 || col === 6)) return false;
      return true;

    case 9:
      // Lv.9 Fırtına Kulesi: Tight 10x10 Storm Platform (outer rim gone!)
      return row >= 1 && row <= 10 && col >= 1 && col <= 10;

    case 10:
    default:
      // Lv.10 Ejderha Tahtı: Final Boss Citadel (Center Throne + 4 Bridges + 4 Corner Islands)
      if (dx <= 2.6 && dy <= 2.6) return true; // Center throne
      if (dx <= 0.8 || dy <= 0.8) return true; // 4 narrow bridges
      if (dx >= 3.4 && dy >= 3.4) return true; // 4 corner islands
      return false;
  }
}
