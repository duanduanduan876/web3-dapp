// lib/feature-flags.ts
import { getRedis } from '@/lib/redis'

const BRIDGE_SUBMIT_ENABLED_KEY = 'config:bridgeSubmitEnabled'

export async function getBridgeSubmitEnabled(): Promise<boolean> {
  const redis = await getRedis()

  const raw = (await redis.get(BRIDGE_SUBMIT_ENABLED_KEY)) as string | null

  // 默认开启。只有 Redis 里明确写 false，才关闭。
  return raw !== 'false'
}

export async function setBridgeSubmitEnabled(enabled: boolean): Promise<void> {
  const redis = await getRedis()

  await redis.set(BRIDGE_SUBMIT_ENABLED_KEY, enabled ? 'true' : 'false')
}