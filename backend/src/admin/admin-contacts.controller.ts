import { Controller, Get, Param, StreamableFile } from '@nestjs/common'
import { AdminContactsService } from './admin-contacts.service'

const EXT_TO_MIME: Record<string, string> = {
  png: 'image/png', jpg: 'image/jpeg', webp: 'image/webp', gif: 'image/gif', pdf: 'application/pdf',
}

// Public, read-only, enabled-only — same trust boundary as the CMS public
// controller (customer/marketing-facing content, no auth required).
@Controller('contacts')
export class ContactsController {
  constructor(private readonly contacts: AdminContactsService) {}

  @Get()
  list() {
    return this.contacts.listEnabled()
  }

  @Get(':id/icon')
  async getIcon(@Param('id') id: string) {
    const { stream, storageKey } = await this.contacts.getIconStream(id)
    const ext = storageKey.split('.').pop() ?? ''
    return new StreamableFile(stream, { type: EXT_TO_MIME[ext] ?? 'application/octet-stream' })
  }
}
