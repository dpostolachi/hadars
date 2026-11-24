import { createHash, createPrivateKey, createPublicKey, generateKeyPairSync, sign, verify } from 'node:crypto';

// Ed25519 signatures over channel moves. Keys travel as base64url: raw 32-byte public keys, PKCS#8 DER private keys.

const SPKI_PREFIX = Buffer.from('302a300506032b6570032100', 'hex');

/** What a signer vouches for: this snapshot is version N of this channel of this team. */
export const channelMoveStatement = (team: string, channel: string, version: number, snapshotId: string) =>
    `hadars-platform/channel-move/v1\n${team}\n${channel}\n${version}\n${snapshotId}`;

/** A key's ID is derived from the public key, so a signature names exactly the key that must verify it. */
export const signingKeyId = (publicKey: string) => `sk_${createHash('sha256').update(Buffer.from(publicKey, 'base64url')).digest('hex').slice(0, 16)}`;

export function generateSigningKey(): { publicKey: string; privateKey: string; keyId: string } {
    const { publicKey, privateKey } = generateKeyPairSync('ed25519');
    const pub = (publicKey.export({ type: 'spki', format: 'der' }) as Buffer).subarray(SPKI_PREFIX.length).toString('base64url');
    return { publicKey: pub, privateKey: (privateKey.export({ type: 'pkcs8', format: 'der' }) as Buffer).toString('base64url'), keyId: signingKeyId(pub) };
}

export const validPublicKey = (publicKey: unknown): publicKey is string =>
    typeof publicKey === 'string' && /^[A-Za-z0-9_-]{43}$/.test(publicKey) && Buffer.from(publicKey, 'base64url').length === 32;

export function signStatement(privateKey: string, statement: string): string {
    const key = createPrivateKey({ key: Buffer.from(privateKey, 'base64url'), format: 'der', type: 'pkcs8' });
    return sign(null, Buffer.from(statement), key).toString('base64url');
}

export function verifyStatement(publicKey: string, statement: string, signature: string): boolean {
    if (!validPublicKey(publicKey) || typeof signature !== 'string' || !/^[A-Za-z0-9_-]{86}$/.test(signature)) return false;
    // Only the canonical encoding: the last base64 character has unused bits that would otherwise give a second spelling.
    if (Buffer.from(signature, 'base64url').toString('base64url') !== signature) return false;
    try {
        const key = createPublicKey({ key: Buffer.concat([SPKI_PREFIX, Buffer.from(publicKey, 'base64url')]), format: 'der', type: 'spki' });
        return verify(null, Buffer.from(statement), key, Buffer.from(signature, 'base64url'));
    } catch { return false; }
}

/** Subresource Integrity value for a file's hex sha256, ready for an `integrity` attribute. */
export const sriFromHex = (sha256Hex: string) => `sha256-${Buffer.from(sha256Hex, 'hex').toString('base64')}`;
