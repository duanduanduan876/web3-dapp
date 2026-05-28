import { describe, expect, it } from 'vitest'
import { isUserRejected } from './errors'

describe('isUserRejected', () => {
  it('钱包返回 4001 时，识别为用户拒绝', () => {
    const err = { code: 4001 }

    const result = isUserRejected(err)

    expect(result).toBe(true)
  })

  it('普通系统错误时，不识别为用户拒绝', () => {
    const err = new Error('rpc timeout')

    const result = isUserRejected(err)

    expect(result).toBe(false)
  })
})