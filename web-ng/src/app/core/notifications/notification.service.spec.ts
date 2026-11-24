import { TestBed } from '@angular/core/testing';
import { beforeEach, describe, expect, it } from 'vitest';

import { NotificationService } from './notification.service';

describe('NotificationService', () => {
  let service: NotificationService;

  const texts = (): string[] => service.messages().map((notice) => notice.message);
  const ids = (): number[] => service.messages().map((notice) => notice.id);

  beforeEach(() => {
    // Reset explicitly so the suite does not depend on the runner clearing the module between
    // tests: a second `configureTestingModule` on an instantiated module throws.
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({});
    service = TestBed.inject(NotificationService);
  });

  it('starts with an empty queue', () => {
    expect(service.messages()).toEqual([]);
  });

  it('queues notices in the order they are shown, each with a new id', () => {
    service.show('info', 'Saved');
    service.show('error', 'Failed to load clients');
    service.show('success', 'Loan disbursed');

    expect(texts()).toEqual(['Saved', 'Failed to load clients', 'Loan disbursed']);
    expect(ids()).toEqual([1, 2, 3]);
    expect(service.messages().map((notice) => notice.kind)).toEqual(['info', 'error', 'success']);
  });

  it('keeps two notices carrying identical text apart by their id', () => {
    service.show('error', 'Failed to load clients');
    service.show('error', 'Failed to load clients');

    expect(texts()).toEqual(['Failed to load clients', 'Failed to load clients']);
    expect(ids()).toEqual([1, 2]);
  });

  it('stores the message exactly as received, without trimming or altering it', () => {
    const fineractMessage = 'The request caused a data integrity issue to be fired by the database.';

    service.show('error', fineractMessage);

    expect(texts()).toEqual([fineractMessage]);
  });

  it('publishes a frozen array on every change', () => {
    service.show('info', 'Saved');

    expect(Object.isFrozen(service.messages())).toBe(true);

    service.clear();

    expect(Object.isFrozen(service.messages())).toBe(true);
    expect(service.messages()).toEqual([]);
  });

  it('leaves an earlier snapshot untouched when a notice is added', () => {
    const before = service.messages();

    service.show('info', 'Saved');

    expect(before).toEqual([]);
    expect(service.messages()).not.toBe(before);
  });

  it('dismisses only the notice carrying the id, preserving the order of the rest', () => {
    service.show('info', 'first');
    service.show('error', 'second');
    service.show('success', 'third');

    service.dismiss(2);

    expect(texts()).toEqual(['first', 'third']);
    expect(ids()).toEqual([1, 3]);
  });

  it('changes nothing and keeps the same snapshot when the id is not queued', () => {
    service.show('info', 'only');
    const snapshot = service.messages();

    service.dismiss(999);

    expect(service.messages()).toBe(snapshot);
    expect(texts()).toEqual(['only']);
  });

  it('clears every notice', () => {
    service.show('info', 'first');
    service.show('error', 'second');

    service.clear();

    expect(service.messages()).toEqual([]);
  });

  it('clears an already empty queue without failing', () => {
    expect(() => service.clear()).not.toThrow();
    expect(service.messages()).toEqual([]);
  });

  it('never reuses an id after the queue is cleared', () => {
    service.show('info', 'first');
    service.clear();

    service.show('info', 'second');

    expect(ids()).toEqual([2]);
  });

  it('resolves as one application-wide instance from the root injector', () => {
    expect(TestBed.inject(NotificationService)).toBe(service);
  });
});
