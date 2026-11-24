import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';

// AES-256-GCM sealing shared by the registry (encrypts) and the CLI (decrypts what it pulls).

const NONCE = 12, TAG = 16;
const MAGIC = Buffer.from('HPE1');

/** Bytes a sealed blob adds to its plaintext: magic, nonce and tag. */
export const SEAL_OVERHEAD = MAGIC.length + NONCE + TAG;

export function gcmSeal(key: Uint8Array, aad: string, plain: Uint8Array, prefix = Buffer.alloc(0)): Buffer {
    const nonce = randomBytes(NONCE);
    const cipher = createCipheriv('aes-256-gcm', key, nonce);
    cipher.setAAD(Buffer.from(aad));
    const body = Buffer.concat([cipher.update(plain), cipher.final()]);
    return Buffer.concat([prefix, nonce, body, cipher.getAuthTag()]);
}
export function gcmOpen(key: Uint8Array, aad: string, sealed: Uint8Array, skip = 0): Buffer {
    if (sealed.length < skip + NONCE + TAG) throw new Error('ciphertext is too short');
    const buf = Buffer.from(sealed.buffer, sealed.byteOffset, sealed.length);
    const decipher = createDecipheriv('aes-256-gcm', key, buf.subarray(skip, skip + NONCE));
    decipher.setAAD(Buffer.from(aad));
    decipher.setAuthTag(buf.subarray(buf.length - TAG));
    return Buffer.concat([decipher.update(buf.subarray(skip + NONCE, buf.length - TAG)), decipher.final()]);
}


const blobAad = (team: string, address: string) => `blob:v1:${team}:${address}`;

/** Encrypts a verified blob. Team and address are authenticated, so ciphertext cannot be replayed under another name. */
export function sealBlob(encryptionKey: Uint8Array, team: string, address: string, plain: Uint8Array): Uint8Array {
    return gcmSeal(encryptionKey, blobAad(team, address), plain, MAGIC);
}
export function openBlob(encryptionKey: Uint8Array, team: string, address: string, sealed: Uint8Array): Uint8Array {
    if (sealed.length < MAGIC.length || !Buffer.from(sealed.buffer, sealed.byteOffset, MAGIC.length).equals(MAGIC)) throw new Error('not a sealed blob');
    return gcmOpen(encryptionKey, blobAad(team, address), sealed, MAGIC.length);
}
