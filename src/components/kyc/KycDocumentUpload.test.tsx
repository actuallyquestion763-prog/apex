import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { KycDocumentUpload } from './KycDocumentUpload'

function makeFile(name: string, type: string) {
  return new File(['fake-bytes'], name, { type })
}

describe('KycDocumentUpload', () => {
  it('renders the given label', () => {
    render(<KycDocumentUpload label="Front of ID" file={null} onSelect={() => {}} />)
    expect(screen.getByText('Front of ID')).toBeInTheDocument()
  })

  it('reports a dropped file back via onSelect', () => {
    const onSelect = vi.fn()
    render(<KycDocumentUpload label="Selfie / verification photo" file={null} onSelect={onSelect} />)
    const dropzone = screen.getByLabelText('Upload Selfie / verification photo')
    const file = makeFile('selfie.png', 'image/png')
    fireEvent.drop(dropzone, { dataTransfer: { files: [file] } })
    expect(onSelect).toHaveBeenCalledWith(file)
  })

  it('shows the selected file name once chosen', () => {
    const file = makeFile('id-front.png', 'image/png')
    render(<KycDocumentUpload label="Front of ID" file={file} onSelect={() => {}} />)
    expect(screen.getByText('id-front.png')).toBeInTheDocument()
  })
})
