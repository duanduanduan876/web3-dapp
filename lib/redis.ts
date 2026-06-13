// lib/redis.ts
import { createClient, type RedisClientType } from 'redis'

let client: RedisClientType | null = null
let connecting: Promise<RedisClientType> | null = null

export async function getRedis() {
  if (client?.isOpen) return client
  if (connecting) return connecting

  const redis = createClient({
    url: process.env.REDIS_URL ?? 'redis://127.0.0.1:6379',
  })

  redis.on('error', (err) => {
    console.error('[redis] error:', err)
  })

  connecting = redis.connect().then(() => {
    client = redis
    return redis
  })

  return connecting
}