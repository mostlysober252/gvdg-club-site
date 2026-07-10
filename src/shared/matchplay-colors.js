export const TEAM_COLORS = { red: "#dc3545", blue: "#2f6fd0", tie: "#e6b400" };

export function teamSide(team) {
  const value = String(team == null ? "" : team).toLowerCase();
  if (value.includes("red")) return "red";
  if (value.includes("blue")) return "blue";
  return null;
}

export function holeWinner(redScore, blueScore) {
  if (typeof redScore !== "number" || typeof blueScore !== "number") return null;
  if (redScore < blueScore) return "red";
  if (blueScore < redScore) return "blue";
  return "tie";
}

export function holeWinners(holes, players) {
  const list = Array.isArray(players) ? players : [];
  const sideScore = (side, hole) => {
    for (const player of list) {
      if (teamSide(player && player.team) !== side) continue;
      const score = player.scores ? player.scores[hole] : undefined;
      if (typeof score === "number") return score;
    }
    return null;
  };
  const winners = {};
  for (const hole of Array.isArray(holes) ? holes : []) {
    if (hole && hole.hole != null) winners[hole.hole] = holeWinner(sideScore("red", hole.hole), sideScore("blue", hole.hole));
  }
  return winners;
}

export function winnerColor(winner, opts) {
  if (winner === "red" || winner === "blue") return TEAM_COLORS[winner];
  if (winner === "tie" && !(opts && opts.tie === false)) return TEAM_COLORS.tie;
  return null;
}

export function playersFromResults(results) {
  return (Array.isArray(results) ? results : []).map((result) => {
    let team = null;
    try {
      team = JSON.parse(result.scoring_group || "null");
    } catch {
      team = null;
    }
    const scores = {};
    let card = [];
    try {
      card = JSON.parse(result.scorecard || "[]");
    } catch {
      card = [];
    }
    for (const hole of Array.isArray(card) ? card : []) {
      if (hole && hole.hole != null && typeof hole.strokes === "number") scores[hole.hole] = hole.strokes;
    }
    return { team: team && team.label ? team.label : null, scores };
  });
}
