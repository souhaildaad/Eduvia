import { ComponentFixture, TestBed } from '@angular/core/testing';

import { ExamReminders } from './exam-reminders';

describe('ExamReminders', () => {
  let component: ExamReminders;
  let fixture: ComponentFixture<ExamReminders>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [ExamReminders]
    })
    .compileComponents();

    fixture = TestBed.createComponent(ExamReminders);
    component = fixture.componentInstance;
    await fixture.whenStable();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
