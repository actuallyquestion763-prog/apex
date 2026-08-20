// DI token for the active ExecutionProvider — kept in its own file (not
// execution.module.ts) so a controller can `@Inject(EXECUTION_PROVIDER)`
// without creating a module<->controller circular import (the module file
// imports the controller to register it; the controller needs the token).
export const EXECUTION_PROVIDER = Symbol('EXECUTION_PROVIDER')
