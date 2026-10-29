import type { Prisma } from "@prisma/client";

export interface PaginationParams {
  page: number;
  limit: number;
  skip: number;
}

export const parsePagination = (query: Record<string, unknown>): PaginationParams => {
  const page = Math.max(1, Number(query.page ?? 1) || 1);
  const rawLimit = Number(query.limit ?? 20) || 20;
  const limit = Math.min(100, Math.max(1, rawLimit));
  return { page, limit, skip: (page - 1) * limit };
};

export const paginated = <T>(
  items: T[],
  total: number,
  { page, limit }: PaginationParams,
) => ({
  items,
  meta: {
    page,
    limit,
    total,
    totalPages: Math.ceil(total / limit),
    hasNext: page * limit < total,
    hasPrev: page > 1,
  },
});

export const buildMeta = (total: number, { page, limit }: PaginationParams) => ({
  page,
  limit,
  total,
  totalPages: Math.ceil(total / limit),
  hasNext: page * limit < total,
  hasPrev: page > 1,
});

export type { Prisma };
