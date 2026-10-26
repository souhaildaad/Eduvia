import { ComponentFixture, TestBed } from '@angular/core/testing';

import { StudentTracking } from './student-tracking';

describe('StudentTracking', () => {
  let component: StudentTracking;
  let fixture: ComponentFixture<StudentTracking>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [StudentTracking],
    }).compileComponents();

    fixture = TestBed.createComponent(StudentTracking);
    component = fixture.componentInstance;
    await fixture.whenStable();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
