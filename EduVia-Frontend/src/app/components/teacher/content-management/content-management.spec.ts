import { ComponentFixture, TestBed } from '@angular/core/testing';

import { ContentManagement } from './content-management';

describe('ContentManagement', () => {
  let component: ContentManagement;
  let fixture: ComponentFixture<ContentManagement>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [ContentManagement]
    })
    .compileComponents();

    fixture = TestBed.createComponent(ContentManagement);
    component = fixture.componentInstance;
    await fixture.whenStable();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
