/** The next person in turn: candidates are put in id order and the one after the last assigned (wrapping around) gets it. */
export function pickRoundRobin(candidateIds: readonly string[], lastAssignedId: string | null): string {
  const sorted = [...new Set(candidateIds)].sort();
  return sorted.find((id) => lastAssignedId === null || id > lastAssignedId) ?? sorted[0]!;
}
