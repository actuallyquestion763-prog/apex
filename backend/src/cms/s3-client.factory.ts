import { S3Client } from '@aws-sdk/client-s3'

// Provider-neutral by construction: every value comes from an environment
// variable, so this same code works against AWS S3, Cloudflare R2, MinIO,
// or any other S3-compatible endpoint without a single provider-specific
// branch anywhere in the application. The production target is expected to
// be Cloudflare R2, but nothing here (or in MediaStorageService) knows that
// — see backend/.env.example for what each variable configures and
// src/config/env.validation.ts for the production/staging hard requirement.
//
// Region defaults to 'auto', which R2 and several other S3-compatible
// providers accept as a real value (R2 buckets aren't region-scoped the way
// AWS S3 buckets are) — AWS S3 itself requires a real region, which S3_REGION
// overrides. Credentials default to empty strings rather than throwing here:
// a missing/empty credential fails loudly the moment an actual S3 call is
// attempted (a clear, in-context error), which is preferable to a
// module-load-time crash that would take down the whole app for routes that
// never touch file storage — env.validation.ts is the actual hard gate for
// production/staging, not this constructor.
export function buildS3Client(): S3Client {
  return new S3Client({
    region: process.env.S3_REGION || 'auto',
    endpoint: process.env.S3_ENDPOINT || undefined,
    forcePathStyle: process.env.S3_FORCE_PATH_STYLE === 'true',
    credentials: {
      accessKeyId: process.env.S3_ACCESS_KEY_ID ?? '',
      secretAccessKey: process.env.S3_SECRET_ACCESS_KEY ?? '',
    },
  })
}
