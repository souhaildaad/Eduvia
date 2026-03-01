import { ComponentFixture, TestBed } from '@angular/core/testing';

import { CourseQuiz } from './course-quiz';

describe('CourseQuiz', () => {
  let component: CourseQuiz;
  let fixture: ComponentFixture<CourseQuiz>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [CourseQuiz]
    })
    .compileComponents();

    fixture = TestBed.createComponent(CourseQuiz);
    component = fixture.componentInstance;
    await fixture.whenStable();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
