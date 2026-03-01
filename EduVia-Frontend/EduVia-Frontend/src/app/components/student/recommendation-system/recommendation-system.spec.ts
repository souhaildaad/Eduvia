import { ComponentFixture, TestBed } from '@angular/core/testing';

import { RecommendationSystem } from './recommendation-system';

describe('RecommendationSystem', () => {
  let component: RecommendationSystem;
  let fixture: ComponentFixture<RecommendationSystem>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [RecommendationSystem]
    })
    .compileComponents();

    fixture = TestBed.createComponent(RecommendationSystem);
    component = fixture.componentInstance;
    await fixture.whenStable();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
