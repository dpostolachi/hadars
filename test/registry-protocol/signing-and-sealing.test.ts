import { test, expect } from 'bun:test';
import { channelMoveStatement, generateSigningKey, sealBlob, openBlob, signStatement, signingKeyId, verifyStatement } from '../../src/registry-protocol';

const key = generateSigningKey();
const statement = channelMoveStatement('acme', 'stable', 3, 'snap_0123456789abcdef');

test('a channel-move signature verifies only for the exact team, channel, version and snapshot', () => {
    const signature = signStatement(key.privateKey, statement);
    expect(verifyStatement(key.publicKey, statement, signature)).toBe(true);
    for (const changed of [
        channelMoveStatement('other', 'stable', 3, 'snap_0123456789abcdef'),
        channelMoveStatement('acme', 'next', 3, 'snap_0123456789abcdef'),
        channelMoveStatement('acme', 'stable', 4, 'snap_0123456789abcdef'),
        channelMoveStatement('acme', 'stable', 3, 'snap_fedcba9876543210'),
    ]) expect(verifyStatement(key.publicKey, changed, signature)).toBe(false);
});

test('a signature from another key, or a re-spelled signature, does not verify', () => {
    const other = generateSigningKey();
    const signature = signStatement(key.privateKey, statement);
    expect(verifyStatement(other.publicKey, statement, signature)).toBe(false);
    const flipped = (signature[0] === 'A' ? 'B' : 'A') + signature.slice(1);
    expect(verifyStatement(key.publicKey, statement, flipped)).toBe(false);
    expect(verifyStatement(key.publicKey, statement, 'not-a-signature')).toBe(false);
});

test('key IDs are derived from the public key', () => {
    expect(key.keyId).toBe(signingKeyId(key.publicKey));
    expect(key.keyId).toMatch(/^sk_[0-9a-f]{16}$/);
});

test('sealed blobs round-trip, and fail when the key, team, address or bytes differ', () => {
    const encryptionKey = crypto.getRandomValues(new Uint8Array(32));
    const plain = new TextEncoder().encode('module bytes');
    const sealed = sealBlob(encryptionKey, 'acme', 'addr1', plain);
    expect(new TextDecoder().decode(openBlob(encryptionKey, 'acme', 'addr1', sealed))).toBe('module bytes');
    expect(() => openBlob(crypto.getRandomValues(new Uint8Array(32)), 'acme', 'addr1', sealed)).toThrow();
    expect(() => openBlob(encryptionKey, 'other', 'addr1', sealed)).toThrow();
    expect(() => openBlob(encryptionKey, 'acme', 'addr2', sealed)).toThrow();
    const tampered = Uint8Array.from(sealed); tampered[tampered.length - 1] ^= 1;
    expect(() => openBlob(encryptionKey, 'acme', 'addr1', tampered)).toThrow();
    expect(() => openBlob(encryptionKey, 'acme', 'addr1', new TextEncoder().encode('not sealed at all'))).toThrow('not a sealed blob');
});
