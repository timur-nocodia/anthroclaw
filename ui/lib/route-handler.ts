import { NextResponse } from 'next/server';
import { requireAuth, handleAuthError } from './require-auth';
import { NotFoundError, ValidationError } from './agents';

/**
 * Wraps a route handler with auth check and standardized error handling.
 *
 * Eliminates the repeated try/catch auth + try/catch domain-error pattern
 * across all route files.
 */
export async function withAuth<T>(
  handler: () => Promise<T>,
): Promise<T | NextResponse> {
  try {
    await requireAuth();
  } catch (err) {
    return handleAuthError(err);
  }

  try {
    return await handler();
  } catch (err) {
    if (err instanceof NotFoundError) {
      return NextResponse.json({ error: 'not_found' }, { status: 404 });
    }
    if (err instanceof ValidationError) {
      return NextResponse.json({ error: err.code, message: err.message }, { status: 400 });
    }
    const message = err instanceof Error ? err.message : 'Internal server error';
    return NextResponse.json({ error: 'server_error', message }, { status: 500 });
  }
}
