import { Injectable, CanActivate, ExecutionContext } from '@nestjs/common';
import { FirebaseService } from '../firebase/firebase.service';

/** Nastaví `request.user` z Firebase ID tokenu, ak je hlavička platná; inak `user` zostane nevyplnené. */
@Injectable()
export class OptionalAuthGuard implements CanActivate {
  constructor(private readonly firebaseService: FirebaseService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest();
    request.user = undefined;
    const authHeader = request.headers.authorization as string | undefined;
    if (!authHeader?.startsWith('Bearer ')) {
      return true;
    }
    const token = authHeader.substring(7);
    try {
      request.user = await this.firebaseService.getAuth().verifyIdToken(token);
    } catch {
      request.user = undefined;
    }
    return true;
  }
}
