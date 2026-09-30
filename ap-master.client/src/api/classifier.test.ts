import { describe, expect, it } from 'vitest';
import { classify, confidenceThreshold, normalise } from './classifier.ts';
import { RequestType } from './types.ts';

/**
 * The same cases as AP-Server-Tests/RuleBasedClassifierTests.cs. If the C# signal
 * table changes and this port does not, these are what should fail.
 */
describe('classify mirrors RuleBasedClassifier', () => {
    it.each([
        ['I want to make a complaint about my bill', RequestType.Complaint],
        ['This is unacceptable, I want compensation', RequestType.Complaint],
        ["I'm really unhappy with the service", RequestType.Complaint],
        ["My router won't turn on and there are no lights", RequestType.TechnicalSupport],
        ['I need an engineer to install my new line', RequestType.TechnicalSupport],
        ['The router is damaged', RequestType.TechnicalSupport],
        ['My internet is really slow', RequestType.ServiceIssue],
        ['The wifi keeps dropping', RequestType.ServiceIssue],
        ["I can't connect to the internet", RequestType.ServiceIssue],
        ['How much does the fibre upgrade cost?', RequestType.CustomerEnquiry],
        ['What are your opening hours?', RequestType.CustomerEnquiry],
        ['Can I change my address?', RequestType.CustomerEnquiry],
    ])('classifies "%s" confidently from the rules', (message, expected) => {
        const result = classify(message);

        expect(result.requestType).toBe(expected);
        expect(result.confidence).toBeGreaterThanOrEqual(confidenceThreshold);
    });

    it('does not treat a negated complaint as a complaint', () => {
        expect(classify('I have no complaints, just a question about prices').requestType).toBe(
            RequestType.CustomerEnquiry,
        );
    });

    it('lets a complaint outscore the service words in the same message', () => {
        // Complaint (3) against "internet" (1) and "down" (1).
        expect(classify('I want to complain, my internet has been down all week').requestType).toBe(
            RequestType.Complaint,
        );
    });

    it('breaks a tie in favour of a complaint, with low confidence', () => {
        // "engineer" (TechnicalSupport 3) ties with "unacceptable" (Complaint 3).
        const result = classify('The engineer never turned up, this is unacceptable');

        expect(result.requestType).toBe(RequestType.Complaint);
        expect(result.confidence).toBeLessThan(confidenceThreshold);
    });

    it('defaults to an enquiry with zero confidence when nothing matches', () => {
        const result = classify('Hello there');

        expect(result.requestType).toBe(RequestType.CustomerEnquiry);
        expect(result.confidence).toBe(0);
        expect(result.matchedSignals).toEqual([]);
    });

    it('matches whole words only', () => {
        // "download" must not match the phrase "down".
        expect(classify('The download finished').matchedSignals).toEqual([]);
    });

    it.each([
        ['MY INTERNET IS DOWN!!!', RequestType.ServiceIssue],
        ['My router won’t turn on', RequestType.TechnicalSupport], // curly apostrophe
    ])('ignores case and punctuation in "%s"', (message, expected) => {
        expect(classify(message).requestType).toBe(expected);
    });
});

describe('classify, beyond the server tests', () => {
    it('reports confidence the way the server documents it', () => {
        // One strong phrase = 1.0; one weak phrase = 0.33; strong but contested (3 vs 2) = 0.6.
        expect(classify('There is an outage').confidence).toBe(1);
        expect(classify('My modem').confidence).toBe(0.33);
        expect(classify('There is an outage and my router is flashing').confidence).toBe(0.6);
    });

    it('records the matched phrases in the server log format', () => {
        expect(classify('I want to complain').matchedSignals).toEqual(['Complaint:complain(+3)']);
        expect(classify('I have no complaints').matchedSignals).toEqual([
            'Complaint:complain(+3)',
            'Complaint:no complain(-3)',
        ]);
    });
});

describe('normalise', () => {
    it('pads, lower-cases and collapses punctuation into single spaces', () => {
        expect(normalise('  Hello,   WORLD!! ')).toBe(' hello world ');
    });

    it('returns an empty string for blank input', () => {
        expect(normalise('')).toBe('');
        expect(normalise('   ')).toBe('');
        expect(normalise(undefined)).toBe('');
        expect(normalise('!!!')).toBe('');
    });
});
