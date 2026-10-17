import type { ZodError } from 'zod';

/** Turn a ZodError into a small JSON-friendly list for 400 responses. */
export function issueList(error: ZodError): Array<{ path: string; message: string }> {
  return error.issues.map((issue) => ({ path: issue.path.join('.'), message: issue.message }));
}
