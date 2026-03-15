import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'

/**
 * Compute SHA-256 checksum of a file's contents.
 */
export function checksumFile(filePath: string): string {
  const content = readFileSync(filePath, 'utf-8')
  return createHash('sha256').update(content).digest('hex').slice(0, 16)
}
