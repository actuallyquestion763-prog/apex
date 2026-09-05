// DI token for the configured S3Client (kept in its own file, mirroring
// execution/execution.tokens.ts — same reasoning: a controller/service can
// @Inject(S3_CLIENT) without creating a module<->provider circular import).
export const S3_CLIENT = Symbol('S3_CLIENT')
