import { ComponentFixture, TestBed } from '@angular/core/testing';

import { StudentForum } from './student-forum';

describe('StudentForum', () => {
  let component: StudentForum;
  let fixture: ComponentFixture<StudentForum>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [StudentForum]
    })
    .compileComponents();

    fixture = TestBed.createComponent(StudentForum);
    component = fixture.componentInstance;
    await fixture.whenStable();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
