// snowflake.ts —— 64 位有序 ID：41 位毫秒时间戳 + 10 位机器号 + 12 位序列
//
// 用途：文章 URL 的标识（/blog/<id>）。与自增 id 的区别：
//   · 时间有序（按 id 排序≈按创建时间排序）
//   · 单机内不连续、不可枚举（外部无法从 1 数到 N 遍历全站）
// 返回**字符串**：19 位数字超出 JS Number.MAX_SAFE_INTEGER，用数字会丢精度。

// 仅用于把本文件标记为 TS 模块（Node 运行时会擦除类型导入）；运行时仍是 require / module.exports
import type {} from 'node:process'

const EPOCH: bigint = 1288834974657n // 纪元取 Twitter snowflake 标准值（2010-11-04），41 位毫秒可用到 2079 年；得到的是 19 位 ID
const WORKER_BITS: bigint = 10n
const SEQ_BITS: bigint = 12n
const MAX_SEQ: bigint = (1n << SEQ_BITS) - 1n // 4095，同毫秒内最多 4096 个
const WORKER_ID: bigint = BigInt(
  Math.min(1023, Math.max(0, Number(process.env.SNOWFLAKE_WORKER_ID || 0)))
)

let lastMs: bigint = -1n
let seq: bigint = 0n

function compose(ms: bigint, s: bigint): string {
  return (((ms - EPOCH) << (WORKER_BITS + SEQ_BITS)) | (WORKER_ID << SEQ_BITS) | s).toString()
}

function advance(ms: bigint): string {
  if (ms < lastMs) ms = lastMs // 时钟回拨：沿用上次时间戳，宁可慢一拍也不产生重复
  if (ms === lastMs) {
    seq = (seq + 1n) & MAX_SEQ
    if (seq === 0n) ms = lastMs + 1n // 同毫秒序列用尽 → 借下一毫秒
  } else {
    seq = 0n
  }
  lastMs = ms
  return compose(ms, seq)
}

/** 取下一个 ID（全局单调递增） */
function nextId(): string {
  return advance(BigInt(Date.now()))
}

/** 按指定毫秒生成（迁移回填用：让老文章的 ID 反映它自己的创建时间） */
function nextIdAt(msInput: number): string {
  const n = Number(msInput)
  const ms = Number.isFinite(n) ? Math.max(Number(EPOCH), Math.trunc(n)) : Date.now()
  return advance(BigInt(ms))
}

module.exports = { nextId, nextIdAt, EPOCH }
