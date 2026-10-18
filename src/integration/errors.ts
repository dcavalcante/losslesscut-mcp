export class IntegrationError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly outcome: 'known-failure' | 'uncertain' = 'known-failure',
    readonly details?: Record<string, unknown>,
  ) {
    super(message);
    this.name = 'IntegrationError';
  }
}
