import { ComponentFixture, TestBed } from '@angular/core/testing';
import { beforeEach, describe, expect, it } from 'vitest';

import { BreadcrumbComponent } from './breadcrumb.component';

describe('BreadcrumbComponent', () => {
  let fixture: ComponentFixture<BreadcrumbComponent>;

  const host = (): HTMLElement => fixture.nativeElement as HTMLElement;

  beforeEach(async () => {
    await TestBed.configureTestingModule({ imports: [BreadcrumbComponent] }).compileComponents();
    fixture = TestBed.createComponent(BreadcrumbComponent);
  });

  it('renders nothing at all when the trail is empty', () => {
    fixture.detectChanges();

    expect(host().querySelector('ol')).toBeNull();
    expect(host().querySelectorAll('li')).toHaveLength(0);
    expect(host().textContent?.trim()).toBe('');
  });

  it('renders one crumb per item, in trail order, as plain text', () => {
    fixture.componentRef.setInput('items', [{ label: 'Clients' }]);
    fixture.detectChanges();

    const crumbs = host().querySelectorAll('li');

    expect(host().querySelector('ol.breadcrumb')).not.toBeNull();
    expect(crumbs).toHaveLength(1);
    expect(crumbs[0].textContent?.trim()).toBe('Clients');
    expect(host().querySelector('a')).toBeNull();
  });

  it('marks the last crumb as the current page', () => {
    fixture.componentRef.setInput('items', [{ label: 'Head Office' }, { label: 'Clients' }]);
    fixture.detectChanges();

    const crumbs = host().querySelectorAll('li');

    expect(crumbs).toHaveLength(2);
    expect(crumbs[0].classList.contains('active')).toBe(false);
    expect(crumbs[1].classList.contains('active')).toBe(true);
  });
});
