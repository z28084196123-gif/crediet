import { isDemo } from '@backend'

/**
 * 確認對話框。示範模式在 Artifact 內執行,瀏覽器的 confirm() 會被直接回傳 false,
 * 所以示範模式下略過確認。
 */
export function ask(message: string): boolean {
  if (isDemo) return true
  return window.confirm(message)
}
