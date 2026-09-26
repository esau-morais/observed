// Status 0 means no response status was recorded, as for a request that a
// redirect answered.
export function describeStatus(status: number): string {
  return status === 0 ? 'not recorded' : String(status);
}
