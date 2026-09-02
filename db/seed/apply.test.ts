import { describe, expect, it } from 'vitest';
import { seedTargetError } from './apply';

describe('seedTargetError', () => {
  it('allows a local database whatever the environment says, except production', () => {
    expect(seedTargetError('localhost', 'development')).toBeNull();
    expect(seedTargetError('127.0.0.1', undefined)).toBeNull();
    expect(seedTargetError('[::1]', 'staging')).toBeNull();
    expect(seedTargetError('localhost', 'production')).toContain('never runs against production');
  });

  it('allows a remote database only when the environment is named staging', () => {
    expect(seedTargetError('db.example.com', 'staging')).toBeNull();
    expect(seedTargetError('db.example.com', 'development')).toContain('APP_ENV=staging');
    expect(seedTargetError('db.example.com', undefined)).toContain('APP_ENV=staging');
    expect(seedTargetError('db.example.com', 'production')).toContain(
      'never runs against production',
    );
    expect(seedTargetError(undefined, 'development')).toContain('APP_ENV=staging');
  });
});
