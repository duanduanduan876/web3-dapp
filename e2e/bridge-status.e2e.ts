import { expect, test } from '@playwright/test'

const TRANSFER_ID =
  '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'

const SOURCE_TX_HASH =
  '0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb'

const TARGET_TX_HASH =
  '0xcccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc'

test('状态查询第一次失败时保留旧卡片，下一次成功后更新到完成', async ({ page }) => {
  let statusQueryCount = 0

  // 在页面 JS 执行前，预置一条已经存在的处理中任务。
  await page.addInitScript(
    ({ transferId, sourceTxHash }) => {
      const item = {
        transferId,
        status: 'inflight',
        progress: 70,
        sourceTxHash,
        targetTxHash: null,
        createdAt: 1000,
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

  // 本测试不测登录流程，固定返回未登录站点。
  await page.route('**/api/auth/me', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        success: false,
      }),
    })
  })

  // 拦截页面真实发出的批量状态查询。
  await page.route('**/api/bridge/transfer?**', async (route) => {
    statusQueryCount += 1

    if (statusQueryCount === 1) {
      // 第一轮查询人为制造服务端异常。
      await route.fulfill({
        status: 500,
        contentType: 'application/json',
        body: JSON.stringify({
          success: false,
          error: 'temporary status query failure',
        }),
      })
      return
    }

    // 下一轮查询模拟服务恢复，并返回任务已完成。
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        success: true,
        records: [
          {
            transferId: TRANSFER_ID,
            status: 'complete',
            progress: 100,
            sourceTxHash: SOURCE_TX_HASH,
            targetTxHash: TARGET_TX_HASH,
            createdAt: 1000,
          },
        ],
      }),
    })
  })

  await page.goto('/bridge')

  // localStorage 恢复后，页面先显示最后可信的处理中状态。
  await expect(page.getByText(/inflight \(70%\)/i)).toBeVisible()

  // 第一次状态查询失败，页面提示刷新失败，但任务没有被改成 failed。
  await expect(page.getByText('状态刷新暂时失败，将自动重试')).toBeVisible()
  await expect(page.getByText(/inflight \(70%\)/i)).toBeVisible()

  // 故意停留两秒，让 headed 模式下能看到提示。
  await page.waitForTimeout(2000)

  // 下一轮自动轮询查询成功，页面更新到完成。
  await expect(page.getByText(/complete \(100%\)/i)).toBeVisible({
    timeout: 7000,
  })
  await expect(page.getByText(/Target:/)).toContainText(TARGET_TX_HASH)

  // 查询成功后，临时错误提示应该被清除。
  await expect(page.getByText('状态刷新暂时失败，将自动重试')).not.toBeVisible()

  // 停留两秒，便于观察恢复后的完成状态。
  await page.waitForTimeout(2000)
})