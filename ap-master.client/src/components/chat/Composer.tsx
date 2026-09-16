import type { KeyboardEvent } from 'react';
import { limits } from '../../api/index.ts';
import { Button } from '../ui/Button.tsx';
import { TextArea } from '../ui/TextField.tsx';
import { canSendMessage, validateMessage } from './validation.ts';

export interface ComposerProps {
    value: string;
    onChange: (value: string) => void;
    onSend: () => void;
    /** True while the previous message is still in flight. */
    sending?: boolean;
}

export function Composer({ value, onChange, onSend, sending = false }: ComposerProps) {
    const error = validateMessage(value);
    const canSend = canSendMessage(value) && !sending;

    function handleKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
        // Enter sends; Shift+Enter is a newline. Ignore the Enter that closes an
        // IME candidate window, or the message gets sent half-composed.
        if (event.key !== 'Enter' || event.shiftKey || event.nativeEvent.isComposing) return;
        event.preventDefault();
        if (canSend) onSend();
    }

    return (
        <form
            className="composer"
            onSubmit={(event) => {
                event.preventDefault();
                if (canSend) onSend();
            }}
        >
            <TextArea
                label="Your message"
                hideLabel
                placeholder="Describe what you need help with…"
                value={value}
                rows={2}
                error={error}
                hint={`${value.length} / ${limits.chatMessageMax}`}
                onChange={(event) => onChange(event.target.value)}
                onKeyDown={handleKeyDown}
            />
            <Button type="submit" variant="primary" disabled={!canSend} loading={sending}>
                Send
            </Button>
        </form>
    );
}
