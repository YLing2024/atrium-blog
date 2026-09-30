// test/snowflake.test.ts —— 雪花 ID 纯函数测试（node:test，零依赖）
//
// 只覆盖 src/snowflake.ts 注释里承诺的性质：
//   · 返回字符串、19 位（超出 Number.MAX_SAFE_INTEGER，绝不能用 Number 承载）
//   · 同一毫秒内唯一、严格递增
//   · 随时间单调递增
//   · 时钟回拨不产生重复
// 不测 DB / 网络 / Express：雪花模块无这类依赖，直接 require 即可。
//
// 雪花模块带模块级可变状态（lastMs / seq），且 node:test 不保证顶层用例的执行顺序，
// 因此每个用例前用 fresh() 清掉 require 缓存重取一份全新实例，做到用例互不影响。

const { test } = require('node:test') as typeof import('node:test')
const assert = require('node:assert/strict') as typeof import('node:assert/strict')

type Snowflake = {
  nextId: () => string
  nextIdAt: (msInput: number) => string
  EPOCH: bigint
}

const SNOWFLAKE_PATH = require.resolve('../src/snowflake.ts')

// 取一份全新的 snowflake 实例（清 require 缓存，状态归零）
function fresh(): Snowflake {
  delete require.cache[SNOWFLAKE_PATH]
  return require(SNOWFLAKE_PATH) as Snowflake
}

// 19 位纯数字
const ID_RE = /^\d{19}$/
// 基准时间固定一次，后续用相对偏移构造"未来"毫秒
const NOW = Date.now()

test('EPOCH 取 Twitter snowflake 标准纪元', () => {
  assert.equal(fresh().EPOCH, 1288834974657n)
})

test('nextId 返回 19 位数字字符串', () => {
  const id = fresh().nextId()
  assert.equal(typeof id, 'string')
  assert.match(id, ID_RE)
})

test('nextIdAt 对正常毫秒返回 19 位数字字符串', () => {
  const id = fresh().nextIdAt(NOW)
  assert.equal(typeof id, 'string')
  assert.match(id, ID_RE)
})

test('ID 高 41 位可按 id 反解出毫秒时间戳', () => {
  const { nextIdAt, EPOCH } = fresh()
  const ms = NOW + 300_000_000
  const id = BigInt(nextIdAt(ms))
  // id = ((ms - EPOCH) << 22) | (worker << 12) | seq；右移 22 位即还原时间戳
  assert.equal(id >> 22n, BigInt(ms) - EPOCH)
})

test('同一毫秒内连续生成：全部唯一且严格 +1', () => {
  const { nextIdAt } = fresh()
  const ms = NOW + 60_000_000
  const ids: bigint[] = []
  for (let i = 0; i < 100; i++) ids.push(BigInt(nextIdAt(ms)))
  assert.equal(new Set(ids.map(String)).size, 100)
  for (let i = 1; i < ids.length; i++) {
    assert.equal(ids[i], ids[i - 1] + 1n)
  }
})

test('随时间单调递增：每跨 1ms 前进 2^22', () => {
  const { nextIdAt } = fresh()
  const base = NOW + 120_000_000
  const a = BigInt(nextIdAt(base))
  const b = BigInt(nextIdAt(base + 1))
  const c = BigInt(nextIdAt(base + 1000))
  assert.ok(a < b, `期望 ${a} < ${b}`)
  assert.ok(b < c, `期望 ${b} < ${c}`)
  assert.equal(b - a, 1n << 22n)
})

test('时钟回拨不产生重复：沿用上次时间戳并递增序列', () => {
  const { nextIdAt } = fresh()
  const base = NOW + 400_000_000
  const forward = BigInt(nextIdAt(base))
  const back = BigInt(nextIdAt(base - 5_000_000)) // 回拨 5 秒
  assert.notEqual(back, forward)
  assert.equal(back, forward + 1n)
  const back2 = BigInt(nextIdAt(base - 9_000_000)) // 再回拨更早
  assert.equal(back2, back + 1n)
})

test('同毫秒序列用尽（4096 个）后借下一毫秒，不重复', () => {
  const { nextIdAt } = fresh()
  const base = NOW + 600_000_000
  const first = BigInt(nextIdAt(base))
  let last = first
  for (let i = 1; i < 4096; i++) {
    const id = BigInt(nextIdAt(base))
    assert.ok(id > last)
    last = id
  }
  const overflow = BigInt(nextIdAt(base)) // 第 4097 次
  assert.ok(overflow > last)
  // compose(base+1, 0) - compose(base, 4095) = 2^22 - 4095
  assert.equal(overflow - last, (1n << 22n) - 4095n)
})

test('nextIdAt 非法输入回退到当前时间，仍返回合法 ID', () => {
  const id = fresh().nextIdAt(Number.NaN)
  assert.equal(typeof id, 'string')
  assert.match(id, ID_RE)
})

test('nextId 连续调用严格递增', () => {
  const { nextId } = fresh()
  const a = BigInt(nextId())
  const b = BigInt(nextId())
  assert.ok(b > a, `期望 ${b} > ${a}`)
})
