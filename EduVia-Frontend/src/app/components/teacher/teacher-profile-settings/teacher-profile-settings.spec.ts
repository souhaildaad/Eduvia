import { ComponentFixture, TestBed } from '@angular/core/testing';

import { TeacherProfileSettingsComponent } from './teacher-profile-settings';

describe('TeacherProfileSettings', () => {
  let component: TeacherProfileSettingsComponent;
  let fixture: ComponentFixture<TeacherProfileSettingsComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [TeacherProfileSettingsComponent]
    })
    .compileComponents();

    fixture = TestBed.createComponent(TeacherProfileSettingsComponent);
    component = fixture.componentInstance;
    await fixture.whenStable();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
