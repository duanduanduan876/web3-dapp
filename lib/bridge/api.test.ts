import { describe, expect, it } from 'vitest'
import { ApiError, fetchJsonOrThrow } from './api'

describe('fetchJsonOrThrow', () => {
  it('HTTP 成功且业务成功时，返回解析后的数据', async () => {
    const res = new Response(
      JSON.stringify({
        success: true,
        transferId: '0xabc',
        status: 'queued',
      }),
      {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      },
    )

    const data = await fetchJsonOrThrow(res)

    expect(data.success).toBe(true)
    expect(data.transferId).toBe('0xabc')
    expect(data.status).toBe('queued')
  })

  it('HTTP 失败时，抛出带状态码的 ApiError', async () => {
    const res = new Response(
      JSON.stringify({
        success: false,
        error: '未登录站点',
      }),
      {
        status: 401,
        headers: { 'Content-Type': 'application/json' },
      },
    )

    try {
      await fetchJsonOrThrow(res)
      throw new Error('这里不应该执行')
    } catch (err) {
      expect(err).toBeInstanceOf(ApiError)
      expect((err as ApiError).message).toBe('未登录站点')
      expect((err as ApiError).status).toBe(401)
    }
  })

  it('HTTP 成功但业务失败时，抛出业务 ApiError', async () => {
    const res = new Response(
      JSON.stringify({
        success: false,
        error: '余额不足',
        code: 'INSUFFICIENT_BALANCE',
      }),
      {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      },
    )

    try {
      await fetchJsonOrThrow(res)
      throw new Error('这里不应该执行')
    } catch (err) {
      expect(err).toBeInstanceOf(ApiError)
      expect((err as ApiError).message).toBe('余额不足')
      expect((err as ApiError).status).toBe(200)
      expect((err as ApiError).code).toBe('INSUFFICIENT_BALANCE')
    }
  })

  it('响应体不是 JSON 时，抛出解析类 ApiError', async () => {
    const res = new Response('<html>Gateway Error</html>', {
      status: 502,
      headers: { 'Content-Type': 'text/html' },
    })

    try {
      await fetchJsonOrThrow(res)
      throw new Error('这里不应该执行')
    } catch (err) {
      expect(err).toBeInstanceOf(ApiError)
      expect((err as ApiError).message).toContain('API 没返回 JSON')
      expect((err as ApiError).message).toContain('Gateway Error')
      expect((err as ApiError).status).toBe(502)
    }
  })
  
})