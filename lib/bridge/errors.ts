export function isUserRejected(err: any): boolean {
  const code = err?.code
  const name = err?.name
  const msg = String(err?.shortMessage || err?.message || '')

  return code === 4001 || name === 'UserRejectedRequestError' || msg.includes('rejected')
}