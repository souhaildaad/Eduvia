import { ComponentFixture, TestBed } from '@angular/core/testing';

import { AiAssessment } from './ai-assessment';

describe('AiAssessment', () => {
  let component: AiAssessment;
  let fixture: ComponentFixture<AiAssessment>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [AiAssessment]
    })
    .compileComponents();

    fixture = TestBed.createComponent(AiAssessment);
    component = fixture.componentInstance;
    await fixture.whenStable();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
