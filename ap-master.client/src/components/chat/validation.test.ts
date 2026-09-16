import { describe, expect, it } from 'vitest';
import { limits } from '../../api/index.ts';
import { canSendMessage, validateMessage } from './validation.ts';

describe('message validation', () => {
    it('rejects a message longer than the server allows', () => {
        const tooLong = 'x'.repeat(limits.chatMessageMax + 1);
        expect(validateMessage(tooLong)).toContain(String(limits.chatMessageMax));
        expect(canSendMessage(tooLong)).toBe(false);
    });

    it('accepts a message exactly at the limit', () => {
        const atLimit = 'x'.repeat(limits.chatMessageMax);
        expect(validateMessage(atLimit)).toBeUndefined();
        expect(canSendMessage(atLimit)).toBe(true);
    });

    it('treats whitespace as empty', () => {
        expect(canSendMessage('   \n  ')).toBe(false);
        expect(canSendMessage('')).toBe(false);
    });

    it('does not report an error for an empty box, only refuses to send it', () => {
        // Nagging someone about a field they have not filled in yet is noise.
        expect(validateMessage('')).toBeUndefined();
        expect(canSendMessage('')).toBe(false);
    });
});
