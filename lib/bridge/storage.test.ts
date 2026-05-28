import { beforeEach, describe, expect, it } from 'vitest'
import {
  lsLoadTransfers,
  lsPatchTransfer,
  lsUpsertTransfer,
  type TransferItem,
} from './storage'

describe('bridge localStorage recovery', () => {
  beforeEach(() => {
    localStorage.clear()
  })

  it('写入一条任务后，可以从本地缓存恢复出来', () => {
    const item: TransferItem = {
      transferId: '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
      status: 'queued',
      progress: 30,
      sourceTxHash: '0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
      targetTxHash: null,
      createdAt: 1000,
    }

    lsUpsertTransfer(item)

    const restored = lsLoadTransfers()

    expect(restored).toHaveLength(1)
    expect(restored[0].transferId).toBe(item.transferId)
    expect(restored[0].status).toBe('queued')
    expect(restored[0].progress).toBe(30)
  })

  it('任务状态更新后，恢复出的记录是最新状态', () => {
    const item: TransferItem = {
      transferId: '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
      status: 'queued',
      progress: 30,
      sourceTxHash: '0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
      targetTxHash: null,
      createdAt: 1000,
    }

    lsUpsertTransfer(item)

    lsPatchTransfer(item.transferId, {
      status: 'complete',
      progress: 100,
      targetTxHash: '0xcccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc',
    })

    const restored = lsLoadTransfers()

    expect(restored[0].status).toBe('complete')
    expect(restored[0].progress).toBe(100)
    expect(restored[0].targetTxHash).toBe(
      '0xcccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc',
    )
  })

  it('缓存中的 JSON 已损坏时，安全返回空数组', () => {
    localStorage.setItem('bridge:recentTransferIds', 'not-json')
    localStorage.setItem('bridge:transfers:v1', '{broken-json')

    const restored = lsLoadTransfers()

    expect(restored).toEqual([])
  })
})