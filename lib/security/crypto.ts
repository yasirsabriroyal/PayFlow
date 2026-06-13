import crypto from 'crypto'

/**
 * App-level AES-256-GCM encryption for sensitive banking data.
 *
 * Stored format (single base64 string, prefixed + versioned so we can detect
 * encrypted values vs. legacy plaintext and rotate schemes later):
 *
 *   enc:v1:<base64( iv[12] | authTag[16] | ciphertext )>
 *
 * The 32-byte key comes from the BANK_ENCRYPTION_KEY env var (base64 or hex).
 * Keep `bank_account_last4` in clear for display; never log plaintext.
 */

const PREFIX = 'enc:v1:'
const IV_LENGTH = 12 // GCM standard nonce size
const AUTH_TAG_LENGTH = 16
const ALGORITHM = 'aes-256-gcm'

let cachedKey: Buffer | null = null

/**
 * Resolve and validate the 32-byte encryption key. Accepts base64 or hex.
 * Throws if missing/invalid so security-critical writes fail loudly.
 */
function getKey(): Buffer {
  if (cachedKey) return cachedKey

  const raw = process.env.BANK_ENCRYPTION_KEY
  if (!raw) {
    throw new Error(
      'BANK_ENCRYPTION_KEY is not set. Banking encryption is unavailable until it is configured.'
    )
  }

  let key: Buffer
  // Try base64 first, then hex.
  if (/^[0-9a-fA-F]{64}$/.test(raw)) {
    key = Buffer.from(raw, 'hex')
  } else {
    key = Buffer.from(raw, 'base64')
  }

  if (key.length !== 32) {
    throw new Error(
      `BANK_ENCRYPTION_KEY must decode to 32 bytes (got ${key.length}). Generate one with: openssl rand -base64 32`
    )
  }

  cachedKey = key
  return key
}

/** True when the encryption key is configured and usable. */
export function isBankEncryptionAvailable(): boolean {
  try {
    getKey()
    return true
  } catch {
    return false
  }
}

/** True when a stored value is in our encrypted envelope format. */
export function isEncrypted(value: string | null | undefined): boolean {
  return typeof value === 'string' && value.startsWith(PREFIX)
}

/**
 * Encrypt a plaintext string. Returns the `enc:v1:...` envelope.
 * Empty/nullish input returns null (nothing to store).
 */
export function encrypt(plaintext: string | null | undefined): string | null {
  if (plaintext === null || plaintext === undefined || plaintext === '') return null

  const key = getKey()
  const iv = crypto.randomBytes(IV_LENGTH)
  const cipher = crypto.createCipheriv(ALGORITHM, key, iv)
  const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()])
  const authTag = cipher.getAuthTag()

  const payload = Buffer.concat([iv, authTag, ciphertext])
  return PREFIX + payload.toString('base64')
}

/**
 * Decrypt an `enc:v1:...` envelope back to plaintext.
 *
 * Tolerance for migration safety:
 * - null/empty -> null
 * - legacy plaintext (no prefix) -> returned as-is
 * - encrypted but key missing/invalid -> throws (caller decides how to degrade)
 */
export function decrypt(stored: string | null | undefined): string | null {
  if (stored === null || stored === undefined || stored === '') return null
  if (!isEncrypted(stored)) return stored // legacy plaintext

  const key = getKey()
  const payload = Buffer.from(stored.slice(PREFIX.length), 'base64')
  const iv = payload.subarray(0, IV_LENGTH)
  const authTag = payload.subarray(IV_LENGTH, IV_LENGTH + AUTH_TAG_LENGTH)
  const ciphertext = payload.subarray(IV_LENGTH + AUTH_TAG_LENGTH)

  const decipher = crypto.createDecipheriv(ALGORITHM, key, iv)
  decipher.setAuthTag(authTag)
  const plaintext = Buffer.concat([decipher.update(ciphertext), decipher.final()])
  return plaintext.toString('utf8')
}

/**
 * Best-effort decrypt that never throws — returns null when the value can't be
 * decrypted (e.g. key missing). Use on read paths that must not crash.
 */
export function tryDecrypt(stored: string | null | undefined): string | null {
  try {
    return decrypt(stored)
  } catch {
    return null
  }
}

/** Last 4 digits of an account number, for safe display. */
export function lastFour(accountNumber: string | null | undefined): string | null {
  if (!accountNumber) return null
  const digits = accountNumber.replace(/\D/g, '')
  return digits.length >= 4 ? digits.slice(-4) : digits || null
}

/** Masked display form, e.g. ••••6789. */
export function maskAccount(last4: string | null | undefined): string | null {
  if (!last4) return null
  return `••••${last4}`
}
