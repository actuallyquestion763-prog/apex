import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common'
import { Decimal } from '@prisma/client/runtime/library'
import { PrismaService } from '../prisma/prisma.service'
import { AuditService } from '../audit/audit.service'
import { AuditEvent } from '../audit/audit-events'
import { MediaStorageService } from '../cms/media-storage.service'
import { validateReceivingAddress } from './address-validation.util'
import type { CreateCryptoAssetDto, UpdateCryptoAssetDto, UpsertCryptoDepositAddressDto } from './dto/admin-crypto-dtos'

interface UploadedFileLike {
  originalname: string
  mimetype: string
  buffer: Buffer
}

// Crypto deposit configuration — a SEPARATE, minimal domain from the
// existing DepositsService (Part 1/17: reuse the existing Deposit model and
// financial pipeline; only the "which asset/network/address is currently
// offered" question lives here). Nothing in this service ever posts a
// ledger entry or touches DepositsService — DepositsService.createDeposit()
// is the only caller, and only to RESOLVE+SNAPSHOT a configuration, never
// to mutate one.
@Injectable()
export class CryptoDepositsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly media: MediaStorageService,
  ) {}

  // ---- Public read path (deposit page) ---------------------------------------

  async listEnabledAssets() {
    const assets = await this.prisma.cryptoAsset.findMany({
      where: { enabled: true, networks: { some: { enabled: true } } },
      include: { networks: { where: { enabled: true }, orderBy: { sortOrder: 'asc' } } },
      orderBy: { sortOrder: 'asc' },
    })
    return assets.map((a) => ({
      symbol: a.symbol,
      name: a.name,
      networks: a.networks.map((n) => ({
        networkCode: n.networkCode,
        networkName: n.networkName,
        minimumDeposit: n.minimumDeposit,
        // The receiving address itself is intentionally NOT included in
        // this general "what's supported" list — a real address is only
        // ever handed to a signed-in user for a SPECIFIC (asset, network)
        // pair they've actually selected, via the controller's dedicated
        // resolveAddress endpoint (which calls resolveForDeposit below).
      })),
    }))
  }

  // The single place that turns (symbol, networkCode) into a validated,
  // currently-active configuration — DepositsService.createDeposit() calls
  // this and snapshots the result; nothing else in the codebase reads
  // CryptoDepositAddress directly.
  async resolveForDeposit(symbol: string, networkCode: string) {
    const asset = await this.prisma.cryptoAsset.findUnique({ where: { symbol } })
    if (!asset || !asset.enabled) {
      return { ok: false as const, reason: 'ASSET_DISABLED', message: `${symbol} is not currently available for deposit.` }
    }
    const network = await this.prisma.cryptoDepositAddress.findUnique({
      where: { cryptoAssetId_networkCode: { cryptoAssetId: asset.id, networkCode } },
    })
    if (!network || !network.enabled) {
      return { ok: false as const, reason: 'NETWORK_DISABLED', message: `${networkCode} is not currently available for ${symbol} deposits.` }
    }
    return { ok: true as const, asset, network }
  }

  // ---- Admin CRUD -----------------------------------------------------------

  async adminListAssets() {
    const assets = await this.prisma.cryptoAsset.findMany({
      include: { networks: { orderBy: { sortOrder: 'asc' } } },
      orderBy: { sortOrder: 'asc' },
    })
    // Never leak the raw opaque storage key to the frontend — it derives
    // the QR image URL from (symbol, networkCode) via getQrStream() below,
    // not from this key.
    return assets.map((a) => ({
      ...a,
      networks: a.networks.map(({ qrStorageKey, ...n }) => ({ ...n, hasQr: Boolean(qrStorageKey) })),
    }))
  }

  async createAsset(adminId: string, dto: CreateCryptoAssetDto) {
    const symbol = dto.symbol.trim().toUpperCase()
    const existing = await this.prisma.cryptoAsset.findUnique({ where: { symbol } })
    if (existing) throw new BadRequestException(`A crypto asset "${symbol}" already exists.`)

    const created = await this.prisma.cryptoAsset.create({
      data: { symbol, name: dto.name.trim(), sortOrder: dto.sortOrder ?? 0 },
    })
    await this.audit.record({
      actorId: adminId,
      action: AuditEvent.CRYPTO_ASSET_CHANGED,
      targetType: 'CRYPTO_ASSET',
      targetId: created.id,
      newState: { symbol: created.symbol, name: created.name, created: true },
    })
    return created
  }

  async updateAsset(adminId: string, symbol: string, patch: UpdateCryptoAssetDto) {
    const before = await this.prisma.cryptoAsset.findUnique({ where: { symbol } })
    if (!before) throw new NotFoundException(`No crypto asset "${symbol}".`)

    const updated = await this.prisma.cryptoAsset.update({
      where: { symbol },
      data: {
        ...(patch.enabled !== undefined ? { enabled: patch.enabled } : {}),
        ...(patch.name !== undefined ? { name: patch.name.trim() } : {}),
        ...(patch.sortOrder !== undefined ? { sortOrder: patch.sortOrder } : {}),
      },
    })
    await this.audit.record({
      actorId: adminId,
      action: AuditEvent.CRYPTO_ASSET_CHANGED,
      targetType: 'CRYPTO_ASSET',
      targetId: updated.id,
      previousState: { enabled: before.enabled, name: before.name },
      newState: { enabled: updated.enabled, name: updated.name },
    })
    return updated
  }

  // Step-up gated at the controller (admin identity + password + TOTP
  // already verified before this runs — see crypto-deposits-admin.controller.ts)
  // — receiving-address changes are the single most fund-safety-sensitive
  // operation in this entire module (Part 25). `file`, when present, is a
  // new QR image to associate with this (asset, network) — reuses the same
  // MediaStorageService abstraction as every other upload in this codebase
  // (allowlisted MIME types, magic-byte check, server-generated storage
  // key), never a separate/unsafe upload path.
  async upsertNetworkAddress(adminId: string, symbol: string, dto: UpsertCryptoDepositAddressDto, file?: UploadedFileLike) {
    const asset = await this.prisma.cryptoAsset.findUnique({ where: { symbol } })
    if (!asset) throw new NotFoundException(`No crypto asset "${symbol}".`)

    const networkCode = dto.networkCode.trim().toUpperCase()
    const address = dto.receivingAddress.trim()
    const validation = validateReceivingAddress(networkCode, address)
    if (!validation.valid) {
      throw new BadRequestException(validation.reason ?? 'Invalid receiving address.')
    }

    const before = await this.prisma.cryptoDepositAddress.findUnique({
      where: { cryptoAssetId_networkCode: { cryptoAssetId: asset.id, networkCode } },
    })

    // New upload wins; otherwise an explicit `removeQr` clears it; otherwise
    // the existing key (if any) is left exactly as-is — a plain edit that
    // touches only the address/minimum/etc. must never silently drop an
    // already-uploaded QR.
    let qrStorageKey = before?.qrStorageKey ?? null
    if (file) {
      const stored = await this.media.save(file.originalname, file.mimetype, file.buffer)
      qrStorageKey = stored.storageKey
    } else if (dto.removeQr) {
      qrStorageKey = null
    }

    const updated = await this.prisma.cryptoDepositAddress.upsert({
      where: { cryptoAssetId_networkCode: { cryptoAssetId: asset.id, networkCode } },
      create: {
        cryptoAssetId: asset.id,
        networkCode,
        networkName: dto.networkName.trim(),
        receivingAddress: address,
        enabled: dto.enabled ?? true,
        minimumDeposit: dto.minimumDeposit ? new Decimal(dto.minimumDeposit) : null,
        sortOrder: dto.sortOrder ?? 0,
        qrStorageKey,
        updatedByAdminId: adminId,
      },
      update: {
        networkName: dto.networkName.trim(),
        receivingAddress: address,
        ...(dto.enabled !== undefined ? { enabled: dto.enabled } : {}),
        ...(dto.minimumDeposit !== undefined ? { minimumDeposit: dto.minimumDeposit ? new Decimal(dto.minimumDeposit) : null } : {}),
        ...(dto.sortOrder !== undefined ? { sortOrder: dto.sortOrder } : {}),
        qrStorageKey,
        updatedByAdminId: adminId,
      },
    })

    // Best-effort cleanup of a replaced/removed image — never lets a
    // storage failure block the record update that already succeeded.
    if (before?.qrStorageKey && before.qrStorageKey !== qrStorageKey) {
      await this.media.delete(before.qrStorageKey).catch(() => undefined)
    }

    // Deliberately never logs the OLD address's full value alongside the
    // new one in a way that could be mistaken for "the current address" —
    // both previousState/newState are clearly labeled, and neither is a
    // secret (a receiving address is meant to be shown to users), but the
    // distinction still matters for an accurate audit trail (Part 24).
    await this.audit.record({
      actorId: adminId,
      action: AuditEvent.CRYPTO_DEPOSIT_ADDRESS_CHANGED,
      targetType: 'CRYPTO_DEPOSIT_ADDRESS',
      targetId: updated.id,
      reason: dto.reason,
      previousState: before ? { receivingAddress: before.receivingAddress, enabled: before.enabled, minimumDeposit: before.minimumDeposit?.toString() ?? null } : undefined,
      newState: { symbol, networkCode, receivingAddress: updated.receivingAddress, enabled: updated.enabled, minimumDeposit: updated.minimumDeposit?.toString() ?? null },
    })
    return updated
  }

  // Step-up gated at the controller. Safe to hard-delete (not disable-only):
  // Deposit rows snapshot networkCode/receivingAddress as plain strings at
  // creation time (see Deposit model comment — Checkpoint K), never a live
  // foreign key to CryptoDepositAddress, so removing this row cannot orphan
  // or corrupt any historical deposit record.
  async deleteNetworkAddress(adminId: string, symbol: string, networkCode: string, reason: string) {
    const asset = await this.prisma.cryptoAsset.findUnique({ where: { symbol } })
    if (!asset) throw new NotFoundException(`No crypto asset "${symbol}".`)
    const code = networkCode.toUpperCase()
    const existing = await this.prisma.cryptoDepositAddress.findUnique({
      where: { cryptoAssetId_networkCode: { cryptoAssetId: asset.id, networkCode: code } },
    })
    if (!existing) throw new NotFoundException(`No "${code}" network configured for ${symbol}.`)

    await this.prisma.cryptoDepositAddress.delete({ where: { id: existing.id } })
    if (existing.qrStorageKey) await this.media.delete(existing.qrStorageKey).catch(() => undefined)

    await this.audit.record({
      actorId: adminId,
      action: AuditEvent.CRYPTO_DEPOSIT_ADDRESS_CHANGED,
      targetType: 'CRYPTO_DEPOSIT_ADDRESS',
      targetId: existing.id,
      reason,
      previousState: { symbol, networkCode: code, receivingAddress: existing.receivingAddress, enabled: existing.enabled },
      newState: { deleted: true },
    })
    return { ok: true }
  }

  // Serves the admin-uploaded QR image for one (asset, network) pair.
  // Reachable by any signed-in user (see crypto-deposits.controller.ts) —
  // same trust boundary as the receiving address itself (Part 24: not a
  // secret, meant to be shown to whoever is depositing that asset).
  async getQrStream(symbol: string, networkCode: string) {
    const asset = await this.prisma.cryptoAsset.findUnique({ where: { symbol } })
    if (!asset) throw new NotFoundException(`No crypto asset "${symbol}".`)
    const network = await this.prisma.cryptoDepositAddress.findUnique({
      where: { cryptoAssetId_networkCode: { cryptoAssetId: asset.id, networkCode: networkCode.toUpperCase() } },
    })
    if (!network || !network.qrStorageKey) throw new NotFoundException('No QR code uploaded for this network.')
    return { stream: await this.media.getObjectStream(network.qrStorageKey), storageKey: network.qrStorageKey }
  }
}
