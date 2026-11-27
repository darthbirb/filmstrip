// Files a delete or a move is still sending, so a second press on them sends nothing.
const going = new Set<number>();

/**
 * Runs `work` for files none of which a delete or a move is still sending; otherwise nothing, and
 * hands back null. DECISIONS.md "One press, one act".
 */
export async function once<T>(itemIds: readonly number[], work: () => Promise<T>) {
  if (itemIds.some((id) => going.has(id))) return null;
  for (const id of itemIds) going.add(id);
  try {
    return await work();
  } finally {
    for (const id of itemIds) going.delete(id);
  }
}
