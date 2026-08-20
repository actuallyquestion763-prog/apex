import request from 'supertest'
import { createTestApp } from './helpers/test-app'

// Checkpoint I.1, Part 2 — graceful shutdown.
//
// main.ts calls app.enableShutdownHooks(['SIGTERM', 'SIGINT']), which makes
// Nest listen for those OS signals and, on receipt, call app.close() — the
// exact same call this test makes directly. This test verifies what
// app.close() actually DOES (module lifecycle cleanup runs, the HTTP server
// stops accepting new requests) rather than OS signal delivery itself.
//
// Signal delivery is NOT verified by a spawned-subprocess test in this
// repository: on Windows, child_process.kill('SIGTERM'/'SIGINT') performs
// unconditional, immediate termination of the target process rather than
// delivering a catchable signal (documented Node.js behavior, not specific
// to this codebase) — a subprocess test on this development machine would
// only prove Windows' own termination behavior, not TRUST's shutdown code.
// Any real deployment target (Linux containers/VMs — Docker, Kubernetes,
// systemd) delivers SIGTERM/SIGINT as real catchable signals, which is
// exactly what enableShutdownHooks() is designed for.
describe('Graceful shutdown (real PostgreSQL)', () => {
  it('app.close() runs PrismaService.onModuleDestroy (disconnects cleanly) and the HTTP server stops accepting new requests', async () => {
    const { app, prisma } = await createTestApp()
    // The plain e2e test harness only calls app.init() (supertest manages
    // its own ephemeral listener per request against a non-listening
    // server, which would make "the server stops accepting requests" a
    // vacuous check) — listen on a real port here so closing it has a real,
    // observable effect, exactly like the deployed process in main.ts.
    await app.listen(0)
    const address = app.getHttpServer().address()
    const port = typeof address === 'object' && address ? address.port : 0

    // Sanity: the server accepts requests before shutdown begins.
    await request(`http://127.0.0.1:${port}`).get('/health').expect(200)

    const disconnectSpy = jest.spyOn(prisma, '$disconnect')

    await app.close()

    expect(disconnectSpy).toHaveBeenCalled()

    // The real TCP listener is closed — a new connection attempt must fail
    // (connection refused), never silently succeed as if nothing happened.
    await expect(request(`http://127.0.0.1:${port}`).get('/health')).rejects.toBeTruthy()

    disconnectSpy.mockRestore()
  })

  it('closing the app does not throw and can be called on an app that never received any traffic', async () => {
    const { app } = await createTestApp()
    await expect(app.close()).resolves.not.toThrow()
  })
})
