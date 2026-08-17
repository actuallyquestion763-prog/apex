import { Controller, Get, Param, Req, StreamableFile, UseGuards } from '@nestjs/common'
import type { Request } from 'express'
import { createReadStream } from 'fs'
import { CmsService } from './cms.service'
import { OptionalSessionAuthGuard } from '../common/guards/optional-session-auth.guard'
import type { AuthenticatedUser } from '../common/types/authenticated-user'

// Public, read-only, PUBLISHED-content-only. No permission required — this
// is customer/marketing-facing content, the same trust boundary as any
// public website page. Draft/archived content is never reachable here (see
// CmsService's queries, which always filter status: 'PUBLISHED').
@Controller('cms')
export class CmsController {
  constructor(private readonly cms: CmsService) {}

  @Get('pages/:slug')
  getPage(@Param('slug') slug: string) {
    return this.cms.getPublishedPage(slug)
  }

  @Get('announcements')
  @UseGuards(OptionalSessionAuthGuard)
  listAnnouncements(@Req() req: Request) {
    const user = (req as unknown as { user?: AuthenticatedUser }).user
    return this.cms.listPublishedAnnouncements(Boolean(user))
  }

  @Get('faqs')
  listFaqs() {
    return this.cms.listPublishedFaqs()
  }

  @Get('navigation')
  listNavigation() {
    return this.cms.listActiveNavigation()
  }

  // Streams the file through the storage abstraction — never exposes
  // backend/uploads/ as a static-file mount, so a request can only ever
  // resolve to a path this service itself looked up from the CmsMedia table
  // (see CmsService.getMediaFile). See that method's comment for why "any
  // valid media id is servable" is the intended trust boundary here, not a
  // shortcut.
  @Get('media/:id')
  async getMedia(@Param('id') id: string) {
    const file = await this.cms.getMediaFile(id)
    const stream = createReadStream(file.path)
    return new StreamableFile(stream, { type: file.mimeType, disposition: `inline; filename="${encodeURIComponent(file.filename)}"` })
  }
}
