export function parsePagination(input: {
  page?: unknown;
  limit?: unknown;
}): { page: number; limit: number; skip: number } {
  const page = Math.max(1, Number(input.page ?? 1) || 1);
  const limit = Math.min(48, Math.max(1, Number(input.limit ?? 12) || 12));
  const skip = (page - 1) * limit;
  return { page, limit, skip };
}

