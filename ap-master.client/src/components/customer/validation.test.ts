import { describe, expect, it } from 'vitest';
import { parseCustomerId, validateEmail, validateName } from './validation.ts';

describe('validateName', () => {
    it.each(['Jane Doe', '  J  '])('accepts "%s"', (name) => {
        expect(validateName(name)).toBeUndefined();
    });

    it('requires something other than spaces', () => {
        expect(validateName('   ')).toBe('Enter your name.');
    });

    it('enforces the server limit of 100 characters', () => {
        expect(validateName('x'.repeat(100))).toBeUndefined();
        expect(validateName('x'.repeat(101))).toBe('Names are limited to 100 characters.');
    });
});

describe('validateEmail', () => {
    it.each(['jane@example.com', 'a@b', ' jane@example.com '])('accepts "%s"', (email) => {
        expect(validateEmail(email)).toBeUndefined();
    });

    it.each(['jane', '@example.com', 'jane@', 'jane@@example.com', 'a@b@c'])(
        'rejects "%s" as .NET [EmailAddress] would',
        (email) => {
            expect(validateEmail(email)).toBe('Enter an email address like name@example.com.');
        },
    );

    it('requires an address', () => {
        expect(validateEmail('')).toBe('Enter your email address.');
    });

    it('enforces the server limit of 254 characters', () => {
        const local = 'x'.repeat(250);
        expect(validateEmail(`${local}@a.b`)).toBeUndefined(); // exactly 254
        expect(validateEmail(`${local}x@a.b`)).toMatch(/limited to 254/);
    });
});

describe('parseCustomerId', () => {
    it.each([
        ['1', 1],
        [' 42 ', 42],
    ])('reads "%s" as %i', (value, expected) => {
        expect(parseCustomerId(value)).toBe(expected);
    });

    it.each(['', '0', '-3', '1.5', 'abc', '1e3', '99999999999999999999'])('rejects "%s"', (value) => {
        expect(parseCustomerId(value)).toBeUndefined();
    });
});
