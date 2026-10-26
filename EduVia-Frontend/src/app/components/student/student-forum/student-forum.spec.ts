import { ComponentFixture, TestBed } from '@angular/core/testing';

import { StudentForum } from './student-forum';
import { NotificationService } from '../../../services/notification.service';
import { VoiceDictationService } from '../../../services/voice-dictation.service';
import { VoicePlaybackService } from '../../../services/voice-playback.service';

describe('StudentForum', () => {
  let component: StudentForum;
  let fixture: ComponentFixture<StudentForum>;

  const notificationServiceMock = {
    syncCurrentUserNotifications: vi.fn(),
    addNotification: vi.fn(),
  };

  const voiceDictationServiceMock = {
    toggle: vi.fn().mockReturnValue(false),
    isActive: vi.fn().mockReturnValue(false),
    stop: vi.fn(),
  };

  const voicePlaybackServiceMock = {
    toggle: vi.fn().mockReturnValue(false),
    isActive: vi.fn().mockReturnValue(false),
    stop: vi.fn(),
  };

  beforeEach(async () => {
    vi.clearAllMocks();
    localStorage.clear();
    sessionStorage.clear();

    await TestBed.configureTestingModule({
      imports: [StudentForum],
      providers: [
        { provide: NotificationService, useValue: notificationServiceMock },
        { provide: VoiceDictationService, useValue: voiceDictationServiceMock },
        { provide: VoicePlaybackService, useValue: voicePlaybackServiceMock },
      ],
    })
    .compileComponents();

    fixture = TestBed.createComponent(StudentForum);
    component = fixture.componentInstance;
  });

  afterEach(() => {
    fixture.destroy();
  });

  it('should create', async () => {
    vi.spyOn(component as unknown as { loadRequests: () => void }, 'loadRequests').mockImplementation(() => undefined);

    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();

    expect(component).toBeTruthy();
  });
});
