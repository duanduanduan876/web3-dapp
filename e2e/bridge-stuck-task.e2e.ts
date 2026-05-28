import { expect, test } from '@playwright/test'

const TRANSFER_ID =
  '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'

const SOURCE_TX_HASH =
  '0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb'

test('任务持续处理中超过阈值时，只显示卡单提示，不误判为失败', async ({ page }) => {
  // 页面 JS 执行前，预置一条刚创建的处理中任务。
  await page.addInitScript(
    ({ transferId, sourceTxHash }) => {
      const item = {
        transferId,
        status: 'inflight',
        progress: 70,
        sourceTxHash,
        targetTxHash: null,
        createdAt: Date.now(),
      }

      localStorage.setItem(
        'bridge:recentTransferIds',
        JSON.stringify([transferId]),
      )

      localStorage.setItem(
        'bridge:transfers:v1',
        JSON.stringify({
          [transferId]: item,
        }),
      )
    },
    {
      transferId: TRANSFER_ID,
      sourceTxHash: SOURCE_TX_HASH,
    },
  )

  // 本测试不关注站点登录流程，固定返回未登录站点。
  await page.route('**/api/auth/me', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        success: false,
      }),
    })
  })

  // 状态查询始终返回处理中，模拟任务长时间未进入终态。
  await page.route('**/api/bridge/transfer?**', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        success: true,
        records: [
          {
            transferId: TRANSFER_ID,
            status: 'inflight',
            progress: 70,
            sourceTxHash: SOURCE_TX_HASH,
            targetTxHash: null,
            createdAt: Date.now(),
          },
        ],
      }),
    })
  })

  await page.goto('/bridge')

  // 页面先从 localStorage 恢复出正常的处理中卡片。
  await expect(page.getByText(/inflight \(70%\)/i)).toBeVisible()

  // 未达到阈值前，不应立即显示卡单提示。
  await expect(page.getByText('处理时间较长，请稍后核对状态')).not.toBeVisible()

  // .env.local 中配置的演示阈值为 10 秒；超过阈值后，当前卡片应显示提示。
  await expect(page.getByText('处理时间较长，请稍后核对状态')).toBeVisible({
    timeout: 15_000,
  })

  // 卡单提示只是可见化提醒，任务本身仍保留最后可信的处理中状态。
  await expect(page.getByText(/inflight \(70%\)/i)).toBeVisible()
  await expect(page.getByText(/failed/i)).not.toBeVisible()

  // headed 模式下停留两秒，方便观察结果。
  await page.waitForTimeout(2000)
})
