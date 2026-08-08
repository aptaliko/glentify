import type { NextRequest } from 'next/server';

export function getUserId(request: NextRequest): number {
  const header = request.headers.get('x-user-id');
  const userId = header ? Number(header) : NaN;
  if (!Number.isInteger(userId)) {
    throw new Error('Missing x-user-id header — proxy.ts should have set this for every authenticated request');
  }
  return userId;
}
