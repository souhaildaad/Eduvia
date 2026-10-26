import { ComponentFixture, TestBed } from '@angular/core/testing';

import { RatingSystem } from './rating-system';

describe('RatingSystem', () => {
  let component: RatingSystem;
  let fixture: ComponentFixture<RatingSystem>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [RatingSystem]
    })
    .compileComponents();

    fixture = TestBed.createComponent(RatingSystem);
    component = fixture.componentInstance;
    await fixture.whenStable();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
