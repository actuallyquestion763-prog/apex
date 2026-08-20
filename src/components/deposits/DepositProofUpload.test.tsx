import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { DepositProofUpload } from './DepositProofUpload'

function makeFile(name: string, type: string) {
  return new File(['fake-bytes'], name, { type })
}

describe('DepositProofUpload', () => {
  it('is explicitly marked optional (Part 20 — proof must not be mandatory)', () => {
    render(<DepositProofUpload file={null} onSelect={() => {}} />)
    expect(screen.getByText('Upload Proof (optional)')).toBeInTheDocument()
  })

  it('reports a dropped file back via onSelect', () => {
    const onSelect = vi.fn()
    render(<DepositProofUpload file={null} onSelect={onSelect} />)
    const dropzone = screen.getByLabelText('Upload deposit proof')
    const file = makeFile('receipt.png', 'image/png')
    fireEvent.drop(dropzone, { dataTransfer: { files: [file] } })
    expect(onSelect).toHaveBeenCalledWith(file)
  })

  it('shows the selected file name once a file is chosen', () => {
    const file = makeFile('receipt.png', 'image/png')
    render(<DepositProofUpload file={file} onSelect={() => {}} />)
    expect(screen.getByText('receipt.png')).toBeInTheDocument()
  })
})
