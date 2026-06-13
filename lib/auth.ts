// lib/auth.ts
import { randomBytes, randomUUID } from 'crypto'
import type { NextRequest } from 'next/server'
import { getRedis } from '@/lib/redis'

export const SESSION_COOKIE_NAME = 'bridge_session'
const CHALLENGE_TTL_SECONDS = 5 * 60
const SESSION_TTL_SECONDS = 7 * 24 * 60 * 60

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

function addrKey(address: Address) {
  return address.toLowerCase()
}

function challengeKey(address: Address) {
  return `auth:challenge:${addrKey(address)}`
}

function userByAddressKey(address: Address) {
  return `auth:user-by-address:${addrKey(address)}`
}

function sessionKey(sessionId: string) {
  return `auth:session:${sessionId}`
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

export async function createChallenge(
  address: Address,
  host: string,
): Promise<ChallengeRec> {
  const redis = await getRedis()

  const nonce = randomBytes(16).toString('hex')
  const message = buildLoginMessage(address, host, nonce)

  const rec: ChallengeRec = {
    address,
    nonce,
    message,
    expiresAt: Date.now() + CHALLENGE_TTL_SECONDS * 1000,
  }

  await redis.set(challengeKey(address), JSON.stringify(rec), {
  EX: CHALLENGE_TTL_SECONDS,
})

  return rec
}

export async function getChallenge(address: Address): Promise<ChallengeRec | null> {
  const redis = await getRedis()
  const raw = (await redis.get(challengeKey(address))) as string | null

  if (!raw) return null

  const rec = JSON.parse(raw) as ChallengeRec

  if (rec.expiresAt < Date.now()) {
    await redis.del(challengeKey(address))
    return null
  }

  return rec
}

export async function deleteChallenge(address: Address): Promise<void> {
  const redis = await getRedis()
  await redis.del(challengeKey(address))
}

export async function getOrCreateUserId(address: Address): Promise<string> {
  const redis = await getRedis()
  const key = userByAddressKey(address)

  const existed = (await redis.get(key)) as string | null
  if (existed) return existed

  const userId = `user_${randomUUID()}`
  await redis.set(key, userId)

  return userId
}

export async function createSession(
  userId: string,
  address: Address,
): Promise<SessionRec> {
  const redis = await getRedis()
  const sessionId = randomUUID()

  const rec: SessionRec = {
    sessionId,
    userId,
    address,
    expiresAt: Date.now() + SESSION_TTL_SECONDS * 1000,
  }

  await redis.set(sessionKey(sessionId), JSON.stringify(rec), {
  EX: SESSION_TTL_SECONDS,
})

  return rec
}

export async function getSessionFromRequest(
  req: NextRequest,
): Promise<SessionRec | null> {
  const sessionId = req.cookies.get(SESSION_COOKIE_NAME)?.value
  if (!sessionId) return null

  const redis = await getRedis()
  const raw = (await redis.get(sessionKey(sessionId))) as string | null

  if (!raw) return null

  const rec = JSON.parse(raw) as SessionRec

  if (rec.expiresAt < Date.now()) {
    await redis.del(sessionKey(sessionId))
    return null
  }

  return rec
}

export async function requireSession(req: NextRequest): Promise<SessionRec> {
  const rec = await getSessionFromRequest(req)

  if (!rec) {
    throw new Error('未登录站点')
  }

  return rec
}

export async function deleteSession(sessionId?: string): Promise<void> {
  if (!sessionId) return

  const redis = await getRedis()
  await redis.del(sessionKey(sessionId))
}

export const SESSION_MAX_AGE_SECONDS = SESSION_TTL_SECONDS