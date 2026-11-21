import { describe, expect, it } from 'vitest'
import { isSafeHttpUrl, youtubeEmbedUrl } from './media'

describe('youtubeEmbedUrl', () => {
  it('支援常見格式', () => {
    expect(youtubeEmbedUrl('https://www.youtube.com/watch?v=abcdEFG123')).toBe('https://www.youtube-nocookie.com/embed/abcdEFG123')
    expect(youtubeEmbedUrl('https://youtu.be/abcdEFG123')).toBe('https://www.youtube-nocookie.com/embed/abcdEFG123')
  })
  it('非 YouTube 回傳 null', () => {
    expect(youtubeEmbedUrl('https://example.com/video.mp4')).toBeNull()
    expect(youtubeEmbedUrl('not a url')).toBeNull()
  })
})

describe('isSafeHttpUrl', () => {
  it('拒絕 javascript: 網址', () => {
    expect(isSafeHttpUrl('javascript:alert(1)')).toBe(false)
    expect(isSafeHttpUrl('https://x.tw/a.png')).toBe(true)
  })
})
