// Test-only secrets (random, never used outside tests).
process.env.JWT_SECRET = 'test-access-secret-0123456789abcdefghijklmnop'
process.env.MEDIA_SIGNING_SECRET = 'test-media-secret-0123456789abcdefghijklmnop'
process.env.DATABASE_URL = process.env.DATABASE_URL ?? 'postgresql://test:test@localhost:5432/test'
