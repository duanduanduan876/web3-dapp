export type Status = 'queued' | 'inflight' | 'complete' | 'failed'

export type TransferItem = {
  transferId: `0x${string}`
  status: Status
  progress: number
  sourceTxHash: `0x${string}`
  targetTxHash?: `0x${string}` | null
  createdAt: number
  error?: string
}

type StoredTransfer = Pick<
  TransferItem,
  'transferId' | 'status' | 'progress' | 'sourceTxHash' | 'targetTxHash' | 'createdAt' | 'error'
>

const LS_IDS_KEY = 'bridge:recentTransferIds'
const LS_MAP_KEY = 'bridge:transfers:v1'
const LS_MAX = 20

function safeParseJson<T>(raw: string | null): T | null {
  if (!raw) return null
  try {
    return JSON.parse(raw) as T
  } catch {
    return null
  }
}

function lsReadIds(): string[] {
  const arr = safeParseJson<unknown>(
    typeof window !== 'undefined' ? localStorage.getItem(LS_IDS_KEY) : null,
  )
  if (!Array.isArray(arr)) return []
  return arr.filter((x) => typeof x === 'string')
}

function lsWriteIds(ids: string[]) {
  try {
    localStorage.setItem(LS_IDS_KEY, JSON.stringify(ids))
  } catch {}
}

function lsReadMap(): Record<string, StoredTransfer> {
  const obj = safeParseJson<unknown>(
    typeof window !== 'undefined' ? localStorage.getItem(LS_MAP_KEY) : null,
  )
  if (!obj || typeof obj !== 'object') return {}
  return obj as Record<string, StoredTransfer>
}

function lsWriteMap(map: Record<string, StoredTransfer>) {
  try {
    localStorage.setItem(LS_MAP_KEY, JSON.stringify(map))
  } catch {}
}

export function lsUpsertTransfer(item: TransferItem) {
  const ids = lsReadIds()
  const map = lsReadMap()

  const stored: StoredTransfer = {
    transferId: item.transferId,
    status: item.status,
    progress: item.progress,
    sourceTxHash: item.sourceTxHash,
    targetTxHash: item.targetTxHash ?? null,
    createdAt: item.createdAt,
    error: item.error,
  }

  map[item.transferId] = stored

  const nextIds = [item.transferId, ...ids.filter((x) => x !== item.transferId)].slice(0, LS_MAX)

  for (const id of ids) {
    if (!nextIds.includes(id)) delete map[id]
  }

  lsWriteMap(map)
  lsWriteIds(nextIds)
}

export function lsPatchTransfer(id: string, patchObj: Partial<TransferItem>) {
  const map = lsReadMap()
  const cur = map[id]
  if (!cur) return

  map[id] = {
    ...cur,
    status: patchObj.status ?? cur.status,
    progress: patchObj.progress ?? cur.progress,
    sourceTxHash: patchObj.sourceTxHash ?? cur.sourceTxHash,
    targetTxHash: patchObj.targetTxHash ?? cur.targetTxHash,
    error: patchObj.error ?? cur.error,
  }

  lsWriteMap(map)
}

export function lsLoadTransfers(): TransferItem[] {
  const ids = lsReadIds()
  const map = lsReadMap()
  const out: TransferItem[] = []

  for (const id of ids) {
    const it = map[id]
    if (!it) continue

    out.push({
      transferId: it.transferId,
      status: it.status,
      progress: it.progress,
      sourceTxHash: it.sourceTxHash,
      targetTxHash: it.targetTxHash ?? undefined,
      createdAt: it.createdAt,
      error: it.error,
    })
  }

  return out
}