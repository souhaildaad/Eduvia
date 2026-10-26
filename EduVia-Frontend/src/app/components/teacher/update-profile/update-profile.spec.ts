import { ComponentFixture, TestBed } from '@angular/core/testing';
import { of } from 'rxjs';

import { UpdateProfileComponent } from './update-profile';
import { AuthService } from '../../../services/auth.service';

describe('UpdateProfile', () => {
  let component: UpdateProfileComponent;
  let fixture: ComponentFixture<UpdateProfileComponent>;

  const authServiceMock = {
    getProfile: vi.fn().mockReturnValue(of(null)),
    updateProfile: vi.fn().mockReturnValue(of({})),
  };

  beforeEach(async () => {
    vi.clearAllMocks();
    authServiceMock.getProfile.mockReturnValue(of(null));
    authServiceMock.updateProfile.mockReturnValue(of({}));

    await TestBed.configureTestingModule({
      imports: [UpdateProfileComponent],
      providers: [
        { provide: AuthService, useValue: authServiceMock },
      ],
    })
    .compileComponents();

    fixture = TestBed.createComponent(UpdateProfileComponent);
    component = fixture.componentInstance;
  });

  afterEach(() => {
    fixture.destroy();
  });

  it('should create', async () => {
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();

    expect(component).toBeTruthy();
  });
});
