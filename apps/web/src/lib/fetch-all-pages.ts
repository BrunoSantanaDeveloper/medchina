/**
 * PostgREST caps every response at `max_rows` (1000 in supabase/config.toml and
 * on the hosted default), and `.limit(10000)` does NOT lift it: the rows past
 * the cap are dropped without an error. A console that filters or exports
 * "everything" must page until the rows run out — this does, in pages of
 * `size`, and stops at the first error with what it already has.
 *
 * `page(from, to)` is the caller's query with `.range(from, to)` applied, over a
 * STABLE order (e.g. created_at + id), or rows could shift between pages.
 */
export async function fetchAllPages<T>(
  page: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: { message: string } | null }>,
  size = 1000,
): Promise<{ data: T[]; error: string | null }> {
  const rows: T[] = [];
  for (let from = 0; ; from += size) {
    const { data, error } = await page(from, from + size - 1);
    if (error) return { data: rows, error: error.message };
    rows.push(...(data ?? []));
    if (!data || data.length < size) return { data: rows, error: null };
  }
}
