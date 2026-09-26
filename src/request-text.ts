// Observed records status 0 only for a request that a redirect answered: the
// collector reports no status for it.
export function describeStatus(status: number): string {
  return status === 0 ? 'not recorded (redirected)' : String(status);
}
