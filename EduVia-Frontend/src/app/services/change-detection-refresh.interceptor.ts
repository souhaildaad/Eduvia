import { ApplicationRef, Injectable } from '@angular/core';
import { HttpEvent, HttpHandler, HttpInterceptor, HttpRequest } from '@angular/common/http';
import { Observable, finalize } from 'rxjs';

@Injectable()
export class ChangeDetectionRefreshInterceptor implements HttpInterceptor {
  private refreshQueued = false;

  constructor(private appRef: ApplicationRef) {}

  intercept(req: HttpRequest<unknown>, next: HttpHandler): Observable<HttpEvent<unknown>> {
    return next.handle(req).pipe(finalize(() => this.queueRefresh()));
  }

  private queueRefresh() {
    if (this.refreshQueued) {
      return;
    }

    this.refreshQueued = true;
    setTimeout(() => {
      this.refreshQueued = false;
      this.appRef.tick();
    }, 0);
  }
}
