const zh = (navigator.language || 'zh').toLowerCase().startsWith('zh')

export const t = (chinese: string, english: string) => (zh ? chinese : english)
export const pick = (chinese: string | undefined, english: string | undefined) => (zh ? chinese : english) ?? ''
export const locale = zh ? 'zh-CN' : 'en-US'
