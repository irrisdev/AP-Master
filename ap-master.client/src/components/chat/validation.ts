import { limits } from '../../api/index.ts';

/**
 * Client-side mirror of the server's DataAnnotations, so both halves reject the
 * same input and the user finds out before a round trip.
 */
export function validateMessage(value: string): string | undefined {
    if (value.length > limits.chatMessageMax) {
        return `Messages are limited to ${limits.chatMessageMax} characters.`;
    }
    return undefined;
}

export function canSendMessage(value: string): boolean {
    return value.trim().length >= limits.chatMessageMin && validateMessage(value) === undefined;
}
