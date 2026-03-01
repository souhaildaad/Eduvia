import { ComponentFixture, TestBed } from '@angular/core/testing';

import { ClubSuggestions } from './club-suggestions';

describe('ClubSuggestions', () => {
  let component: ClubSuggestions;
  let fixture: ComponentFixture<ClubSuggestions>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [ClubSuggestions]
    })
    .compileComponents();

    fixture = TestBed.createComponent(ClubSuggestions);
    component = fixture.componentInstance;
    await fixture.whenStable();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
