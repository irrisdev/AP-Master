import { Button } from '../ui/Button.tsx';
import { ConversationTranscript } from './ConversationTranscript.tsx';

export interface ConversationThreadProps {
    conversationId: number;
    onClose: () => void;
}

/** A past conversation, opened from the Conversations tab. */
export function ConversationThread({ conversationId, onClose }: ConversationThreadProps) {
    return (
        <section className="panel detail" aria-label={`Conversation ${conversationId}`}>
            <header className="detail__header">
                <h2>Conversation #{conversationId}</h2>
                <Button variant="ghost" size="sm" onClick={onClose}>
                    Close
                </Button>
            </header>

            <ConversationTranscript conversationId={conversationId} />
        </section>
    );
}
