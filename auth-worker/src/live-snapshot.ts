import type { ScoreConflict } from "./live-consensus.js";
import type { PlayerState } from "./scoring.js";
import { canEnterScorecard, computeRoundStandings, healthyTargets, publicScoreTargets, resolvedHoles, scorecardIssues, scoringState } from "./live-state.js";
import type { LiveMeta } from "./live-types.js";

export function publicSnapshot(meta: LiveMeta | null, players: PlayerState[]) {
  const holes = resolvedHoles(meta);
  const scoring = scoringState(meta, players);
  const issues = scorecardIssues(meta, players, holes, scoring);
  const standings = scoring.globalError
    ? []
    : computeRoundStandings({ holes, players, config: scoring.config, targets: healthyTargets(scoring) }).map((standing) => ({
        name: standing.name,
        division: standing.division,
        thru: standing.thru,
        total: standing.total,
        toPar: standing.toPar,
        targetId: standing.targetId,
        targetType: standing.targetType,
        playerIndexes: standing.playerIndexes,
        members: standing.members,
        scoringGroup: standing.scoringGroup ?? null,
        match: standing.match ?? null,
      }));
  return {
    status: meta?.status ?? "none",
    rev: meta?.rev ?? 0,
    eventId: meta?.eventId ?? null,
    roundConfig: scoring.config,
    scoreTargets: publicScoreTargets(players, scoring.targets),
    // Public /ws broadcast: only a WHOLE-round error rides the global field (a per-card break must NOT bleed
    // into every viewer's global state). Per-card detail is in the additive scoreTargetErrors array.
    scoreTargetError: scoring.globalError,
    scoreTargetErrors: scoring.cardErrors,
    courseName: meta?.courseName ?? null,
    layoutName: meta?.layoutName ?? null,
    udiscCourseId: meta?.udiscCourseId ?? null,
    weather: meta?.weather ?? null,
    holes,
    players: players
      .map((player, index) => ({ player, index }))
      .filter((item) => !item.player.removed)
      .map(({ player, index }) => ({
        index,
        cardId: player.cardId ?? null,
        name: player.name,
        division: player.division ?? null,
        team: player.team ?? null,
        startingHole: player.startingHole ?? null,
        scores: player.scores,
        scorecards: player.scorecards ?? {},
      })),
    conflicts: issues.conflicts,
    missing: issues.missing,
    standings,
    updatedAt: meta?.startedAt ?? null,
  };
}

export function mineData(meta: LiveMeta | null, players: PlayerState[], authMember: string | null): Record<string, unknown> {
  const holes = resolvedHoles(meta);
  const scoring = scoringState(meta, players);
  const standings = scoring.globalError
    ? []
    : computeRoundStandings({ holes, players, config: scoring.config, targets: healthyTargets(scoring) }).map((standing) => ({
        name: standing.name,
        division: standing.division,
        thru: standing.thru,
        total: standing.total,
        toPar: standing.toPar,
        targetId: standing.targetId,
        targetType: standing.targetType,
        playerIndexes: standing.playerIndexes,
        members: standing.members,
        scoringGroup: standing.scoringGroup ?? null,
        match: standing.match ?? null,
      }));
  const meRaw = authMember ? players.findIndex((player) => player.memberId === authMember) : -1;
  const foundPlayer = meRaw >= 0 ? players[meRaw] : undefined;
  const meIdx = foundPlayer && !foundPlayer.removed ? meRaw : -1;
  // Scope the caller's scoreTargetError to THEIR OWN situation: a member on a healthy pair sees null (so
  // their scorecard renders and /score succeeds) even if another pair on their card is broken; a member
  // whose own pair/card is broken sees exactly that error.
  const myCard = meIdx >= 0 ? (players[meIdx]?.cardId ?? null) : null;
  const iAmBroken = meIdx >= 0 && scoring.brokenPlayers.includes(meIdx);
  const myError =
    scoring.globalError ??
    (iAmBroken ? (scoring.cardErrors.find((e) => e.playerIndexes.includes(meIdx)) ?? scoring.cardErrors.find((e) => e.cardId === myCard) ?? scoring.error) : null);
  const base = {
    eventId: meta?.eventId ?? 0,
    casual: !!meta?.casual,
    roundConfig: scoring.config,
    scoreTargets: publicScoreTargets(players, scoring.targets),
    scoreTargetError: myError ? { code: myError.code, message: myError.message } : null,
    scoreTargetErrors: scoring.cardErrors,
    courseName: meta?.courseName ?? null,
    layoutName: meta?.layoutName ?? null,
    udiscCourseId: meta?.udiscCourseId ?? null,
    weather: meta?.weather ?? null,
    status: meta?.status ?? "none",
    holes,
    standings,
  };
  if (meIdx < 0) return { ...base, cardId: null, playerIndex: null, cardmates: [], conflicts: [], missing: [] };
  const me = players[meIdx];
  if (!me) return { ...base, cardId: null, playerIndex: null, cardmates: [], conflicts: [], missing: [] };
  const cardId = me.cardId ?? null;
  const cardmates = players
    .map((player, index) => ({ player, index }))
    .filter((item) => !item.player.removed && (item.player.cardId ?? null) === cardId)
    .map(({ player, index }) => ({
      index,
      cardId: player.cardId ?? null,
      name: player.name,
      division: player.division ?? null,
      team: player.team ?? null,
      startingHole: player.startingHole ?? null,
      scores: player.scores,
      scorecards: player.scorecards ?? {},
      isMe: index === meIdx,
      canEnterScorecard: canEnterScorecard(player, authMember),
    }));
  const issues = scorecardIssues(meta, players, holes, scoring);
  return {
    ...base,
    cardId,
    playerIndex: meIdx,
    cardmates,
    conflicts: issues.conflicts.filter((conflict: ScoreConflict) => conflict.cardId === cardId),
    missing: issues.missing.filter((missing) => missing.cardId === cardId),
  };
}
