export class IntegrationError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly outcome: 'known-failure' | 'uncertain' = 'known-failure',
  ) {
    super(message);
    this.name = 'IntegrationError';
  }
}
