import { limits } from '../../api/index.ts';

/**
 * Client-side mirror of CreateCustomerRequest's DataAnnotations, so the customer
 * finds out before a round trip. The server still validates; this only saves a trip.
 */

export function validateName(value: string): string | undefined {
    const name = value.trim();
    if (name.length === 0) return 'Enter your name.';
    if (name.length > limits.customerNameMax) {
        return `Names are limited to ${limits.customerNameMax} characters.`;
    }
    return undefined;
}

/**
 * The same rule as .NET's [EmailAddress]: exactly one @, with something either side.
 * Deliberately loose — the only real test of an address is sending to it.
 */
export function validateEmail(value: string): string | undefined {
    const email = value.trim();
    if (email.length === 0) return 'Enter your email address.';
    if (email.length > limits.customerEmailMax) {
        return `Email addresses are limited to ${limits.customerEmailMax} characters.`;
    }

    const at = email.indexOf('@');
    if (at <= 0 || at !== email.lastIndexOf('@') || at === email.length - 1) {
        return 'Enter an email address like name@example.com.';
    }
    return undefined;
}

/** A customer number is a positive whole number; returns it, or undefined if it is not one. */
export function parseCustomerId(value: string): number | undefined {
    const trimmed = value.trim();
    if (!/^\d+$/.test(trimmed)) return undefined;
    const id = Number(trimmed);
    return Number.isSafeInteger(id) && id >= 1 ? id : undefined;
}
