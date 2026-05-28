// lib/auth.ts
import { randomBytes, randomUUID } from 'crypto'
import type { NextRequest } from 'next/server'

export const SESSION_COOKIE_NAME = 'bridge_session'
const CHALLENGE_TTL_MS = 5 * 60 * 1000
const SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000

type Address = `0x${string}`

type ChallengeRec = {
  address: Address
  nonce: string
  message: string
  expiresAt: number
}

type SessionRec = {
  sessionId: string
  userId: string
  address: Address
  expiresAt: number
}

const challenges = new Map<string, ChallengeRec>()
const sessions = new Map<string, SessionRec>()
const usersByAddress = new Map<string, string>()

function addrKey(address: Address) {
  return address.toLowerCase()
}

export function buildLoginMessage(address: Address, host: string, nonce: string) {
  const uri = `http://${host}`
  return [
    `${host} wants you to sign in with your Ethereum account:`,
    address,
    '',
    'Sign in to Bridge Demo',
    '',
    `URI: ${uri}`,
    'Version: 1',
    'Chain ID: 11155420',
    `Nonce: ${nonce}`,
    `Issued At: ${new Date().toISOString()}`,
  ].join('\n')
}

export function createChallenge(address: Address, host: string) {
  const nonce = randomBytes(16).toString('hex')
  const message = buildLoginMessage(address, host, nonce)

  const rec: ChallengeRec = {
    address,
    nonce,
    message,
    expiresAt: Date.now() + CHALLENGE_TTL_MS,
  }

  challenges.set(addrKey(address), rec)
  return rec
}

export function getChallenge(address: Address) {
  const rec = challenges.get(addrKey(address))
  if (!rec) return null

  if (rec.expiresAt < Date.now()) {
    challenges.delete(addrKey(address))
    return null
  }

  return rec
}

export function deleteChallenge(address: Address) {
  challenges.delete(addrKey(address))
}

export function getOrCreateUserId(address: Address) {
  const key = addrKey(address)
  const existed = usersByAddress.get(key)
  if (existed) return existed

  const userId = `user_${randomUUID()}`
  usersByAddress.set(key, userId)
  return userId
}

export function createSession(userId: string, address: Address) {
  const sessionId = randomUUID()

  const rec: SessionRec = {
    sessionId,
    userId,
    address,
    expiresAt: Date.now() + SESSION_TTL_MS,
  }

  sessions.set(sessionId, rec)
  return rec
}

export function getSessionFromRequest(req: NextRequest) {
  const sessionId = req.cookies.get(SESSION_COOKIE_NAME)?.value
  if (!sessionId) return null

  const rec = sessions.get(sessionId)
  if (!rec) return null

  if (rec.expiresAt < Date.now()) {
    sessions.delete(sessionId)
    return null
  }

  return rec
}

export function requireSession(req: NextRequest) {
  const rec = getSessionFromRequest(req)
  if (!rec) {
    throw new Error('未登录站点')
  }
  return rec
}

export function deleteSession(sessionId?: string) {
  if (!sessionId) return
  sessions.delete(sessionId)
}

export const SESSION_MAX_AGE_SECONDS = SESSION_TTL_MS / 1000