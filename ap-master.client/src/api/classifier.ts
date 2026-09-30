import { RequestType } from './types.ts';

/**
 * A port of the server's RuleBasedClassifier (Services/RuleBasedClassifier.cs), used by
 * MockApiClient so that demo mode routes messages the way the server does.
 *
 * The server is a hybrid: when these rules score below ClassificationService's 0.6
 * threshold it asks the AI to decide instead. The mock has no AI, which makes it
 * equivalent to the server running with no API key (DummyAIService) or with the provider
 * down — in both cases the rule result below is what gets used.
 *
 * Keep the signal table in step with the C#. `classifier.test.ts` runs the server's own
 * test cases against this port, so a drifted weight shows up as a failing test.
 */

export interface RuleClassification {
    requestType: RequestType;
    /** 0 to 1: the share of the score the winner took, times how strong it was. */
    confidence: number;
    /** "Type:phrase(+weight)" for every phrase that matched, as the server logs them. */
    matchedSignals: string[];
}

/** Server's ClassificationService.ConfidenceThreshold: below this it consults the AI. */
export const confidenceThreshold = 0.6;

/** A score at or above this counts as a strong, unambiguous signal. */
const strongSignalWeight = 3;

/** On a tied score, the earlier type wins. */
const tieBreakOrder: RequestType[] = [
    RequestType.Complaint,
    RequestType.TechnicalSupport,
    RequestType.ServiceIssue,
    RequestType.CustomerEnquiry,
];

const typeName: Record<RequestType, string> = {
    [RequestType.CustomerEnquiry]: 'CustomerEnquiry',
    [RequestType.TechnicalSupport]: 'TechnicalSupport',
    [RequestType.ServiceIssue]: 'ServiceIssue',
    [RequestType.Complaint]: 'Complaint',
};

interface Signal {
    phrase: string;
    type: RequestType;
    weight: number;
}

const signals: Signal[] = [];

function add(type: RequestType, weight: number, ...phrases: string[]) {
    for (const phrase of phrases) signals.push({ phrase, type, weight });
}

// ---- Complaint: dissatisfaction, wanting to complain or escalate ----
add(RequestType.Complaint, 3,
    'complain*', 'unacceptable', 'disgusted', 'disgraceful', 'appalling', 'furious', 'ombudsman',
    'compensation', 'speak to a manager', 'speak to your manager', 'speak to someone senior',
    'terrible service', 'awful service', 'poor service', 'rubbish service', 'worst service');
add(RequestType.Complaint, 2,
    'unhappy', 'not happy', 'disappointed', 'frustrat*', 'angry', 'fed up', 'sick of', 'ridiculous',
    'escalate', 'rude', 'overcharged', 'charged twice', 'wrongly charged', 'cancel my contract',
    'switch provider', 'leave telegroup');
add(RequestType.Complaint, 1,
    'refund', 'still waiting', 'worst');
// Negations cancel out the "complain*" match.
add(RequestType.Complaint, -3,
    'no complain*', 'not complaining', 'not a complaint');

// ---- TechnicalSupport: equipment or work that needs a technician, so a ticket straight away ----
add(RequestType.TechnicalSupport, 3,
    'engineer*', 'technician*', 'install*', 'technical support', 'replacement router',
    'router is broken', 'broken router', 'router is damaged', "won't turn on", 'wont turn on',
    "doesn't turn on", 'doesnt turn on', 'not turning on', "won't power on", 'no power');
add(RequestType.TechnicalSupport, 2,
    'set up', 'setup', 'new router', 'faulty', 'damaged', 'hardware', 'wiring', 'socket',
    'no lights', 'red light', 'configur*', 'port forwarding', 'static ip');
add(RequestType.TechnicalSupport, 1,
    'technical', 'router', 'modem', 'broken', 'cable', 'flashing');

// ---- ServiceIssue: an existing service misbehaving, so troubleshoot first ----
add(RequestType.ServiceIssue, 3,
    'outage', 'no internet', 'no signal', 'no connection', 'internet is down', 'keeps dropping',
    'dropping out', 'drops out', 'intermittent*', 'packet loss', 'no dial tone');
add(RequestType.ServiceIssue, 2,
    'slow*', 'not working', "isn't working", 'isnt working', 'stopped working', 'disconnect*',
    'buffering', "can't connect", 'cant connect', 'cannot connect', 'unable to connect');
add(RequestType.ServiceIssue, 1,
    'down', 'lag*', 'wifi', 'wi fi', 'internet', 'broadband', 'speed*', 'connection', 'phone line');

// ---- CustomerEnquiry: questions about products, accounts and information ----
add(RequestType.CustomerEnquiry, 3,
    'opening hours', 'available in my area');
add(RequestType.CustomerEnquiry, 2,
    'how much', 'price*', 'pricing', 'cost*', 'upgrade', 'package*', 'do you offer',
    'availability', 'direct debit', 'change my address', 'moving house');
add(RequestType.CustomerEnquiry, 1,
    'plan', 'plans', 'contract', 'deal', 'deals', 'offer*', 'how do i', 'how can i', 'can i',
    'what is', 'my bill', 'payment*', 'account');

/**
 * Lower-case, unify curly apostrophes, turn anything that is not a letter, digit or
 * apostrophe into a space, collapse runs of spaces, and pad with one space each side —
 * so every phrase can be matched as whole words with a plain substring search.
 */
export function normalise(message: string | null | undefined): string {
    if (!message || message.trim() === '') return '';

    let out = ' ';
    let lastWasSpace = true;

    for (const original of message.toLowerCase()) {
        const c = original === '’' || original === '‘' ? "'" : original;

        if (/[\p{L}\p{N}']/u.test(c)) {
            out += c;
            lastWasSpace = false;
        } else if (!lastWasSpace) {
            out += ' ';
            lastWasSpace = true;
        }
    }

    if (!lastWasSpace) out += ' ';
    return out.length <= 1 ? '' : out;
}

/** Whole words only; a trailing * matches any ending ("complain*" matches "complaints"). */
function matches(paddedText: string, phrase: string): boolean {
    return phrase.endsWith('*')
        ? paddedText.includes(` ${phrase.slice(0, -1)}`)
        : paddedText.includes(` ${phrase} `);
}

/** .NET's Math.Round defaults to banker's rounding; match it so confidences agree exactly. */
function roundHalfEven(value: number, digits: number): number {
    const factor = 10 ** digits;
    const scaled = value * factor;
    const nearest = Math.round(scaled);
    const isMidpoint = Math.abs(scaled % 1) === 0.5;
    return (isMidpoint && nearest % 2 !== 0 ? nearest - 1 : nearest) / factor;
}

export function classify(message: string | null | undefined): RuleClassification {
    const text = normalise(message);
    const scores = new Map<RequestType, number>();
    const matchedSignals: string[] = [];

    for (const signal of signals) {
        if (!matches(text, signal.phrase)) continue;

        scores.set(signal.type, (scores.get(signal.type) ?? 0) + signal.weight);
        const sign = signal.weight > 0 ? '+' : '';
        matchedSignals.push(
            `${typeName[signal.type]}:${signal.phrase.replace(/\*+$/, '')}(${sign}${signal.weight})`,
        );
    }

    const positive = [...scores].filter(([, score]) => score > 0);

    if (positive.length === 0) {
        return { requestType: RequestType.CustomerEnquiry, confidence: 0, matchedSignals };
    }

    const [bestType, bestScore] = positive.sort(
        ([typeA, a], [typeB, b]) =>
            b - a || tieBreakOrder.indexOf(typeA) - tieBreakOrder.indexOf(typeB),
    )[0];

    // Share of the total score (how clear the win is) x strength of the winning score.
    // One strong phrase = 1.0; one weak phrase = 0.33; strong but contested (3 vs 2) = 0.6.
    const total = positive.reduce((sum, [, score]) => sum + score, 0);
    const confidence = (bestScore / total) * Math.min(1, bestScore / strongSignalWeight);

    return { requestType: bestType, confidence: roundHalfEven(confidence, 2), matchedSignals };
}
