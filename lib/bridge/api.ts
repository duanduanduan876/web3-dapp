export class ApiError extends Error {
  code?: string
  status?: number

  constructor(message: string, opts?: { code?: string; status?: number }) {
    super(message)
    this.name = 'ApiError'
    this.code = opts?.code
    this.status = opts?.status
  }
}

export async function fetchJsonOrThrow(res: Response) {
  const raw = await res.text()
  let data: any

  try {
    data = JSON.parse(raw)
  } catch {
    throw new ApiError(`API 没返回 JSON（HTTP ${res.status}）：${raw.slice(0, 200)}`, {
      status: res.status,
    })
  }

  if (!res.ok || !data?.success) {
    throw new ApiError(data?.error || `API failed (HTTP ${res.status})`, {
      status: res.status,
      code: data?.code,
    })
  }

  return data
}