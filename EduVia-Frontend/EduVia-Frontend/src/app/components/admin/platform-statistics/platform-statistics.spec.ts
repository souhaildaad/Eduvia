import { ComponentFixture, TestBed } from '@angular/core/testing';

import { PlatformStatistics } from './platform-statistics';

describe('PlatformStatistics', () => {
  let component: PlatformStatistics;
  let fixture: ComponentFixture<PlatformStatistics>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [PlatformStatistics]
    })
    .compileComponents();

    fixture = TestBed.createComponent(PlatformStatistics);
    component = fixture.componentInstance;
    await fixture.whenStable();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
