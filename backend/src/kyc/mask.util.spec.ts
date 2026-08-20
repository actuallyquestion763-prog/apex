import { maskIdNumber } from './mask.util'

describe('maskIdNumber', () => {
  it('masks all but the last 4 characters', () => {
    expect(maskIdNumber('AB1234567890')).toBe('••••••••7890')
  })

  it('handles short values without a negative repeat count', () => {
    expect(maskIdNumber('123')).toBe('123')
    expect(maskIdNumber('1234')).toBe('1234')
    expect(maskIdNumber('12345')).toBe('•2345')
  })

  it('passes through null unchanged', () => {
    expect(maskIdNumber(null)).toBeNull()
  })
})
