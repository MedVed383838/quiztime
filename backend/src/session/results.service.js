function compareParticipants(left, right) {
  if (right.totalScore !== left.totalScore) return right.totalScore - left.totalScore;
  if (right.correctAnswersCount !== left.correctAnswersCount) return right.correctAnswersCount - left.correctAnswersCount;
  const joinedAtDifference = left.joinedAt.getTime() - right.joinedAt.getTime();
  return joinedAtDifference || left.id - right.id;
}

export function buildLeaderboard(participants) {
  const sorted = [...participants].sort(compareParticipants);
  let previous = null;
  let rank = 0;

  return sorted.map((participant, index) => {
    const sameResult = previous
      && previous.totalScore === participant.totalScore
      && previous.correctAnswersCount === participant.correctAnswersCount;
    if (!sameResult) rank = index + 1;
    previous = participant;

    return {
      rank,
      participantId: participant.id,
      displayName: participant.displayNameSnapshot,
      totalScore: participant.totalScore,
      correctAnswersCount: participant.correctAnswersCount,
    };
  });
}

export function resultForParticipant(leaderboard, participantId) {
  const item = leaderboard.find((entry) => entry.participantId === participantId);
  if (!item) return null;
  return {
    rank: item.rank,
    totalScore: item.totalScore,
    correctAnswersCount: item.correctAnswersCount,
  };
}
